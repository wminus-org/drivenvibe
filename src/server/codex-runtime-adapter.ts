import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { RuntimeAdapter, RuntimeEvent, RuntimeRequest } from './runtime-adapter.js';

type Spawn = (command: string, args: string[], options: {
  cwd: string;
  stdio: ['ignore', 'pipe', 'pipe'];
}) => ChildProcessWithoutNullStreams;

/** Converts the small, stable subset of Codex CLI JSONL used by the runtime. */
export function parseCodexJsonLine(line: string): RuntimeEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (record.type === 'thread.started' && typeof record.thread_id === 'string') {
    return { type: 'session', sessionId: record.thread_id };
  }
  if (record.type === 'turn.completed') return { type: 'done' };
  if (record.type === 'item.completed' && record.item && typeof record.item === 'object') {
    const item = record.item as Record<string, unknown>;
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      return { type: 'text', text: item.text };
    }
  }
  return undefined;
}

export class CodexRuntimeAdapter implements RuntimeAdapter {
  constructor(private readonly spawn: Spawn = nodeSpawn as Spawn) {}

  async *run(request: RuntimeRequest): AsyncIterable<RuntimeEvent> {
    if (request.signal?.aborted) return;

    const args = ['exec', '--json', '--ephemeral', '-C', request.cwd, '--sandbox', request.sandbox];
    if (request.model) args.push('--model', request.model);
    args.push(request.prompt);

    const child = this.spawn('codex', args, { cwd: request.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let aborted = request.signal?.aborted ?? false;
    let spawnFailed = false;
    const onAbort = () => {
      aborted = true;
      child.kill();
    };
    const onError = () => { spawnFailed = true; };
    request.signal?.addEventListener('abort', onAbort, { once: true });
    child.once('error', onError);
    if (aborted) {
      child.kill();
      return;
    }

    try {
      const lines = createInterface({ input: child.stdout });
      const lineEvents = (async function* () {
        for await (const line of lines) {
          const event = parseCodexJsonLine(String(line));
          if (event) yield event;
        }
      })();
      for await (const event of lineEvents) yield event;
      const exitCode = await new Promise<number | null>((resolve) => {
        if (child.exitCode !== null) return resolve(child.exitCode);
        child.once('close', (code) => resolve(code));
      });
      if (aborted) return;
      if (spawnFailed) throw new Error('Codex runtime is unavailable on this laptop');
      if (exitCode !== 0) throw new Error('Codex runtime failed');
    } finally {
      request.signal?.removeEventListener('abort', onAbort);
      child.off('error', onError);
      if (!child.killed && child.exitCode === null) child.kill();
    }
  }
}
