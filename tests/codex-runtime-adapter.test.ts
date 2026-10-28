import { describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { CodexRuntimeAdapter, parseCodexJsonLine } from '../src/server/codex-runtime-adapter.js';

describe('Codex JSONL parser', () => {
  it('maps the supported events and ignores warnings', () => {
    expect(parseCodexJsonLine('warning: update available')).toBeUndefined();
    expect(parseCodexJsonLine('{"type":"thread.started","thread_id":"t1"}')).toEqual({ type: 'session', sessionId: 't1' });
    expect(parseCodexJsonLine('{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}')).toEqual({ type: 'text', text: 'hi' });
    expect(parseCodexJsonLine('{"type":"turn.completed"}')).toEqual({ type: 'done' });
  });
});

function fakeChild() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new PassThrough(), { stdout, stderr, exitCode: null as number | null, killed: false, kill: vi.fn(() => { child.killed = true; stdout.end(); child.emit('close', null); return true; }) });
  return child as any;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of iterable) result.push(value);
  return result;
}

describe('CodexRuntimeAdapter', () => {
  it('passes the safe command and streams supported events', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const events = new CodexRuntimeAdapter(spawn).run({ cwd: '/work', prompt: 'hello', sandbox: 'read-only', model: 'o3' });
    child.stdout.write('warning\n{"type":"thread.started","thread_id":"t"}\n{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n{"type":"turn.completed"}\n');
    child.exitCode = 0; child.stdout.end(); child.emit('close', 0);
    await expect(collect(events)).resolves.toEqual([{ type: 'session', sessionId: 't' }, { type: 'text', text: 'ok' }, { type: 'done' }]);
    expect(spawn).toHaveBeenCalledWith('codex', ['exec', '--json', '--ephemeral', '-C', '/work', '--sandbox', 'read-only', '--model', 'o3', 'hello'], expect.anything());
  });

  it('returns a generic error on process failure without exposing stderr', async () => {
    const child = fakeChild();
    const pending = collect(new CodexRuntimeAdapter(() => child).run({ cwd: '/work', prompt: 'x', sandbox: 'workspace-write' }));
    child.stderr.write('secret provider details'); child.exitCode = 1; child.stdout.end(); child.emit('close', 1);
    await expect(pending).rejects.toThrow('Codex runtime failed');
    await expect(pending).rejects.not.toThrow('secret provider details');
  });

  it('returns a clear generic error when the Codex executable cannot start', async () => {
    const child = fakeChild();
    const pending = collect(new CodexRuntimeAdapter(() => child).run({ cwd: '/work', prompt: 'x', sandbox: 'read-only' }));
    child.emit('error', new Error('ENOENT: codex'));
    child.exitCode = 1; child.stdout.end(); child.emit('close', 1);
    await expect(pending).rejects.toThrow('Codex runtime is unavailable on this laptop');
  });

  it('kills the child and ends cleanly on abort', async () => {
    const child = fakeChild();
    const adapter = new CodexRuntimeAdapter(() => child);
    const controller = new AbortController();
    const iterator = adapter.run({ cwd: '/work', prompt: 'x', sandbox: 'workspace-write', signal: controller.signal })[Symbol.asyncIterator]();
    void iterator.next();
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(child.kill).toHaveBeenCalled();
  });
});
