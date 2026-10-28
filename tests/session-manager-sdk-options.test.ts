/**
 * Pins what SessionManager hands to the Agent SDK's query(), so an SDK bump that
 * renames or re-defaults an option shows up here instead of in a live session.
 * Cancel and turn-integrity behaviour live in session-manager-hardening.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../src/server/session-manager.js';
import type { Config, SessionConfig } from '../src/server/config.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
const queryMock = vi.mocked(query);

function setup(session: Partial<SessionConfig>, storedId?: string) {
  const persisted: unknown[] = [];
  const cfg = {
    projects: [{
      id: 'p1', label: 'P', color: '#123456',
      sessions: [{
        id: 's1', label: 'S', color: '#abcdef', project_dir: '/work/repo',
        provider: 'subscription', voice_mode: false, tts_rate: 1.2, stt_backend: 'browser',
        ...session,
      }],
    }],
  } as Config;
  const state = {
    getCcSessionId: () => storedId,
    getLastResponse: () => undefined,
    patchSession: async (_sid: string, patch: unknown) => { persisted.push(patch); },
  } as any;
  const settings = { get: (k: string) => (k === 'anthropic_api_key' ? 'sk-test' : undefined) } as any;
  return { manager: new SessionManager(cfg, settings, state), persisted };
}

async function run(manager: SessionManager, text = 'hi') {
  const chunks = [];
  for await (const c of manager.send('s1', text)) chunks.push(c);
  return chunks;
}

/** The options object of the most recent query() call. */
const lastOptions = () => (queryMock.mock.calls.at(-1)![0] as any).options;

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(() => (async function* () {
    yield { type: 'system', subtype: 'init', session_id: 'new-uuid' };
    yield { type: 'assistant', session_id: 'new-uuid', message: { content: [{ type: 'text', text: 'ok' }] } };
    yield { type: 'result', subtype: 'success', session_id: 'new-uuid' };
  })() as any);
  process.env.RELAY_TOKEN = 'relay-secret';
  process.env.DEVICE_TOKEN_SECRET = 'device-secret';
});

afterEach(() => {
  delete process.env.RELAY_TOKEN;
  delete process.env.DEVICE_TOKEN_SECRET;
});

describe('SessionManager -> Agent SDK query() options', () => {
  it('passes prompt, cwd and the abort controller', async () => {
    const { manager } = setup({});
    await run(manager, 'do the thing');
    const call = queryMock.mock.calls[0][0] as any;
    expect(call.prompt).toBe('do the thing');
    expect(call.options.cwd).toBe('/work/repo');
    expect(call.options.abortController).toBeInstanceOf(AbortController);
  });

  it('resumes the stored Claude Code session id', async () => {
    const { manager } = setup({}, 'stored-uuid');
    await run(manager);
    expect(lastOptions().resume).toBe('stored-uuid');
  });

  it('omits resume when no session id is stored', async () => {
    const { manager } = setup({});
    await run(manager);
    expect(lastOptions()).not.toHaveProperty('resume');
  });

  it('passes the provider env without relay credentials', async () => {
    const { manager } = setup({ provider: 'anthropic-api' });
    await run(manager);
    const env = lastOptions().env;
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(env).not.toHaveProperty('RELAY_TOKEN');
    expect(env).not.toHaveProperty('DEVICE_TOKEN_SECRET');
    expect(process.env.RELAY_TOKEN).toBe('relay-secret');
  });

  it('defaults to bypassPermissions with the explicit dangerous-skip opt-in', async () => {
    const { manager } = setup({});
    await run(manager);
    expect(lastOptions().permissionMode).toBe('bypassPermissions');
    expect(lastOptions().allowDangerouslySkipPermissions).toBe(true);
  });

  it('passes a configured permission mode without the dangerous-skip flag', async () => {
    const { manager } = setup({ permission_mode: 'plan' });
    await run(manager);
    expect(lastOptions().permissionMode).toBe('plan');
    expect(lastOptions()).not.toHaveProperty('allowDangerouslySkipPermissions');
  });

  it('appends the voice instructions to the claude_code preset in voice mode', async () => {
    const { manager } = setup({ voice_mode: true });
    await run(manager);
    const sp = lastOptions().systemPrompt;
    // snapshot:false keeps 0.1.x per-request rendering: SDK >= 0.3.257 records the
    // prompt on the first request by default, so a voice_mode toggle on a resumed
    // session would otherwise be ignored until compaction.
    expect(sp).toMatchObject({ type: 'preset', preset: 'claude_code', snapshot: false });
    expect(sp.append).toMatch(/driving/);
  });

  it('leaves systemPrompt unset outside voice mode', async () => {
    const { manager } = setup({ voice_mode: false });
    await run(manager);
    expect(lastOptions()).not.toHaveProperty('systemPrompt');
  });

  it('passes the configured model, and none when unset', async () => {
    const a = setup({ model: 'claude-sonnet-4-5' });
    await run(a.manager);
    expect(lastOptions().model).toBe('claude-sonnet-4-5');
    const b = setup({});
    await run(b.manager);
    expect(lastOptions()).not.toHaveProperty('model');
  });

  it('streams assistant text and persists the captured session id with the reply', async () => {
    const { manager, persisted } = setup({}, 'stored-uuid');
    const chunks = await run(manager);
    expect(chunks).toEqual([{ text: 'ok', final: false }, { text: '', final: true }]);
    expect(persisted).toEqual([{ ccSessionId: 'new-uuid', lastResponse: 'ok' }]);
  });

  // SDK >= 0.2: an abort that lands during a hook ends the turn with a normal
  // `result` message instead of throwing (CHANGELOG "Fixed SDK hook callbacks
  // swallowing abort signals"). It must still read as a cancel, not a finished turn.
  it('reports a cancel as cancelled even when the SDK ends the turn with a result', async () => {
    let started!: () => void;
    const didStart = new Promise<void>((r) => { started = r; });
    queryMock.mockImplementation(({ options }: any) => (async function* () {
      started();
      await new Promise<void>((r) => options.abortController.signal.addEventListener('abort', () => r(), { once: true }));
      yield { type: 'result', subtype: 'success', session_id: 'new-uuid' };
    })() as any);
    const { manager } = setup({});
    const it = manager.send('s1', 'hi')[Symbol.asyncIterator]();
    const pending = it.next();
    await didStart;
    manager.cancel('s1');
    expect((await pending).value).toEqual({ text: '', final: true, cancelled: true });
    expect((await it.next()).done).toBe(true);
  });

  // SDK >= 0.2 loads user/project/local settings when settingSources is omitted
  // (0.1.x loaded none). A user settings.json `env` block or hooks would then
  // apply to every phone turn and can override the provider env, so stay isolated.
  it('keeps filesystem settings isolated', async () => {
    const { manager } = setup({});
    await run(manager);
    expect(lastOptions().settingSources).toEqual([]);
  });

  it('does not re-persist an unchanged session id', async () => {
    const { manager, persisted } = setup({}, 'new-uuid');
    await run(manager);
    expect(persisted).toEqual([{ ccSessionId: undefined, lastResponse: 'ok' }]);
  });
});
