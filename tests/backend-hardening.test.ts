import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addProject, addSession, loadConfig, type Config } from '../src/server/config.js';
import { Settings } from '../src/server/settings.js';
import { State } from '../src/server/state.js';
import { ClientMessageSchema, MAX_USER_MESSAGE_CHARS } from '../src/server/client-message-schema.js';
import { isAllowedWebSocketOrigin, WsHub } from '../src/server/ws.js';
import { buildRelayWebSocketUrl, createRelayCore } from '../src/server/relay.js';
import { startNamedTunnel } from '../src/server/tunnel.js';
import { createHttp } from '../src/server/http.js';

const tempDirs: string[] = [];

async function tempFile(name: string): Promise<{ dir: string; file: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dv-hardening-'));
  tempDirs.push(dir);
  return { dir, file: path.join(dir, name) };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const BASE_CONFIG = {
  projects: [{
    id: 'p1', label: 'Project', color: '#123456',
    sessions: [{ id: 's1', label: 'Session', color: '#abcdef', project_dir: '/tmp' }],
  }],
};

describe('durable concurrent stores', () => {
  it('does not lose simultaneous config mutations', async () => {
    const { file } = await tempFile('config.json');
    await fs.writeFile(file, JSON.stringify(BASE_CONFIG));

    await Promise.all([
      ...Array.from({ length: 8 }, (_, i) => addProject(file, {
        label: `Project ${i}`, color: '#112233',
      })),
      ...Array.from({ length: 8 }, (_, i) => addSession(file, 'p1', {
        label: `Session ${i}`, color: '#445566', project_dir: `/tmp/${i}`,
      })),
    ]);

    const loaded = await loadConfig(file);
    expect(loaded.projects).toHaveLength(9);
    expect(loaded.projects[0].sessions).toHaveLength(9);
  });

  it('serializes settings snapshots in invocation order', async () => {
    const { dir, file } = await tempFile('settings.json');
    const settings = await Settings.load(file);
    await Promise.all([
      settings.set('theme', 'dark'),
      settings.set('haptics', false),
      settings.set('anthropic_api_key', 'sk-ant-test-value'),
      settings.set('openrouter_api_key', 'sk-or-test-value'),
    ]);

    const loaded = await Settings.load(file);
    expect(loaded.publicSafe()).toEqual({
      default_provider: 'subscription',
      theme: 'dark',
      haptics: false,
      has_anthropic_key: true,
      has_openrouter_key: true,
    });
    expect((await fs.readdir(dir)).some((entry) => entry.endsWith('.tmp'))).toBe(false);
  });

  it('retains every concurrent session-state update', async () => {
    const { file } = await tempFile('state.json');
    const state = await State.load(file);
    await Promise.all(Array.from({ length: 12 }, async (_, i) => {
      await Promise.all([
        state.setCcSessionId(`s${i}`, `uuid-${i}`),
        state.setLastResponse(`s${i}`, `response-${i}`),
      ]);
    }));

    const loaded = await State.load(file);
    for (let i = 0; i < 12; i += 1) {
      expect(loaded.getCcSessionId(`s${i}`)).toBe(`uuid-${i}`);
      expect(loaded.getLastResponse(`s${i}`)).toBe(`response-${i}`);
    }
  });

  it('rejects structurally corrupt state instead of failing later', async () => {
    const { file } = await tempFile('state.json');
    await fs.writeFile(file, JSON.stringify({ cc_session_ids: { s1: 42 }, last_responses: {} }));
    await expect(State.load(file)).rejects.toThrow();
  });
});

describe('protocol boundaries', () => {
  it('allows same-origin browser sockets and native clients, but rejects cross-site origins', () => {
    expect(isAllowedWebSocketOrigin(undefined, 'localhost:8787')).toBe(true);
    expect(isAllowedWebSocketOrigin('https://localhost:8787', 'localhost:8787')).toBe(true);
    expect(isAllowedWebSocketOrigin('https://evil.example', 'localhost:8787')).toBe(false);
    expect(isAllowedWebSocketOrigin('null', 'localhost:8787')).toBe(false);
  });

  it('bounds user-controlled frame content', () => {
    const valid = { type: 'user_message', session_id: 's1', text: 'x'.repeat(MAX_USER_MESSAGE_CHARS) };
    expect(ClientMessageSchema.safeParse(valid).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ ...valid, text: `${valid.text}x` }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'open_session', session_id: 'x'.repeat(257) }).success).toBe(false);
  });

  it('rejects duplicate globally-addressed session ids', async () => {
    const { file } = await tempFile('config.json');
    await fs.writeFile(file, JSON.stringify({
      projects: [
        BASE_CONFIG.projects[0],
        { id: 'p2', label: 'Other', color: '#123456', sessions: [BASE_CONFIG.projects[0].sessions[0]] },
      ],
    }));
    await expect(loadConfig(file)).rejects.toThrow(/duplicate session id/i);
  });
});

describe('relay and transport coordination', () => {
  it('normalizes relay schemes and safely encodes device tokens', () => {
    expect(buildRelayWebSocketUrl('https://relay.example/', 'a+b&c')).toBe(
      'wss://relay.example/desktop?token=a%2Bb%26c',
    );
    expect(() => buildRelayWebSocketUrl('file:///tmp/relay', 'x')).toThrow(/Relay URL/);
  });

  it('ignores malformed relay envelopes without throwing', async () => {
    const sent: unknown[] = [];
    const core = createRelayCore({
      sessions: {} as any,
      cfg: BASE_CONFIG as Config,
      settings: { publicSafe: () => ({}) } as any,
      configPath: '',
      updateSessionConfig: async () => {},
      sendToRelay: (frame) => sent.push(frame),
    });
    await expect(core.handleFrame(null)).resolves.toBeUndefined();
    await expect(core.handleFrame({ type: 'from_phone', peer: 'x'.repeat(257), msg: {} })).resolves.toBeUndefined();
    expect(sent).toEqual([]);
  });

  it('fans one broadcast out once per registered transport', () => {
    const hub = new WsHub();
    const local: unknown[] = [];
    const relay: unknown[] = [];
    hub.addBroadcaster((message) => local.push(message));
    hub.addBroadcaster((message) => relay.push(message));
    hub.broadcast({ type: 'ready' });
    expect(local).toEqual([{ type: 'ready' }]);
    expect(relay).toEqual([{ type: 'ready' }]);
  });
});

describe('server surface', () => {
  it('sets no-store and browser hardening headers on API responses', async () => {
    const { file } = await tempFile('settings.json');
    const settings = await Settings.load(file);
    const app = await createHttp(BASE_CONFIG as Config, settings);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/settings' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
    } finally {
      await app.close();
    }
  });

  it('rejects tunnel names that could escape the cloudflared directory', async () => {
    await expect(startNamedTunnel('../secrets')).rejects.toThrow(/Invalid tunnel name/);
  });
});
