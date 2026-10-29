import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleClientMessage } from '../src/server/ws.js';
import { HistoryStore, MAX_HISTORY_PAGE } from '../src/server/history.js';
import { ClientMessageSchema } from '../src/server/client-message-schema.js';
import type { ClientMessage, ServerMessage } from '../shared/protocol.js';
import type { Config } from '../src/server/config.js';

const CFG: Config = {
  projects: [{
    id: 'p', label: 'P', color: '#000000',
    sessions: [
      { id: 's1', label: 'S1', color: '#ff0000', project_dir: '/tmp' },
      { id: 's2', label: 'S2', color: '#00ff00', project_dir: '/tmp' },
    ],
  }],
} as Config;

type Chunk = { text: string; final: boolean; cancelled?: boolean };

let dir: string;
let history: HistoryStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dv-history-ws-'));
  history = new HistoryStore(path.join(dir, 'history.json'));
});
afterEach(async () => {
  await history.whenIdle();
  await fs.rm(dir, { recursive: true, force: true });
});

function makeCtx(send: (sid: string, text: string) => AsyncIterable<Chunk>, extra: Record<string, unknown> = {}) {
  const sent: ServerMessage[] = [];
  const broadcasts: ServerMessage[] = [];
  return {
    send: (m: ServerMessage) => sent.push(m),
    broadcast: (m: ServerMessage) => broadcasts.push(m),
    sessions: { send, cancel: () => {}, getLastResponse: () => undefined },
    getCfg: () => CFG,
    configPath: '',
    settings: {},
    updateSessionConfig: async () => {},
    peers: () => [],
    whisper: {},
    history,
    ...extra,
    sent,
    broadcasts,
  };
}

async function* answer(text: string): AsyncIterable<Chunk> {
  yield { text, final: false };
  yield { text: '', final: true };
}

const replies = (sent: ServerMessage[]) => sent.filter((m) => m.type === 'history') as Extract<ServerMessage, { type: 'history' }>[];

describe('history over the dispatcher', () => {
  it('records a completed turn and returns it only to the requester', async () => {
    const ctx = makeCtx(() => answer('the answer'));
    await handleClientMessage(ctx as any, { type: 'user_message', session_id: 's1', text: ' the question ' });
    await handleClientMessage(ctx as any, { type: 'get_history', session_id: 's1' });
    const [reply] = replies(ctx.sent);
    expect(reply.session_id).toBe('s1');
    expect(reply.entries.map((e) => [e.role, e.text])).toEqual([['user', 'the question'], ['assistant', 'the answer']]);
    expect(reply.has_more).toBe(false);
    expect(ctx.broadcasts.filter((m) => m.type === 'history')).toEqual([]);
  });

  it('returns only the requested session', async () => {
    const ctx = makeCtx((sid) => answer(`answer for ${sid}`));
    await handleClientMessage(ctx as any, { type: 'user_message', session_id: 's1', text: 'q1' });
    await handleClientMessage(ctx as any, { type: 'user_message', session_id: 's2', text: 'q2' });
    await handleClientMessage(ctx as any, { type: 'get_history', session_id: 's2' });
    expect(replies(ctx.sent)[0].entries.map((e) => e.text)).toEqual(['q2', 'answer for s2']);
  });

  it('clamps the limit and paginates with the before cursor', async () => {
    const ctx = makeCtx(() => answer('a'));
    for (let i = 0; i < 30; i++) {
      await handleClientMessage(ctx as any, { type: 'user_message', session_id: 's1', text: `q${i}` });
    }
    await handleClientMessage(ctx as any, { type: 'get_history', session_id: 's1', limit: 500 });
    const first = replies(ctx.sent)[0];
    expect(first.entries).toHaveLength(MAX_HISTORY_PAGE);
    expect(first.has_more).toBe(true);
    const cursor = first.entries[0].seq;
    await handleClientMessage(ctx as any, { type: 'get_history', session_id: 's1', before: cursor, limit: 50 });
    const second = replies(ctx.sent)[1];
    expect(second.before).toBe(cursor);
    expect(second.entries).toHaveLength(60 - MAX_HISTORY_PAGE);
    expect(second.entries.every((e) => e.seq < cursor)).toBe(true);
    expect(second.has_more).toBe(false);
  });

  it('answers an unknown session with an error and records nothing for it', async () => {
    const ctx = makeCtx(() => answer('x'));
    await handleClientMessage(ctx as any, { type: 'get_history', session_id: 'nope' });
    expect(ctx.sent).toEqual([{ type: 'error', message: 'Unknown session' }]);
    await handleClientMessage(ctx as any, { type: 'get_history', session_id: '__proto__' });
    expect(replies(ctx.sent)).toEqual([]);
  });

  it('never records the stale answer of a turn superseded by barge-in', async () => {
    let releaseOld!: () => void;
    const oldAborted = new Promise<void>((r) => { releaseOld = r; });
    let calls = 0;
    const ctx = makeCtx(() => {
      calls += 1;
      if (calls === 1) {
        return (async function* () {
          yield { text: 'stale partial', final: false };
          await oldAborted;
          yield { text: '', final: true, cancelled: true };
        })();
      }
      releaseOld();
      return answer('fresh answer');
    });
    const first = handleClientMessage(ctx as any, { type: 'user_message', session_id: 's1', text: 'first' });
    await new Promise((r) => setTimeout(r, 0));
    const second = handleClientMessage(ctx as any, { type: 'user_message', session_id: 's1', text: 'second' });
    await Promise.all([first, second]);
    await handleClientMessage(ctx as any, { type: 'get_history', session_id: 's1' });
    const texts = replies(ctx.sent)[0].entries.map((e) => e.text);
    expect(texts).toContain('fresh answer');
    expect(texts).toContain('first');
    expect(texts).not.toContain('stale partial');
  });

  it('records an explicitly cancelled turn with its partial answer flagged', async () => {
    const ctx = makeCtx(() => (async function* () {
      yield { text: 'half', final: false };
      yield { text: '', final: true, cancelled: true };
    })());
    await handleClientMessage(ctx as any, { type: 'user_message', session_id: 's1', text: 'q' });
    await handleClientMessage(ctx as any, { type: 'get_history', session_id: 's1' });
    expect(replies(ctx.sent)[0].entries[1]).toMatchObject({ role: 'assistant', text: 'half', cancelled: true });
  });

  it('records an errored turn with an error flag and still throws to the caller', async () => {
    const ctx = makeCtx(() => (async function* () {
      yield { text: 'partial', final: false };
      throw new Error('boom');
    })());
    await expect(handleClientMessage(ctx as any, { type: 'user_message', session_id: 's1', text: 'q' })).rejects.toThrow('boom');
    await handleClientMessage(ctx as any, { type: 'get_history', session_id: 's1' });
    expect(replies(ctx.sent)[0].entries[1]).toMatchObject({ role: 'assistant', error: true });
  });

  it('works without a history store (replies empty, records nothing)', async () => {
    const ctx = makeCtx(() => answer('a'), { history: undefined });
    await handleClientMessage(ctx as any, { type: 'user_message', session_id: 's1', text: 'q' });
    await handleClientMessage(ctx as any, { type: 'get_history', session_id: 's1' });
    expect(replies(ctx.sent)[0]).toMatchObject({ entries: [], has_more: false });
  });
});

describe('get_history schema', () => {
  const ok = (m: unknown) => ClientMessageSchema.safeParse(m).success;
  it('accepts a minimal and a paginated request', () => {
    expect(ok({ type: 'get_history', session_id: 's1' })).toBe(true);
    expect(ok({ type: 'get_history', session_id: 's1', before: 10, limit: 20 })).toBe(true);
  });
  it('rejects bad input', () => {
    expect(ok({ type: 'get_history' })).toBe(false);
    expect(ok({ type: 'get_history', session_id: '' })).toBe(false);
    expect(ok({ type: 'get_history', session_id: 's1', before: -1 })).toBe(false);
    expect(ok({ type: 'get_history', session_id: 's1', before: 1.5 })).toBe(false);
    expect(ok({ type: 'get_history', session_id: 's1', limit: 0 })).toBe(false);
    expect(ok({ type: 'get_history', session_id: 's1', limit: '10' })).toBe(false);
    expect(ok({ type: 'get_history', session_id: 's1', before: Number.MAX_SAFE_INTEGER + 2 })).toBe(false);
  });
});

// Keep the ClientMessage union honest at compile time.
const _typed: ClientMessage = { type: 'get_history', session_id: 's1', before: 1, limit: 2 };
void _typed;
