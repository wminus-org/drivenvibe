import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoServer } from '../src/pwa/demo/server.js';
import type { ServerMessage } from '../shared/protocol.js';

describe('demo server (fake desktop for /demo)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('streams a scripted reply, then signals another session is ready', () => {
    vi.useFakeTimers();
    const out: ServerMessage[] = [];
    const server = new DemoServer({ thinkMs: 10, chunkMs: 1, readyMs: 100 });
    server.emit = (m) => out.push(m);

    server.handle({ type: 'open_session', session_id: 'checkout' });
    server.handle({ type: 'user_message', session_id: 'checkout', text: 'fix the coupon bug' });
    vi.advanceTimersByTime(5_000);

    const types = out.map((m) => m.type);
    const done = types.indexOf('cc_done');
    expect(types.slice(0, done).every((t) => t === 'cc_chunk')).toBe(true);
    expect(done).toBeGreaterThan(5);
    expect(types[done + 1]).toBe('say');
    const ready = out.find((m) => m.type === 'session_ready');
    expect(ready && ready.type === 'session_ready' && ready.session_id).not.toBe('checkout');

    out.length = 0;
    server.handle({ type: 'replay' });
    expect(out).toEqual([{ type: 'say', session_id: 'checkout', text: expect.any(String) }]);
  });

  it('cancel stops the stream', () => {
    vi.useFakeTimers();
    const out: ServerMessage[] = [];
    const server = new DemoServer({ thinkMs: 10, chunkMs: 10 });
    server.emit = (m) => out.push(m);
    server.handle({ type: 'user_message', session_id: 'snake', text: 'go' });
    vi.advanceTimersByTime(35);
    server.handle({ type: 'cancel' });
    const sent = out.length;
    vi.advanceTimersByTime(10_000);
    expect(out.length).toBe(sent);
    expect(out.some((m) => m.type === 'say')).toBe(false);
  });

  it('mutates the in-memory config and broadcasts it', () => {
    const out: ServerMessage[] = [];
    const server = new DemoServer();
    server.emit = (m) => out.push(m);

    server.handle({ type: 'add_project', payload: { label: 'My App', color: '#ff0000', emoji: '✨' } });
    server.handle({ type: 'add_session', project_id: 'my-app', payload: { label: 'Refactor', color: '#00ff00', project_dir: '/x' } });
    server.handle({ type: 'archive_session', session_id: 'checkout' });
    server.handle({ type: 'update_settings', scope: 'global', patch: { theme: 'dark', anthropic_api_key: 'sk-secret' } });

    const last = out.filter((m) => m.type === 'config_changed').at(-1);
    if (last?.type !== 'config_changed') throw new Error('no config_changed');
    const project = last.config.projects.find((p) => p.id === 'my-app');
    expect(project?.sessions.map((s) => s.label)).toEqual(['Refactor']);
    expect(last.config.projects[0].sessions.find((s) => s.id === 'checkout')?.archived).toBe(true);
    expect(out.at(-1)).toEqual({ type: 'settings_changed', scope: 'global', patch: { theme: 'dark', has_anthropic_key: true } });
    expect(JSON.stringify(out)).not.toContain('sk-secret');
  });

  it('answers get_history with seeded past turns, newest last, plus new turns', () => {
    vi.useFakeTimers();
    const out: ServerMessage[] = [];
    const server = new DemoServer({ thinkMs: 1, chunkMs: 1 });
    server.emit = (m) => out.push(m);

    server.handle({ type: 'get_history', session_id: 'checkout' });
    const seeded = out.at(-1);
    if (seeded?.type !== 'history') throw new Error('no history reply');
    expect(seeded.session_id).toBe('checkout');
    expect(seeded.entries.length).toBeGreaterThanOrEqual(2);
    expect(seeded.entries[0].role).toBe('user');
    expect(seeded.entries.map((e) => e.ts)).toEqual([...seeded.entries.map((e) => e.ts)].sort((a, b) => a - b));

    server.handle({ type: 'user_message', session_id: 'checkout', text: 'fix the coupon bug' });
    vi.advanceTimersByTime(5_000);
    server.handle({ type: 'get_history', session_id: 'checkout' });
    const after = out.at(-1);
    if (after?.type !== 'history') throw new Error('no history reply');
    expect(after.entries.slice(-2).map((e) => [e.role, e.text])).toEqual([
      ['user', 'fix the coupon bug'],
      ['assistant', expect.stringContaining('Coupons now reduce the price before tax')],
    ]);
  });

  it('paginates demo history and rejects unknown sessions', () => {
    const out: ServerMessage[] = [];
    const server = new DemoServer();
    server.emit = (m) => out.push(m);
    server.handle({ type: 'get_history', session_id: 'checkout', limit: 1 });
    const page = out.at(-1);
    if (page?.type !== 'history') throw new Error('no history reply');
    expect(page.entries).toHaveLength(1);
    expect(page.has_more).toBe(true);
    server.handle({ type: 'get_history', session_id: 'checkout', before: page.entries[0].seq, limit: 50 });
    const older = out.at(-1);
    if (older?.type !== 'history') throw new Error('no history reply');
    expect(older.before).toBe(page.entries[0].seq);
    expect(older.has_more).toBe(false);
    expect(older.starts_at).toBe(older.entries[0].ts);

    server.handle({ type: 'get_history', session_id: 'nope' });
    expect(out.at(-1)).toEqual({ type: 'error', message: 'Unknown session' });
  });
});
