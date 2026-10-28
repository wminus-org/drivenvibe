import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleClientMessage } from '../src/server/ws.js';
import type { ClientMessage, ServerMessage } from '../shared/protocol.js';
import type { Config } from '../src/server/config.js';
import { loadConfig } from '../src/server/config.js';
import { ClientMessageSchema } from '../src/server/client-message-schema.js';

// Minimal config used by mutation tests.
const BASE_CONFIG = {
  projects: [
    {
      id: 'proj-1',
      label: 'Project One',
      color: '#3b82f6',
      sessions: [
        {
          id: 'sess-1',
          label: 'Session One',
          color: '#ff0000',
          project_dir: '/tmp',
          provider: 'subscription',
          voice_mode: true,
          tts_rate: 1.2,
        },
      ],
    },
  ],
};

function makeCfg(): Config {
  return JSON.parse(JSON.stringify(BASE_CONFIG)) as Config;
}

/** Build a minimal ctx with sensible defaults; caller can override. */
function makeCtx(overrides: Partial<{
  send: (m: ServerMessage) => void;
  broadcast: (m: ServerMessage) => void;
  sent: ServerMessage[];
  broadcasts: ServerMessage[];
  sessions: any;
  cfg: Config;
  configPath: string;
  settings: any;
  updateSessionConfig: (id: string, patch: any) => Promise<void>;
  peers: () => Iterable<{ send: (m: ServerMessage) => void; currentSession: string | null }>;
}> = {}) {
  const sent: ServerMessage[] = overrides.sent ?? [];
  const broadcasts: ServerMessage[] = overrides.broadcasts ?? [];
  return {
    send: overrides.send ?? ((m: ServerMessage) => sent.push(m)),
    broadcast: overrides.broadcast ?? ((m: ServerMessage) => broadcasts.push(m)),
    sessions: overrides.sessions ?? ({} as any),
    getCfg: () => overrides.cfg ?? makeCfg(),
    cfg: overrides.cfg ?? makeCfg(),
    configPath: overrides.configPath ?? '',
    settings: overrides.settings ?? ({} as any),
    updateSessionConfig: overrides.updateSessionConfig ?? (async () => {}),
    peers: overrides.peers ?? (() => []),
    _sent: sent,
    _broadcasts: broadcasts,
  };
}

describe('handleClientMessage', () => {
  it('replays last response via say', async () => {
    const ctx = makeCtx();
    const state = { current_session: 'demo', last_response: 'hello world' };
    await handleClientMessage(ctx as any, { type: 'replay' }, state);
    expect(ctx._sent).toEqual([{ type: 'say', session_id: 'demo', text: 'hello world' }]);
  });

  it('open_session sends ready', async () => {
    const ctx = makeCtx();
    await handleClientMessage(ctx as any, { type: 'open_session', session_id: 'demo' } as ClientMessage);
    expect(ctx._sent).toEqual([{ type: 'ready' }]);
  });

  it('cancel aborts the in-flight turn for the current session', async () => {
    let cancelled: string | null = null;
    const ctx = makeCtx({ sessions: { cancel: (id: string) => { cancelled = id; } } as any });
    const state = { current_session: 'sess-1', last_response: '' };
    await handleClientMessage(ctx as any, { type: 'cancel' }, state);
    expect(cancelled).toBe('sess-1');
  });

  it('cancel with no open session is a no-op', async () => {
    let called = false;
    const ctx = makeCtx({ sessions: { cancel: () => { called = true; } } as any });
    await handleClientMessage(ctx as any, { type: 'cancel' }, { current_session: null, last_response: '' });
    expect(called).toBe(false);
  });

  it('user_message routes through sessions.send and emits say with collected text', async () => {
    const fakeSessions = {
      async *send(_sid: string, _text: string) {
        yield { text: 'Hi ', final: false };
        yield { text: 'there!', final: false };
        yield { text: '', final: true };
      },
    } as any;
    const cfg = makeCfg();
    const ctx = makeCtx({ sessions: fakeSessions, cfg });
    await handleClientMessage(ctx as any, { type: 'user_message', session_id: 'sess-1', text: 'hello' });
    expect(ctx._sent).toEqual([
      { type: 'cc_chunk', session_id: 'sess-1', text: 'Hi ' },
      { type: 'cc_chunk', session_id: 'sess-1', text: 'there!' },
      { type: 'cc_done', session_id: 'sess-1' },
      { type: 'say', session_id: 'sess-1', text: 'Hi there!' },
    ]);
  });

  it('user_message with empty text just sends cc_done, no say', async () => {
    const ctx = makeCtx();
    await handleClientMessage(ctx as any, { type: 'user_message', session_id: 'demo', text: '   ' });
    expect(ctx._sent).toEqual([{ type: 'cc_done', session_id: 'demo' }]);
  });

  it('user_message includes session_id in cc_chunk/cc_done/say messages', async () => {
    const fakeSessions = {
      async *send(_sid: string, _text: string) {
        yield { text: 'hello', final: false };
        yield { text: '', final: true };
      },
    } as any;
    const cfg = makeCfg();
    const ctx = makeCtx({ sessions: fakeSessions, cfg });
    await handleClientMessage(ctx as any, { type: 'user_message', session_id: 'sess-1', text: 'hi' });
    const types = ctx._sent.map((m: any) => m.type);
    expect(types).toEqual(['cc_chunk', 'cc_done', 'say']);
    for (const m of ctx._sent as any[]) {
      expect(m.session_id).toBe('sess-1');
    }
  });

  it('user_message dispatches session_ready to peers not in that session', async () => {
    const fakeSessions = {
      async *send(_sid: string, _text: string) {
        yield { text: 'reply', final: false };
        yield { text: '', final: true };
      },
    } as any;
    const cfg = makeCfg();
    const peerSent: ServerMessage[] = [];
    const peersData = [
      { send: (m: ServerMessage) => peerSent.push(m), currentSession: 'other-session' },
      { send: (_m: ServerMessage) => {}, currentSession: 'sess-1' },
    ];
    const ctx = makeCtx({ sessions: fakeSessions, cfg, peers: () => peersData });
    await handleClientMessage(ctx as any, { type: 'user_message', session_id: 'sess-1', text: 'hi' });
    expect(peerSent).toHaveLength(1);
    expect(peerSent[0]).toEqual({
      type: 'session_ready',
      session_id: 'sess-1',
      project_id: 'proj-1',
      label: 'Session One',
      color: '#ff0000',
    });
  });

  it('user_message does NOT dispatch session_ready to the peer currently in that session', async () => {
    const fakeSessions = {
      async *send(_sid: string, _text: string) {
        yield { text: 'reply', final: false };
        yield { text: '', final: true };
      },
    } as any;
    const cfg = makeCfg();
    const sessionPeerSent: ServerMessage[] = [];
    const peersData = [
      { send: (m: ServerMessage) => sessionPeerSent.push(m), currentSession: 'sess-1' },
    ];
    const ctx = makeCtx({ sessions: fakeSessions, cfg, peers: () => peersData });
    await handleClientMessage(ctx as any, { type: 'user_message', session_id: 'sess-1', text: 'hi' });
    const readyMsgs = sessionPeerSent.filter((m) => m.type === 'session_ready');
    expect(readyMsgs).toHaveLength(0);
  });

  it('update_settings global writes to settings store and broadcasts public patch', async () => {
    let savedGlobal: any = null;
    const ctx = makeCtx({
      settings: {
        get: (k: string) => k === 'anthropic_api_key' ? 'sk-old' : undefined,
        patch: async (p: any) => { savedGlobal = p; },
        publicSafe: () => ({ default_provider: 'subscription', theme: 'auto', haptics: true, has_anthropic_key: true, has_openrouter_key: false }),
      } as any,
      updateSessionConfig: async () => { throw new Error('should not be called'); },
    });
    const msg: ClientMessage = {
      type: 'update_settings', scope: 'global',
      patch: { anthropic_api_key: 'sk-new', theme: 'dark' },
    } as any;
    await handleClientMessage(ctx as any, msg);
    expect(savedGlobal).toEqual({ anthropic_api_key: 'sk-new', theme: 'dark' });
    expect(ctx._broadcasts).toHaveLength(1);
    const b = ctx._broadcasts[0] as any;
    expect(b.type).toBe('settings_changed');
    expect(b.scope).toBe('global');
    // public patch must not contain raw keys
    expect(JSON.stringify(b.patch)).not.toContain('sk-new');
    // it should reflect that the key is now set
    expect(b.patch.has_anthropic_key).toBe(true);
    expect(b.patch.theme).toBe('dark');
  });

  it('update_settings session calls updateSessionConfig and broadcasts the patch', async () => {
    let saved: { id?: string; patch?: any } = {};
    const ctx = makeCtx({
      updateSessionConfig: async (id: string, patch: any) => { saved = { id, patch }; },
      settings: { patch: async () => {}, publicSafe: () => ({}) } as any,
    });
    const msg: ClientMessage = {
      type: 'update_settings', scope: 'session', session_id: 'demo',
      patch: { tts_rate: 1.4 },
    } as any;
    await handleClientMessage(ctx as any, msg);
    expect(saved).toEqual({ id: 'demo', patch: { tts_rate: 1.4 } });
    expect(ctx._broadcasts).toHaveLength(1);
    const b = ctx._broadcasts[0] as any;
    expect(b).toEqual({ type: 'settings_changed', scope: 'session', session_id: 'demo', patch: { tts_rate: 1.4 } });
  });

  it('update_settings rejects api keys with empty string by treating as "clear"', async () => {
    let savedGlobal: any = null;
    const ctx = makeCtx({
      settings: {
        get: () => undefined,
        patch: async (p: any) => { savedGlobal = p; },
        publicSafe: () => ({ default_provider: 'subscription', theme: 'auto', haptics: true, has_anthropic_key: false, has_openrouter_key: false }),
      } as any,
    });
    await handleClientMessage(ctx as any, {
      type: 'update_settings', scope: 'global', patch: { anthropic_api_key: '' },
    } as any);
    // Empty string clears the key (settings store sees it as undefined).
    expect(savedGlobal).toEqual({ anthropic_api_key: undefined });
    expect((ctx._broadcasts[0] as any).patch.has_anthropic_key).toBe(false);
  });

  // --- Config mutation tests (use real tmp files) ---

  let tmpDir: string;
  let cfgPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-test-'));
    cfgPath = path.join(tmpDir, 'config.json');
    await fs.writeFile(cfgPath, JSON.stringify(BASE_CONFIG));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('add_session adds session and broadcasts config_changed', async () => {
    const ctx = makeCtx({ configPath: cfgPath });
    const msg: ClientMessage = {
      type: 'add_session',
      project_id: 'proj-1',
      payload: { label: 'New Session', color: '#00ff00', project_dir: '/home/user/myproject' },
    };
    await handleClientMessage(ctx as any, msg);
    expect(ctx._broadcasts).toHaveLength(1);
    const b = ctx._broadcasts[0] as any;
    expect(b.type).toBe('config_changed');
    expect(b.config.projects[0].sessions).toHaveLength(2);
    expect(b.config.projects[0].sessions[1].label).toBe('New Session');
    // verify it was written to disk
    const fresh = await loadConfig(cfgPath);
    expect(fresh.projects[0].sessions).toHaveLength(2);
  });

  it('add_project adds project and broadcasts config_changed', async () => {
    const ctx = makeCtx({ configPath: cfgPath });
    const msg: ClientMessage = {
      type: 'add_project',
      payload: { label: 'New Project', color: '#abcdef' },
    };
    await handleClientMessage(ctx as any, msg);
    expect(ctx._broadcasts).toHaveLength(1);
    const b = ctx._broadcasts[0] as any;
    expect(b.type).toBe('config_changed');
    expect(b.config.projects).toHaveLength(2);
    expect(b.config.projects[1].label).toBe('New Project');
    const fresh = await loadConfig(cfgPath);
    expect(fresh.projects).toHaveLength(2);
  });

  it('archive_session archives and broadcasts config_changed', async () => {
    const ctx = makeCtx({ configPath: cfgPath });
    const msg: ClientMessage = { type: 'archive_session', session_id: 'sess-1' };
    await handleClientMessage(ctx as any, msg);
    expect(ctx._broadcasts).toHaveLength(1);
    const b = ctx._broadcasts[0] as any;
    expect(b.type).toBe('config_changed');
    // archived sessions are filtered from public view
    expect(b.config.projects[0].sessions).toHaveLength(0);
    const fresh = await loadConfig(cfgPath);
    expect(fresh.projects[0].sessions[0].archived).toBe(true);
  });

  it('unarchive_session unarchives and broadcasts config_changed', async () => {
    // First archive it on disk
    const archived = JSON.parse(JSON.stringify(BASE_CONFIG));
    archived.projects[0].sessions[0].archived = true;
    await fs.writeFile(cfgPath, JSON.stringify(archived));

    const ctx = makeCtx({ configPath: cfgPath });
    const msg: ClientMessage = { type: 'unarchive_session', session_id: 'sess-1' };
    await handleClientMessage(ctx as any, msg);
    expect(ctx._broadcasts).toHaveLength(1);
    const b = ctx._broadcasts[0] as any;
    expect(b.type).toBe('config_changed');
    expect(b.config.projects[0].sessions).toHaveLength(1);
    const fresh = await loadConfig(cfgPath);
    expect(fresh.projects[0].sessions[0].archived).toBeUndefined();
  });
});

describe('ClientMessageSchema (wire validation)', () => {
  it('accepts a valid user_message', () => {
    expect(ClientMessageSchema.safeParse({ type: 'user_message', session_id: 's', text: 'hi' }).success).toBe(true);
  });

  it('rejects an unknown message type', () => {
    expect(ClientMessageSchema.safeParse({ type: 'definitely_not_real' }).success).toBe(false);
  });

  it('rejects open_session without a session_id', () => {
    expect(ClientMessageSchema.safeParse({ type: 'open_session' }).success).toBe(false);
  });

  it('rejects a global settings patch with unknown fields (e.g. prototype pollution)', () => {
    expect(ClientMessageSchema.safeParse({
      type: 'update_settings', scope: 'global', patch: { isAdmin: true },
    }).success).toBe(false);
  });

  it('accepts a valid session settings patch', () => {
    expect(ClientMessageSchema.safeParse({
      type: 'update_settings', scope: 'session', session_id: 's', patch: { tts_rate: 1.4 },
    }).success).toBe(true);
  });

  it('accepts codex in global and session settings patches', () => {
    expect(ClientMessageSchema.safeParse({
      type: 'update_settings', scope: 'global', patch: { default_provider: 'codex' },
    }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({
      type: 'update_settings', scope: 'session', session_id: 's', patch: { provider: 'codex' },
    }).success).toBe(true);
  });

  it('rejects add_session with a malformed color', () => {
    expect(ClientMessageSchema.safeParse({
      type: 'add_session', project_id: 'p', payload: { label: 'X', color: 'red', project_dir: '/tmp' },
    }).success).toBe(false);
  });
});
