import { describe, expect, it, vi } from 'vitest';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../src/server/session-manager.js';
import { friendlyRuntimeError } from '../src/server/runtime-errors.js';
import type { Config } from '../src/server/config.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

const queryMock = vi.mocked(query);

function harness() {
  const persisted: unknown[] = [];
  const state = {
    getCcSessionId: () => undefined,
    getLastResponse: () => undefined,
    patchSession: async (_sid: string, patch: unknown) => { persisted.push(patch); },
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
  return { persisted, manager: new SessionManager(cfg, { get: () => undefined } as any, state) };
}

async function drain(it: AsyncIterable<{ text: string }>) {
  const texts: string[] = [];
  try {
    for await (const c of it) texts.push(c.text);
  } catch (e) {
    return { texts, error: e };
  }
  return { texts, error: undefined };
}

describe('SessionManager runtime failures', () => {
  // Shape captured from @anthropic-ai/claude-agent-sdk 0.3.311 with an empty
  // CLAUDE_CONFIG_DIR: an assistant message flagged `error`, then an is_error result.
  it('throws a mappable error instead of speaking "Not logged in" as an answer', async () => {
    queryMock.mockImplementation(() => (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'u1' };
      yield {
        type: 'assistant', session_id: 'u1', error: 'authentication_failed',
        message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] },
      };
      yield { type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', session_id: 'u1' };
    })() as any);
    const { manager, persisted } = harness();

    const { texts, error } = await drain(manager.send('s1', 'hi'));

    expect(texts.join('')).not.toContain('Not logged in');
    expect(error).toBeInstanceOf(Error);
    expect(friendlyRuntimeError(error)).toMatch(/not logged in on your computer/i);
    expect(JSON.stringify(persisted)).not.toContain('Not logged in');
  });

  it('throws when the turn ends with an error result and no text, instead of finishing silently', async () => {
    queryMock.mockImplementation(() => (async function* () {
      yield {
        type: 'result', subtype: 'error_during_execution', is_error: true,
        errors: ['API Error: 429 rate_limit_error'], session_id: 'u1',
      };
    })() as any);
    const { manager } = harness();

    const { error } = await drain(manager.send('s1', 'hi'));

    expect(error).toBeInstanceOf(Error);
    expect(friendlyRuntimeError(error)).toMatch(/limit/i);
  });

  it('keeps a truncated max_output_tokens answer as a normal answer', async () => {
    queryMock.mockImplementation(() => (async function* () {
      yield {
        type: 'assistant', session_id: 'u1', error: 'max_output_tokens',
        message: { content: [{ type: 'text', text: 'long answer' }] },
      };
      yield { type: 'result', subtype: 'success', is_error: false, result: 'long answer', session_id: 'u1' };
    })() as any);
    const { manager } = harness();

    const { texts, error } = await drain(manager.send('s1', 'hi'));

    expect(error).toBeUndefined();
    expect(texts.join('')).toBe('long answer');
  });
});
