/**
 * Tests for providerEnv (session-manager.ts) and the SessionManager.send()
 * finally-cleanup guarantee.
 *
 * providerEnv is a pure function — it takes a snapshot of process.env,
 * applies provider-specific overrides to a copy, and returns that copy
 * without mutating process.env.  We therefore only need to guard process.env
 * mutations inside providerEnv itself (the delete calls on the copy don't leak).
 *
 * For the finally-cleanup test we mock '@anthropic-ai/claude-agent-sdk' so
 * that query() throws mid-stream, then confirm SessionManager.send()'s
 * finally block removes the AbortController from the inflight map.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SessionConfig } from '../src/server/config.js';
import type { Settings } from '../src/server/settings.js';

// Mock @anthropic-ai/claude-agent-sdk so the send() test controls what query() yields.
// vi.mock is hoisted, so it applies to the whole file regardless of where it is written.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Settings double — only the get() method is needed. */
function makeSettings(data: Record<string, string | undefined>): Settings {
  return {
    get: (k: string) => (data as any)[k],
  } as unknown as Settings;
}

/** Minimal SessionConfig factory. */
function makeSession(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    id: 'test-session',
    label: 'Test',
    color: '#ffffff',
    project_dir: '/tmp',
    voice_mode: false,
    tts_rate: 1.2,
    stt_backend: 'browser' as const,
    provider: 'subscription',
    ...overrides,
  } as SessionConfig;
}

// ---------------------------------------------------------------------------
// providerEnv – per-provider env-var combinations
// ---------------------------------------------------------------------------

describe('providerEnv', () => {
  // Save and restore process.env around each test so nothing leaks.
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    // Replace every key: first clear, then restore.
    for (const k of Object.keys(process.env)) {
      delete process.env[k];
    }
    Object.assign(process.env, savedEnv);
  });

  it('subscription: removes ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL from returned env', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-existing';
    process.env.ANTHROPIC_BASE_URL = 'https://some-proxy.example.com';

    const { providerEnv } = await import('../src/server/session-manager.js');
    const session = makeSession({ provider: 'subscription' });
    const settings = makeSettings({});
    const env = providerEnv(session, settings);

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    // process.env must NOT have been mutated
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-existing');
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://some-proxy.example.com');
  });

  it('subscription: preserves other env vars', async () => {
    process.env.MY_CUSTOM_VAR = 'hello';
    const { providerEnv } = await import('../src/server/session-manager.js');
    const env = providerEnv(makeSession({ provider: 'subscription' }), makeSettings({}));
    expect(env.MY_CUSTOM_VAR).toBe('hello');
  });

  it('anthropic-api: sets ANTHROPIC_API_KEY from settings, clears ANTHROPIC_BASE_URL', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://old-proxy.example.com';

    const { providerEnv } = await import('../src/server/session-manager.js');
    const session = makeSession({ provider: 'anthropic-api' });
    const settings = makeSettings({ anthropic_api_key: 'sk-ant-test123' });
    const env = providerEnv(session, settings);

    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test123');
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    // process.env unmutated
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://old-proxy.example.com');
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('openrouter: sets both ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL', async () => {
    const { providerEnv } = await import('../src/server/session-manager.js');
    const session = makeSession({ provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' });
    const settings = makeSettings({ openrouter_api_key: 'sk-or-test456' });
    const env = providerEnv(session, settings);

    expect(env.ANTHROPIC_API_KEY).toBe('sk-or-test456');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://openrouter.ai/api/v1');
  });

  // ---------------------------------------------------------------------------
  // Missing-key error paths
  // ---------------------------------------------------------------------------

  it('anthropic-api: throws when anthropic_api_key is missing from settings', async () => {
    const { providerEnv } = await import('../src/server/session-manager.js');
    const session = makeSession({ provider: 'anthropic-api' });
    const settings = makeSettings({ anthropic_api_key: undefined });

    expect(() => providerEnv(session, settings)).toThrow(/anthropic_api_key/);
  });

  it('anthropic-api: error message includes session id', async () => {
    const { providerEnv } = await import('../src/server/session-manager.js');
    const session = makeSession({ id: 'my-session-id', provider: 'anthropic-api' });
    const settings = makeSettings({});

    expect(() => providerEnv(session, settings)).toThrow(/my-session-id/);
  });

  it('openrouter: throws when openrouter_api_key is missing from settings', async () => {
    const { providerEnv } = await import('../src/server/session-manager.js');
    const session = makeSession({ provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' });
    const settings = makeSettings({ openrouter_api_key: undefined });

    expect(() => providerEnv(session, settings)).toThrow(/openrouter_api_key/);
  });

  it('openrouter: error message includes session id', async () => {
    const { providerEnv } = await import('../src/server/session-manager.js');
    const session = makeSession({ id: 'or-session', provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' });
    const settings = makeSettings({});

    expect(() => providerEnv(session, settings)).toThrow(/or-session/);
  });

  // ---------------------------------------------------------------------------
  // "Snapshot/restore" behaviour: returned env is a fresh copy; process.env
  // remains unchanged regardless of what providerEnv writes into the copy.
  // ---------------------------------------------------------------------------

  it('originally-undefined vars are absent in the copy when deleted', async () => {
    // Ensure the key is not set at all in process.env.
    delete process.env.ANTHROPIC_API_KEY;

    const { providerEnv } = await import('../src/server/session-manager.js');
    const env = providerEnv(
      makeSession({ provider: 'subscription' }),
      makeSettings({}),
    );

    // The returned copy should not have the key.
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    // And process.env itself was not touched.
    expect(Object.prototype.hasOwnProperty.call(process.env, 'ANTHROPIC_API_KEY')).toBe(false);
  });

  it('originally-set vars survive in process.env after providerEnv returns', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-original';

    const { providerEnv } = await import('../src/server/session-manager.js');
    // subscription provider deletes the key from the *copy*, not process.env.
    providerEnv(makeSession({ provider: 'subscription' }), makeSettings({}));

    // process.env must still hold the original value.
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-original');
  });
});

// ---------------------------------------------------------------------------
// SessionManager.send() – finally cleanup after mid-stream throw
// ---------------------------------------------------------------------------

describe('SessionManager.send() finally cleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes session from inflight map even when the query iterator throws mid-stream', async () => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const { SessionManager } = await import('../src/server/session-manager.js');

    // Simulate an iterator that throws on the second item.
    async function* failingQuery() {
      yield { type: 'result', session_id: 'uuid-1' };
      throw new Error('simulated mid-stream failure');
    }
    (query as ReturnType<typeof vi.fn>).mockReturnValue(failingQuery());

    const cfg = {
      projects: [{
        id: 'proj-1',
        label: 'Project',
        color: '#3b82f6',
        sessions: [{
          id: 'sess-1',
          label: 'Session',
          color: '#ffffff',
          project_dir: '/tmp',
          provider: 'subscription' as const,
          voice_mode: false,
          tts_rate: 1.2,
          stt_backend: 'browser' as const,
        }],
      }],
    };

    const settings = makeSettings({});

    // Minimal State double.
    const state = {
      getCcSessionId: () => undefined,
      setCcSessionId: async () => {},
      setLastResponse: async () => {},
      patchSession: async () => {},
    } as any;

    const manager = new SessionManager(cfg, settings, state);

    // Consume the generator; expect it to throw.
    const gen = manager.send('sess-1', 'hello');
    await expect(async () => {
      for await (const _chunk of gen) { /* drain */ }
    }).rejects.toThrow('simulated mid-stream failure');

    // After the throw the finally block must have fired, clearing inflight.
    // We verify indirectly: starting a new send for the same session should
    // work (no stale AbortController interference) and the mock is called again.
    (query as ReturnType<typeof vi.fn>).mockReturnValue((async function* () {
      yield { type: 'result', session_id: 'uuid-2' };
    })());

    const gen2 = manager.send('sess-1', 'world');
    const chunks: any[] = [];
    for await (const chunk of gen2) {
      chunks.push(chunk);
    }
    // If finally cleaned up properly, the second send completes without error.
    expect(query).toHaveBeenCalledTimes(2);
  });
});
