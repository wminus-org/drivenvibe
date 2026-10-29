import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HistoryStore, MAX_HISTORY_ENTRIES, MAX_HISTORY_TEXT_CHARS, MAX_HISTORY_PAGE, HISTORY_PAGE_BYTES,
} from '../src/server/history.js';

let dir: string;
let file: string;
const VALID = new Set(['a', 'b']);

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dv-history-'));
  file = path.join(dir, 'history.json');
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function turn(store: HistoryStore, sid: string, user: string, answer?: string, valid = VALID) {
  const t = store.beginTurn(sid);
  await store.finishTurn(t, { user, userTs: 1000, assistant: answer === undefined ? undefined : { text: answer } }, valid);
}

describe('HistoryStore', () => {
  it('returns an empty page for a session with no history', async () => {
    const store = new HistoryStore(file);
    expect(await store.page('a')).toEqual({ entries: [], has_more: false });
  });

  it('records a turn as a user entry followed by an assistant entry', async () => {
    const store = new HistoryStore(file);
    await turn(store, 'a', 'hello', 'hi there');
    const page = await store.page('a');
    expect(page.entries.map((e) => [e.role, e.text])).toEqual([['user', 'hello'], ['assistant', 'hi there']]);
    expect(page.entries[0].seq).toBeLessThan(page.entries[1].seq);
    expect(page.has_more).toBe(false);
  });

  it('keeps sessions separate', async () => {
    const store = new HistoryStore(file);
    await turn(store, 'a', 'for a', 'A');
    await turn(store, 'b', 'for b', 'B');
    expect((await store.page('a')).entries.map((e) => e.text)).toEqual(['for a', 'A']);
  });

  it('persists across reload with mode 0600', async () => {
    const store = new HistoryStore(file);
    await turn(store, 'a', 'hello', 'world');
    await store.whenIdle();
    const reloaded = new HistoryStore(file);
    expect((await reloaded.page('a')).entries.map((e) => e.text)).toEqual(['hello', 'world']);
    if (process.platform !== 'win32') {
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    }
  });

  it('caps entries per session and marks the log truncated', async () => {
    const store = new HistoryStore(file);
    for (let i = 0; i < MAX_HISTORY_ENTRIES; i++) await turn(store, 'a', `q${i}`, `a${i}`);
    const all = [];
    let before: number | undefined;
    for (;;) {
      const p = await store.page('a', { before, limit: MAX_HISTORY_PAGE });
      all.unshift(...p.entries);
      if (!p.has_more) {
        expect(p.starts_at).toBe(p.entries[0].ts);
        break;
      }
      before = p.entries[0].seq;
    }
    expect(all).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(all.at(-1)!.text).toBe(`a${MAX_HISTORY_ENTRIES - 1}`);
    expect(all[0].text).toBe(`q${MAX_HISTORY_ENTRIES / 2}`);
  });

  it('does not report starts_at for a complete history', async () => {
    const store = new HistoryStore(file);
    await turn(store, 'a', 'q', 'a');
    expect((await store.page('a')).starts_at).toBeUndefined();
  });

  it('reports starts_at when the session had conversation before history was kept', async () => {
    const store = new HistoryStore(file);
    const t = store.beginTurn('a');
    await store.finishTurn(t, { user: 'q', userTs: 5, assistant: { text: 'a' }, priorUnlogged: true }, VALID);
    expect((await store.page('a')).starts_at).toBe(5);
  });

  it('truncates long text with a marker', async () => {
    const store = new HistoryStore(file);
    await turn(store, 'a', 'x'.repeat(MAX_HISTORY_TEXT_CHARS + 500), 'ok');
    const [user] = (await store.page('a')).entries;
    expect(user.text.length).toBeLessThanOrEqual(MAX_HISTORY_TEXT_CHARS);
    expect(user.text.endsWith('[truncated]')).toBe(true);
  });

  it('paginates with a seq cursor and clamps the limit', async () => {
    const store = new HistoryStore(file);
    for (let i = 0; i < 40; i++) await turn(store, 'a', `q${i}`, `a${i}`);
    const latest = await store.page('a', { limit: 1000 });
    expect(latest.entries).toHaveLength(MAX_HISTORY_PAGE);
    expect(latest.has_more).toBe(true);
    const older = await store.page('a', { before: latest.entries[0].seq, limit: 10 });
    expect(older.entries).toHaveLength(10);
    expect(older.entries.at(-1)!.seq).toBe(latest.entries[0].seq - 1);
    expect((await store.page('a', { limit: 0 })).entries).toHaveLength(1);
  });

  it('bounds a page by bytes but always returns at least one entry', async () => {
    const store = new HistoryStore(file);
    const big = 'é'.repeat(MAX_HISTORY_TEXT_CHARS - 100);
    for (let i = 0; i < 25; i++) await turn(store, 'a', big, big);
    const p = await store.page('a', { limit: MAX_HISTORY_PAGE });
    expect(Buffer.byteLength(JSON.stringify(p.entries))).toBeLessThanOrEqual(HISTORY_PAGE_BYTES);
    expect(p.entries.length).toBeGreaterThan(0);
    expect(p.has_more).toBe(true);
  });

  it('drops the answer of a superseded turn but keeps what the user said', async () => {
    const store = new HistoryStore(file);
    const old = store.beginTurn('a');
    const fresh = store.beginTurn('a');
    await store.finishTurn(old, { user: 'first', userTs: 1, assistant: { text: 'stale', cancelled: true } }, VALID);
    await store.finishTurn(fresh, { user: 'second', userTs: 2, assistant: { text: 'fresh' } }, VALID);
    expect((await store.page('a')).entries.map((e) => e.text)).toEqual(['first', 'second', 'fresh']);
  });

  it('keeps cancelled and error flags', async () => {
    const store = new HistoryStore(file);
    let t = store.beginTurn('a');
    await store.finishTurn(t, { user: 'q1', userTs: 1, assistant: { text: 'part', cancelled: true } }, VALID);
    t = store.beginTurn('a');
    await store.finishTurn(t, { user: 'q2', userTs: 2, assistant: { text: '', error: true } }, VALID);
    const e = (await store.page('a')).entries;
    expect(e[1]).toMatchObject({ role: 'assistant', text: 'part', cancelled: true });
    expect(e[3]).toMatchObject({ role: 'assistant', error: true });
  });

  it('drops sessions that are no longer in the config on the next write', async () => {
    const store = new HistoryStore(file);
    await turn(store, 'a', 'qa', 'aa');
    await turn(store, 'b', 'qb', 'ab', new Set(['b']));
    expect((await store.page('a')).entries).toEqual([]);
    await store.whenIdle();
    const raw = await fs.readFile(file, 'utf8');
    expect(raw).not.toContain('qa');
  });

  it('starts empty on a corrupt file instead of throwing', async () => {
    await fs.writeFile(file, '{ not json');
    const store = new HistoryStore(file);
    expect(await store.page('a')).toEqual({ entries: [], has_more: false });
    await turn(store, 'a', 'q', 'a');
    expect((await store.page('a')).entries).toHaveLength(2);
  });

  it('skips malformed sessions and entries from an old or edited file', async () => {
    await fs.writeFile(file, JSON.stringify({
      version: 1,
      sessions: {
        a: { next_seq: 3, entries: [{ seq: 1, role: 'user', text: 'ok', ts: 1 }, { seq: 2, role: 'robot', text: 1 }] },
        b: 'garbage',
      },
    }));
    const store = new HistoryStore(file);
    expect((await store.page('a')).entries.map((e) => e.text)).toEqual(['ok']);
    expect((await store.page('b')).entries).toEqual([]);
  });

  it('is not polluted by __proto__ / constructor session ids', async () => {
    await fs.writeFile(file, '{"version":1,"sessions":{"__proto__":{"next_seq":2,"entries":[{"seq":1,"role":"user","text":"evil","ts":1}]}}}');
    const store = new HistoryStore(file);
    expect((await store.page('constructor')).entries).toEqual([]);
    expect((await store.page('toString')).entries).toEqual([]);
    const valid = new Set(['__proto__', 'constructor']);
    await turn(store, '__proto__', 'p', 'P', valid);
    await turn(store, 'constructor', 'c', 'C', valid);
    expect(({} as any).entries).toBeUndefined();
    expect((await store.page('__proto__')).entries.map((e) => e.text)).toEqual(['evil', 'p', 'P']);
    await store.whenIdle();
    const reloaded = new HistoryStore(file);
    expect((await reloaded.page('constructor')).entries.map((e) => e.text)).toEqual(['c', 'C']);
  });
});
