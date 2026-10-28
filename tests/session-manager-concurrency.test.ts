/**
 * Concurrency safety for SessionManager.send().
 *
 * Issue #12 originally serialized send() behind a mutex because providerEnv()
 * mutated process.env. It no longer does — providerEnv() returns an explicit env
 * object per call — so turns are free to overlap, and a lock would actively hurt:
 * barge-in preempts the in-flight turn, and a preempted generator that ignores
 * its abort signal would hold a lock forever and wedge the replacement.
 *
 * What must still hold, and is asserted here: a send() that throws, or whose
 * consumer breaks early, never blocks a later send() for the same session. The
 * "no stale write" half of the contract lives in session-manager-hardening.test.ts.
 *
 * Strategy: mock `@anthropic-ai/claude-agent-sdk`'s `query` export with a
 * controllable async generator gated by the test, so call ordering is explicit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../src/server/session-manager.js';
import type { Config } from '../src/server/config.js';
import type { State } from '../src/server/state.js';
import type { Settings } from '../src/server/settings.js';

// ── Mock the Claude Agent SDK ────────────────────────────────────────────────

/**
 * Each entry is a factory for one call to `query`. The factory receives a
 * resolve-callback that the test can call to advance the generator past its
 * internal await, simulating a slow network response.
 */
type QueryFactory = (unblock: () => void) => AsyncGenerator<unknown>;
const queryQueue: QueryFactory[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: async function* (args: { prompt: string; options?: unknown }) {
    // Pop the next factory (FIFO) or fall back to an instant empty generator.
    const factory = queryQueue.shift();
    if (!factory) {
      yield { type: 'result', subtype: 'success' };
      return;
    }
    let resolve!: () => void;
    const gate = new Promise<void>((r) => { resolve = r; });
    const gen = factory(resolve);
    // Wait for the gate before yielding so the test can interleave two starts.
    await gate;
    yield* gen;
  },
}));

// ── Minimal test doubles ─────────────────────────────────────────────────────

const BASE_CONFIG: Config = {
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
          voice_mode: false,
          tts_rate: 1.2,
          stt_backend: 'browser' as const,
        },
      ],
    },
  ],
};

function makeState(): State {
  const ccIds: Record<string, string> = {};
  const lastResponses: Record<string, string> = {};
  return {
    getCcSessionId: (sid: string) => ccIds[sid],
    setCcSessionId: async (sid: string, uuid: string) => { ccIds[sid] = uuid; },
    getLastResponse: (sid: string) => lastResponses[sid],
    setLastResponse: async (sid: string, text: string) => { lastResponses[sid] = text; },
    patchSession: async (sid: string, patch: { ccSessionId?: string; lastResponse?: string }) => {
      if (patch.ccSessionId) ccIds[sid] = patch.ccSessionId;
      if (patch.lastResponse) lastResponses[sid] = patch.lastResponse;
    },
  } as unknown as State;
}

function makeSettings(): Settings {
  return {
    get: (_key: string) => undefined,
  } as unknown as Settings;
}

// ── Helper: drain an async iterable into an array ───────────────────────────

async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Clear any leftover factories between tests.
  queryQueue.length = 0;
});

describe('SessionManager send() concurrency', () => {
  it('does not interleave two send() bodies for the same session', async () => {
    const log: string[] = [];

    // Factory for call A: unblocks immediately, logs enter/exit.
    let unblockA!: () => void;
    queryQueue.push((unblock) => {
      unblockA = unblock;
      return (async function* () {
        log.push('A:enter');
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } };
        // Logged before the result: B has already preempted (aborted) A, so A's
        // result ends the turn as a cancel and the generator is closed there.
        log.push('A:exit');
        yield { type: 'result', subtype: 'success' };
      })();
    });

    // Factory for call B: logs enter/exit.
    let unblockB!: () => void;
    queryQueue.push((unblock) => {
      unblockB = unblock;
      return (async function* () {
        log.push('B:enter');
        yield { type: 'result', subtype: 'success' };
        log.push('B:exit');
      })();
    });

    const mgr = new SessionManager(BASE_CONFIG, makeSettings(), makeState());

    // Start both iterators "simultaneously" (neither has been awaited yet).
    const iterA = mgr.send('sess-1', 'message A');
    const iterB = mgr.send('sess-1', 'message B');

    // Kick off both drains in parallel — do NOT await yet.
    const promiseA = drain(iterA);
    const promiseB = drain(iterB);

    // Unblock A first so it can run to completion, then unblock B.
    // Give the event loop a tick so both drain loops have started and are
    // sitting at their first `await` inside query().
    await Promise.resolve();
    await Promise.resolve();
    unblockA();
    // Wait for A to finish before releasing B.
    await promiseA;
    unblockB();
    await promiseB;

    // Serialized order must be A:enter → A:exit → B:enter → B:exit.
    // An interleaved result would look like A:enter → B:enter → … .
    expect(log).toEqual(['A:enter', 'A:exit', 'B:enter', 'B:exit']);
  });

  it('a throwing send() does not block a later send()', async () => {
    // First call throws inside the generator.
    queryQueue.push((unblock) => {
      unblock(); // release gate immediately
      return (async function* () {
        throw new Error('simulated query failure');
        // eslint-disable-next-line no-unreachable
        yield { type: 'result' };
      })();
    });

    // Second call is a normal success.
    queryQueue.push((unblock) => {
      unblock();
      return (async function* () {
        yield { type: 'result', subtype: 'success' };
      })();
    });

    const mgr = new SessionManager(BASE_CONFIG, makeSettings(), makeState());

    // First send must reject.
    await expect(drain(mgr.send('sess-1', 'will fail'))).rejects.toThrow('simulated query failure');

    // Second send must still succeed — the lock must have been released.
    await expect(drain(mgr.send('sess-1', 'after failure'))).resolves.toBeDefined();
  });

  it('a consumer early-break does not block a later send()', async () => {
    // First call yields many items; consumer will break after the first one.
    queryQueue.push((unblock) => {
      unblock();
      return (async function* () {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'chunk1' }] } };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'chunk2' }] } };
        yield { type: 'result', subtype: 'success' };
      })();
    });

    // Second call is a normal success.
    queryQueue.push((unblock) => {
      unblock();
      return (async function* () {
        yield { type: 'result', subtype: 'success' };
      })();
    });

    const mgr = new SessionManager(BASE_CONFIG, makeSettings(), makeState());

    // Early break: only take the first item.
    const iterA = mgr.send('sess-1', 'first');
    // eslint-disable-next-line no-unreachable-loop
    for await (const _chunk of iterA) {
      break; // consumer early exit — triggers generator finally
    }

    // The lock must now be released; this must not hang.
    await expect(drain(mgr.send('sess-1', 'second'))).resolves.toBeDefined();
  });
});
