import { describe, it, expect } from 'vitest';
import { createRelayCore } from '../src/server/relay.js';
import type { DesktopToRelay } from '../shared/relay-protocol.js';
import type { Config } from '../src/server/config.js';

// Minimal config used by session_ready / http_request tests.
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

/** Build a relay core with sensible mock collaborators; caller can override. */
function makeCore(overrides: Partial<{
  sessions: any;
  cfg: Config;
  settings: any;
  updateSessionConfig: (id: string, patch: any) => Promise<void>;
}> = {}) {
  const sent: DesktopToRelay[] = [];
  const core = createRelayCore({
    sessions: overrides.sessions ?? ({} as any),
    cfg: overrides.cfg ?? makeCfg(),
    settings: overrides.settings ?? ({ publicSafe: () => ({ default_provider: 'subscription' }) } as any),
    configPath: '',
    updateSessionConfig: overrides.updateSessionConfig ?? (async () => {}),
    sendToRelay: (frame) => sent.push(frame),
  });
  return { core, sent };
}

describe('createRelayCore', () => {
  it('from_phone user_message sends cc_chunk/cc_done/say to_phone frames to the right peer', async () => {
    const fakeSessions = {
      async *send(_sid: string, _text: string) {
        yield { text: 'Hi ', final: false };
        yield { text: 'there!', final: false };
        yield { text: '', final: true };
      },
    };
    const { core, sent } = makeCore({ sessions: fakeSessions });

    // peer-a is "in" sess-1, so it's excluded from the session_ready fan-out below.
    await core.handleFrame({ type: 'from_phone', peer: 'peer-a', msg: { type: 'open_session', session_id: 'sess-1' } });
    sent.length = 0;

    await core.handleFrame({ type: 'from_phone', peer: 'peer-a', msg: { type: 'user_message', session_id: 'sess-1', text: 'hi' } });

    expect(sent).toEqual([
      { type: 'to_phone', peer: 'peer-a', msg: { type: 'cc_chunk', session_id: 'sess-1', text: 'Hi ' } },
      { type: 'to_phone', peer: 'peer-a', msg: { type: 'cc_chunk', session_id: 'sess-1', text: 'there!' } },
      { type: 'to_phone', peer: 'peer-a', msg: { type: 'cc_done', session_id: 'sess-1' } },
      { type: 'to_phone', peer: 'peer-a', msg: { type: 'say', session_id: 'sess-1', text: 'Hi there!' } },
    ]);
  });

  it('session_ready is sent to other peers only, as targeted to_phone frames', async () => {
    const fakeSessions = {
      async *send(_sid: string, _text: string) {
        yield { text: 'reply', final: false };
        yield { text: '', final: true };
      },
    };
    const { core, sent } = makeCore({ sessions: fakeSessions });

    // peer-a opens sess-1 (the session about to reply); peer-b opens something else.
    await core.handleFrame({ type: 'from_phone', peer: 'peer-a', msg: { type: 'open_session', session_id: 'sess-1' } });
    await core.handleFrame({ type: 'from_phone', peer: 'peer-b', msg: { type: 'open_session', session_id: 'other-session' } });
    sent.length = 0; // clear the two 'ready' replies

    await core.handleFrame({ type: 'from_phone', peer: 'peer-a', msg: { type: 'user_message', session_id: 'sess-1', text: 'hi' } });

    const readyFrames = sent.filter((f) => f.type === 'to_phone' && (f as any).msg.type === 'session_ready');
    expect(readyFrames).toHaveLength(1);
    expect(readyFrames[0]).toEqual({
      type: 'to_phone',
      peer: 'peer-b',
      msg: { type: 'session_ready', session_id: 'sess-1', project_id: 'proj-1', label: 'Session One', color: '#ff0000' },
    });
  });

  it('peer_gone removes state; replay after peer_gone does nothing', async () => {
    const { core, sent } = makeCore();

    await core.handleFrame({ type: 'from_phone', peer: 'peer-a', msg: { type: 'open_session', session_id: 'sess-1' } });
    await core.handleFrame({ type: 'from_phone', peer: 'peer-a', msg: { type: 'user_message', session_id: 'sess-1', text: 'hello' } });
    await core.handleFrame({ type: 'peer_gone', peer: 'peer-a' });
    sent.length = 0;

    await core.handleFrame({ type: 'from_phone', peer: 'peer-a', msg: { type: 'replay' } });

    expect(sent).toEqual([]);
  });

  it('http_request /api/config responds with toPublic(cfg)', async () => {
    const { core, sent } = makeCore();

    await core.handleFrame({ type: 'http_request', id: 'req-1', method: 'GET', path: '/api/config' });

    expect(sent).toHaveLength(1);
    const frame = sent[0] as any;
    expect(frame.type).toBe('http_response');
    expect(frame.id).toBe('req-1');
    expect(frame.status).toBe(200);
    expect(frame.body.projects[0].sessions[0].id).toBe('sess-1');
  });

  it('http_request /api/settings responds with settings.publicSafe()', async () => {
    const { core, sent } = makeCore({
      settings: { publicSafe: () => ({ default_provider: 'anthropic-api', theme: 'dark', haptics: true, has_anthropic_key: true, has_openrouter_key: false }) } as any,
    });

    await core.handleFrame({ type: 'http_request', id: 'req-2', method: 'GET', path: '/api/settings' });

    expect(sent).toEqual([
      { type: 'http_response', id: 'req-2', status: 200, body: { default_provider: 'anthropic-api', theme: 'dark', haptics: true, has_anthropic_key: true, has_openrouter_key: false } },
    ]);
  });

  it('http_request with an unknown path responds 404', async () => {
    const { core, sent } = makeCore();

    await core.handleFrame({ type: 'http_request', id: 'req-3', method: 'GET', path: '/api/nope' } as any);

    expect(sent).toEqual([{ type: 'http_response', id: 'req-3', status: 404, body: { error: 'not_found' } }]);
  });

  it('invalid from_phone message sends a to_phone error frame to that peer', async () => {
    const { core, sent } = makeCore();

    await core.handleFrame({ type: 'from_phone', peer: 'peer-a', msg: { type: 'definitely_not_real' } } as any);

    expect(sent).toEqual([{ type: 'to_phone', peer: 'peer-a', msg: { type: 'error', message: 'invalid message' } }]);
  });

  // zod 4 (>=4.4) makes a missing z.unknown() key a parse failure; the envelope keeps
  // `msg` optional so a msg-less frame still gets the explicit error, not silence.
  it('from_phone without msg still sends the invalid-message error frame', async () => {
    const { core, sent } = makeCore();

    await core.handleFrame({ type: 'from_phone', peer: 'peer-a' } as any);

    expect(sent).toEqual([{ type: 'to_phone', peer: 'peer-a', msg: { type: 'error', message: 'invalid message' } }]);
  });
});
