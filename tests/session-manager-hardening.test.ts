import { describe, expect, it, vi } from 'vitest';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../src/server/session-manager.js';
import type { Config } from '../src/server/config.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

const queryMock = vi.mocked(query);

describe('SessionManager turn integrity', () => {
  it('does not let an aborted replacement turn overwrite newer durable state', async () => {
    let releaseOld!: () => void;
    const oldCanFinish = new Promise<void>((resolve) => { releaseOld = resolve; });

    queryMock.mockImplementation(({ prompt }: any) => (async function* () {
      if (prompt === 'old') {
        yield {
          type: 'assistant',
          session_id: 'old-uuid',
          message: { content: [{ type: 'text', text: 'old partial' }] },
        };
        await oldCanFinish;
        yield { type: 'result', session_id: 'old-uuid' };
      } else {
        yield {
          type: 'assistant',
          session_id: 'new-uuid',
          message: { content: [{ type: 'text', text: 'new response' }] },
        };
        yield { type: 'result', session_id: 'new-uuid' };
      }
    })() as any);

    const persisted: Array<{ sid: string; patch: unknown }> = [];
    const state = {
      getCcSessionId: () => undefined,
      getLastResponse: () => undefined,
      patchSession: async (sid: string, patch: unknown) => { persisted.push({ sid, patch }); },
    } as any;
    const settings = { get: () => undefined } as any;
    const cfg = {
      projects: [{
        id: 'p1', label: 'P', color: '#123456',
        sessions: [{
          id: 's1', label: 'S', color: '#abcdef', project_dir: '/tmp',
          provider: 'subscription', voice_mode: false, tts_rate: 1.2,
        }],
      }],
    } as Config;
    const manager = new SessionManager(cfg, settings, state);

    const oldIterator = manager.send('s1', 'old')[Symbol.asyncIterator]();
    expect(await oldIterator.next()).toEqual({
      value: { text: 'old partial', final: false },
      done: false,
    });

    const newerChunks = [];
    for await (const chunk of manager.send('s1', 'new')) newerChunks.push(chunk);
    expect(newerChunks.some((chunk) => chunk.text === 'new response')).toBe(true);

    releaseOld();
    while (!(await oldIterator.next()).done) {
      // Drain the stale generator so its finally block runs.
    }

    expect(persisted).toEqual([{
      sid: 's1',
      patch: { ccSessionId: 'new-uuid', lastResponse: 'new response' },
    }]);
  });

  it('reports an explicit cancel as normal stream completion', async () => {
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    queryMock.mockImplementation(({ options }: any) => (async function* () {
      started();
      await new Promise<void>((_resolve, reject) => {
        options.abortController.signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      });
      yield { type: 'result', session_id: 'never' };
    })() as any);

    const state = {
      getCcSessionId: () => undefined,
      getLastResponse: () => undefined,
      patchSession: async () => {},
    } as any;
    const cfg = {
      projects: [{
        id: 'p1', label: 'P', color: '#123456',
        sessions: [{
          id: 's1', label: 'S', color: '#abcdef', project_dir: '/tmp',
          provider: 'subscription', voice_mode: false, tts_rate: 1.2,
        }],
      }],
    } as Config;
    const manager = new SessionManager(cfg, { get: () => undefined } as any, state);
    const iterator = manager.send('s1', 'cancel me')[Symbol.asyncIterator]();
    const pending = iterator.next();
    await didStart;
    manager.cancel('s1');

    expect(await pending).toEqual({
      value: { text: '', final: true, cancelled: true },
      done: false,
    });
    expect((await iterator.next()).done).toBe(true);
  });
});
