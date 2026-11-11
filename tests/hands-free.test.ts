import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HandsFree, HANDS_FREE_STORAGE_KEY, SILENCE_SEND_MS, STILL_WORKING_MS, mediaButtonAction, type HandsFreeDeps,
} from '../src/pwa/hands-free.js';

function memoryStorage(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    data,
  };
}

function setup(opts: { draft?: string; replay?: boolean; storage?: ReturnType<typeof memoryStorage> } = {}) {
  const calls: string[] = [];
  const deps: HandsFreeDeps = {
    listen: () => calls.push('listen'),
    stopListening: () => calls.push('stopListening'),
    send: (text) => calls.push(`send:${text}`),
    draft: () => opts.draft ?? '',
    replay: () => { calls.push('replay'); return opts.replay ?? true; },
    say: (text, then) => { calls.push(`say:${text}`); then?.(); },
    lang: () => 'en-US',
  };
  const storage = opts.storage ?? memoryStorage();
  const hf = new HandsFree(deps, storage);
  return { hf, calls, storage, deps };
}

describe('HandsFree controller', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts listening again after the answer finishes speaking', () => {
    const { hf, calls } = setup();
    hf.setEnabled(true);
    hf.answerSpoken();
    expect(calls).toEqual(['listen']);
  });

  it('does nothing after an answer when off', () => {
    const { hf, calls } = setup();
    hf.answerSpoken();
    hf.hear('fix the bug', 'fix the bug');
    vi.advanceTimersByTime(SILENCE_SEND_MS * 3);
    hf.busy(true);
    vi.advanceTimersByTime(STILL_WORKING_MS * 3);
    expect(calls).toEqual([]);
  });

  it('sends after the silence window, restarted by every new result', () => {
    const { hf, calls } = setup({ draft: 'Earlier part.' });
    hf.setEnabled(true);
    hf.hear('fix the', 'fix the');
    vi.advanceTimersByTime(SILENCE_SEND_MS - 100);
    hf.hear('fix the login bug', 'login bug');
    vi.advanceTimersByTime(SILENCE_SEND_MS - 100);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(calls).toEqual(['send:Earlier part. fix the login bug']);
  });

  it('does not arm the silence timer on empty text', () => {
    const { hf, calls } = setup();
    hf.setEnabled(true);
    hf.hear('', '');
    vi.advanceTimersByTime(SILENCE_SEND_MS * 2);
    expect(calls).toEqual([]);
  });

  it('a final "… send" sends immediately without the send word', () => {
    const { hf, calls } = setup();
    hf.setEnabled(true);
    hf.hear('fix the login bug send', '');
    expect(calls).toEqual(['send:fix the login bug']);
    vi.advanceTimersByTime(SILENCE_SEND_MS * 2);
    expect(calls).toHaveLength(1);
  });

  it('an interim "… send" waits for silence (it may still become "sender"), then strips it', () => {
    const { hf, calls } = setup();
    hf.setEnabled(true);
    hf.hear('add a send', 'send');
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(SILENCE_SEND_MS);
    expect(calls).toEqual(['send:add a']);
  });

  it('"cancel" discards the utterance and keeps listening', () => {
    const { hf, calls } = setup({ draft: 'old draft' });
    hf.setEnabled(true);
    hf.hear('Cancel.', '');
    expect(calls).toEqual(['stopListening', 'listen']);
    vi.advanceTimersByTime(SILENCE_SEND_MS * 2);
    expect(calls).toHaveLength(2);
  });

  it('"say again" replays the last answer', () => {
    const { hf, calls } = setup();
    hf.setEnabled(true);
    hf.hear('say again', '');
    expect(calls).toEqual(['stopListening', 'replay']);
  });

  it('"repeat" with nothing to replay says so and listens again', () => {
    const { hf, calls } = setup({ replay: false });
    hf.setEnabled(true);
    hf.hear('repeat', '');
    expect(calls).toEqual(['stopListening', 'replay', 'say:Nothing to repeat', 'listen']);
  });

  it('"stop listening" turns the mode off with a spoken confirmation, and it stays off', () => {
    const { hf, calls, storage } = setup();
    hf.setEnabled(true);
    hf.hear('stop listening', '');
    expect(calls).toEqual(['stopListening', 'say:Hands-free off']);
    expect(hf.enabled).toBe(false);
    expect(storage.data.get(HANDS_FREE_STORAGE_KEY)).toBe('0');
    hf.answerSpoken();
    expect(calls).toHaveLength(2);
  });

  it('a bare "send" sends the earlier draft', () => {
    const { hf, calls } = setup({ draft: 'write the tests' });
    hf.setEnabled(true);
    hf.hear('send', '');
    expect(calls).toEqual(['send:write the tests']);
  });

  it('a bare "send" with no draft says so and keeps listening', () => {
    const { hf, calls } = setup();
    hf.setEnabled(true);
    hf.hear('send', '');
    expect(calls).toEqual(['stopListening', 'say:Nothing to send', 'listen']);
  });

  it('commands still apply when only the silence window ends the utterance', () => {
    const { hf, calls } = setup();
    hf.setEnabled(true);
    hf.hear('cancel', 'cancel');
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(SILENCE_SEND_MS);
    expect(calls).toEqual(['stopListening', 'listen']);
  });

  it('says "Still working" once per request after the threshold', () => {
    const { hf, calls } = setup();
    hf.setEnabled(true);
    hf.busy(true);
    vi.advanceTimersByTime(STILL_WORKING_MS - 1);
    expect(calls).toEqual([]);
    hf.busy(true); // processing -> queued -> processing must not restart it
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['say:Still working']);
    vi.advanceTimersByTime(STILL_WORKING_MS * 5);
    expect(calls).toEqual(['say:Still working']);
  });

  it('does not say "Still working" when the answer arrives in time', () => {
    const { hf, calls } = setup();
    hf.setEnabled(true);
    hf.busy(true);
    vi.advanceTimersByTime(STILL_WORKING_MS / 2);
    hf.busy(false);
    vi.advanceTimersByTime(STILL_WORKING_MS);
    expect(calls).toEqual([]);
  });

  it('speaks connection changes only while on, and only on a real change', () => {
    const { hf, calls } = setup();
    hf.connection(true); // initial state is not news
    hf.setEnabled(true);
    hf.connection(true);
    hf.connection(false);
    hf.connection(false);
    hf.connection(true);
    hf.setEnabled(false);
    hf.connection(false);
    expect(calls).toEqual(['say:Connection lost', 'say:Back online']);
  });

  it('navigation suspends the loop until a user gesture re-arms it', () => {
    const { hf, calls } = setup();
    hf.setEnabled(true);
    hf.hear('fix the bug', 'bug');
    hf.suspend();
    vi.advanceTimersByTime(SILENCE_SEND_MS * 2);
    hf.answerSpoken();
    expect(calls).toEqual([]);
    hf.arm();
    hf.answerSpoken();
    expect(calls).toEqual(['listen']);
  });

  it('persists the toggle per device and restores it', () => {
    const storage = memoryStorage();
    setup({ storage }).hf.setEnabled(true);
    expect(storage.data.get(HANDS_FREE_STORAGE_KEY)).toBe('1');
    expect(setup({ storage }).hf.enabled).toBe(true);
  });

  it('a restored "on" starts suspended: no auto-listen until a gesture', () => {
    const { hf, calls } = setup({ storage: memoryStorage({ [HANDS_FREE_STORAGE_KEY]: '1' }) });
    hf.answerSpoken();
    expect(calls).toEqual([]);
  });

  it('survives storage that throws (private mode, blocked site data)', () => {
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const hf = new HandsFree(setup().deps, throwing);
    expect(hf.enabled).toBe(false);
    expect(() => hf.setEnabled(true)).not.toThrow();
    expect(hf.enabled).toBe(true);
  });
});

describe('mediaButtonAction (headset / steering-wheel buttons in hands-free)', () => {
  it('the main play/pause button walks the loop', () => {
    for (const a of ['play', 'pause'] as const) {
      expect(mediaButtonAction(a, 'idle')).toBe('listen');
      expect(mediaButtonAction(a, 'paused')).toBe('resume');
      expect(mediaButtonAction(a, 'listening')).toBe('send');
      expect(mediaButtonAction(a, 'playing')).toBe('bargeIn');
      // A stray press must not throw away minutes of agent work.
      expect(mediaButtonAction(a, 'processing')).toBe('status');
      expect(mediaButtonAction(a, 'queued')).toBe('status');
    }
  });

  it('next sends / barges in, previous repeats, stop cancels a running request', () => {
    expect(mediaButtonAction('nexttrack', 'listening')).toBe('send');
    expect(mediaButtonAction('nexttrack', 'playing')).toBe('bargeIn');
    expect(mediaButtonAction('previoustrack', 'idle')).toBe('repeat');
    expect(mediaButtonAction('previoustrack', 'processing')).toBe('status');
    expect(mediaButtonAction('stop', 'processing')).toBe('cancel');
    expect(mediaButtonAction('stop', 'listening')).toBe('pause');
    expect(mediaButtonAction('stop', 'playing')).toBe('stopSpeaking');
    expect(mediaButtonAction('stop', 'idle')).toBe(null);
  });
});
