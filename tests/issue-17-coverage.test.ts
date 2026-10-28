/**
 * Tests for Issue #17 — Settings feature coverage gaps.
 *
 * Five bullets:
 *   1. Settings.publicSafe() redaction after set('anthropic_api_key', ...)
 *   2. updateSession rejecting provider:'openrouter' without a model
 *   3. Multi-client broadcast integration (settings change reaches all peers)
 *   4. normalizeGlobalPatch empty-string normalization unit test
 *   5. SessionPatch model normalization (empty string → undefined) in ws.ts session branch
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ─── 1. Settings.publicSafe() redaction ────────────────────────────────────

import { Settings } from '../src/server/settings.js';

describe('Settings.publicSafe() redaction', () => {
  const tmp = path.join(os.tmpdir(), `dv-settings-17-${Date.now()}.json`);

  beforeEach(async () => {
    try { await fs.unlink(tmp); } catch { /* not found is fine */ }
  });

  afterEach(async () => {
    try { await fs.unlink(tmp); } catch { /* cleanup */ }
  });

  it('publicSafe() does NOT expose raw anthropic_api_key after set()', async () => {
    const s = await Settings.load(tmp);
    await s.set('anthropic_api_key', 'sk-ant-supersecret');

    const safe = s.publicSafe();

    // The raw key must not appear anywhere in the serialised output.
    expect(JSON.stringify(safe)).not.toContain('sk-ant-supersecret');
    // But the has_* flag must be true.
    expect(safe.has_anthropic_key).toBe(true);
    // The other key flag stays false.
    expect(safe.has_openrouter_key).toBe(false);
  });

  it('publicSafe() reflects has_openrouter_key after setting openrouter key', async () => {
    const s = await Settings.load(tmp);
    await s.set('openrouter_api_key', 'sk-or-secret');

    const safe = s.publicSafe();

    expect(JSON.stringify(safe)).not.toContain('sk-or-secret');
    expect(safe.has_openrouter_key).toBe(true);
    expect(safe.has_anthropic_key).toBe(false);
  });

  it('publicSafe() has_anthropic_key is false when key is cleared', async () => {
    const s = await Settings.load(tmp);
    await s.set('anthropic_api_key', 'sk-ant-temp');
    // Clear by patching to undefined
    await s.patch({ anthropic_api_key: undefined });

    const safe = s.publicSafe();
    expect(safe.has_anthropic_key).toBe(false);
  });
});

// ─── 2. updateSession rejecting openrouter without model ───────────────────

import { updateSession } from '../src/server/config.js';

describe('updateSession — openrouter without model rejection', () => {
  let tmpDir: string;
  let cfgPath: string;

  const BASE = {
    projects: [{
      id: 'p1', label: 'P', color: '#3b82f6',
      sessions: [
        { id: 'sub', label: 'Sub', color: '#ffffff', project_dir: '/tmp', provider: 'subscription' },
        { id: 'or', label: 'OR', color: '#ffffff', project_dir: '/tmp', provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' },
      ],
    }],
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dv-cfg-17-'));
    cfgPath = path.join(tmpDir, 'config.json');
    await fs.writeFile(cfgPath, JSON.stringify(BASE));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects patching a session to openrouter without a model', async () => {
    // Patch a subscription session to openrouter but omit the model.
    await expect(
      updateSession(cfgPath, 'sub', { provider: 'openrouter' }),
    ).rejects.toThrow(/model/i);
  });

  it('rejects clearing the model when provider is already openrouter', async () => {
    // The 'or' session has provider:openrouter + model. Clearing the model must fail.
    await expect(
      updateSession(cfgPath, 'or', { model: undefined }),
    ).rejects.toThrow(/model/i);
  });

  it('allows patching to openrouter when model is supplied in the same patch', async () => {
    await expect(
      updateSession(cfgPath, 'sub', { provider: 'openrouter', model: 'anthropic/claude-3-haiku' }),
    ).resolves.toBeUndefined();
  });
});

// ─── 3. Multi-client broadcast integration ─────────────────────────────────

import { handleClientMessage } from '../src/server/ws.js';
import type { ServerMessage } from '../shared/protocol.js';
import type { Config } from '../src/server/config.js';

const BASE_CONFIG_MULTI: Config = {
  projects: [{
    id: 'proj-1', label: 'Project One', color: '#3b82f6',
    sessions: [{
      id: 'sess-1', label: 'Session One', color: '#ff0000',
      project_dir: '/tmp', provider: 'subscription', voice_mode: true, tts_rate: 1.2,
    }],
  }],
} as Config;

/** Build a per-client message collector. */
function makeClient() {
  const received: ServerMessage[] = [];
  return {
    received,
    send: (m: ServerMessage) => received.push(m),
  };
}

describe('Multi-client broadcast — settings_changed reaches all peers', () => {
  it('broadcasts a global settings change to every connected client', async () => {
    const clientA = makeClient();
    const clientB = makeClient();
    const clientC = makeClient();

    // Simulate three connected peers (e.g. phone + tablet + desktop).
    const allClients = [clientA, clientB, clientC];
    const broadcasts: ServerMessage[] = [];

    // Each client shares the same broadcast function (as in the real server).
    const broadcast = (m: ServerMessage) => {
      broadcasts.push(m);
      allClients.forEach((c) => c.send(m));
    };

    const sharedSettings = {
      get: (_k: string) => undefined,
      patch: async (_p: any) => {},
      publicSafe: () => ({
        default_provider: 'subscription' as const,
        theme: 'dark' as const,
        haptics: true,
        has_anthropic_key: false,
        has_openrouter_key: false,
      }),
    } as any;

    // Use clientA as the "sending" client.
    const ctx = {
      send: clientA.send,
      broadcast,
      sessions: {} as any,
      getCfg: () => BASE_CONFIG_MULTI,
      cfg: BASE_CONFIG_MULTI,
      configPath: '',
      settings: sharedSettings,
      updateSessionConfig: async () => {},
      peers: () => [],
    };

    await handleClientMessage(ctx as any, {
      type: 'update_settings',
      scope: 'global',
      patch: { theme: 'dark' },
    } as any);

    // Every client must have received exactly one settings_changed broadcast.
    for (const client of allClients) {
      const settingsMessages = client.received.filter((m) => m.type === 'settings_changed');
      expect(settingsMessages).toHaveLength(1);
      const msg = settingsMessages[0] as any;
      expect(msg.scope).toBe('global');
      expect(msg.patch.theme).toBe('dark');
    }
  });

  it('broadcasts a session settings change to every connected client', async () => {
    const clientA = makeClient();
    const clientB = makeClient();
    const allClients = [clientA, clientB];

    const broadcast = (m: ServerMessage) => allClients.forEach((c) => c.send(m));

    const ctx = {
      send: clientA.send,
      broadcast,
      sessions: {} as any,
      getCfg: () => BASE_CONFIG_MULTI,
      cfg: BASE_CONFIG_MULTI,
      configPath: '',
      settings: { patch: async () => {}, publicSafe: () => ({}) } as any,
      updateSessionConfig: async (_id: string, _patch: any) => {},
      peers: () => [],
    };

    await handleClientMessage(ctx as any, {
      type: 'update_settings',
      scope: 'session',
      session_id: 'sess-1',
      patch: { tts_rate: 1.8 },
    } as any);

    for (const client of allClients) {
      const msgs = client.received.filter((m) => m.type === 'settings_changed');
      expect(msgs).toHaveLength(1);
      const msg = msgs[0] as any;
      expect(msg.scope).toBe('session');
      expect(msg.session_id).toBe('sess-1');
      expect(msg.patch.tts_rate).toBe(1.8);
    }
  });
});

// ─── 4. normalizeGlobalPatch empty-string normalization ─────────────────────

import { normalizeGlobalPatch } from '../src/server/ws.js';

describe('normalizeGlobalPatch', () => {
  it('converts empty anthropic_api_key to undefined', () => {
    const result = normalizeGlobalPatch({ anthropic_api_key: '' });
    expect(result.anthropic_api_key).toBeUndefined();
  });

  it('converts empty openrouter_api_key to undefined', () => {
    const result = normalizeGlobalPatch({ openrouter_api_key: '' });
    expect(result.openrouter_api_key).toBeUndefined();
  });

  it('leaves non-empty keys untouched', () => {
    const result = normalizeGlobalPatch({ anthropic_api_key: 'sk-ant-abc', openrouter_api_key: 'sk-or-def' });
    expect(result.anthropic_api_key).toBe('sk-ant-abc');
    expect(result.openrouter_api_key).toBe('sk-or-def');
  });

  it('passes through fields not related to API keys', () => {
    const result = normalizeGlobalPatch({ theme: 'dark', haptics: false });
    expect(result.theme).toBe('dark');
    expect(result.haptics).toBe(false);
  });

  it('both keys empty at the same time both become undefined', () => {
    const result = normalizeGlobalPatch({ anthropic_api_key: '', openrouter_api_key: '' });
    expect(result.anthropic_api_key).toBeUndefined();
    expect(result.openrouter_api_key).toBeUndefined();
  });
});

// ─── 5. SessionPatch model normalization (empty string → undefined) ─────────

describe('SessionPatch model normalization — empty string clears model', () => {
  it('empty model string is normalised to undefined before updateSessionConfig is called', async () => {
    const capturedPatches: any[] = [];
    const ctx = {
      send: () => {},
      broadcast: () => {},
      sessions: {} as any,
      getCfg: () => BASE_CONFIG_MULTI,
      cfg: BASE_CONFIG_MULTI,
      configPath: '',
      settings: { patch: async () => {}, publicSafe: () => ({}) } as any,
      updateSessionConfig: async (_id: string, patch: any) => { capturedPatches.push(patch); },
      peers: () => [],
    };

    await handleClientMessage(ctx as any, {
      type: 'update_settings',
      scope: 'session',
      session_id: 'sess-1',
      patch: { model: '' },
    } as any);

    expect(capturedPatches).toHaveLength(1);
    expect(capturedPatches[0].model).toBeUndefined();
  });

  it('non-empty model string is passed through unchanged', async () => {
    const capturedPatches: any[] = [];
    const ctx = {
      send: () => {},
      broadcast: () => {},
      sessions: {} as any,
      getCfg: () => BASE_CONFIG_MULTI,
      cfg: BASE_CONFIG_MULTI,
      configPath: '',
      settings: { patch: async () => {}, publicSafe: () => ({}) } as any,
      updateSessionConfig: async (_id: string, patch: any) => { capturedPatches.push(patch); },
      peers: () => [],
    };

    await handleClientMessage(ctx as any, {
      type: 'update_settings',
      scope: 'session',
      session_id: 'sess-1',
      patch: { model: 'anthropic/claude-3.5-sonnet' },
    } as any);

    expect(capturedPatches).toHaveLength(1);
    expect(capturedPatches[0].model).toBe('anthropic/claude-3.5-sonnet');
  });

  it('broadcast reflects the normalised (undefined) model after clearing', async () => {
    const broadcasts: ServerMessage[] = [];
    const ctx = {
      send: () => {},
      broadcast: (m: ServerMessage) => broadcasts.push(m),
      sessions: {} as any,
      getCfg: () => BASE_CONFIG_MULTI,
      cfg: BASE_CONFIG_MULTI,
      configPath: '',
      settings: { patch: async () => {}, publicSafe: () => ({}) } as any,
      updateSessionConfig: async () => {},
      peers: () => [],
    };

    await handleClientMessage(ctx as any, {
      type: 'update_settings',
      scope: 'session',
      session_id: 'sess-1',
      patch: { model: '' },
    } as any);

    expect(broadcasts).toHaveLength(1);
    const b = broadcasts[0] as any;
    expect(b.type).toBe('settings_changed');
    expect(b.scope).toBe('session');
    expect(b.patch.model).toBeUndefined();
  });
});
