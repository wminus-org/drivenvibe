import { describe, expect, it } from 'vitest';
import { parseUtterance } from '../src/pwa/voice-commands.js';

describe('parseUtterance (hands-free spoken commands)', () => {
  it.each([
    ['cancel', 'cancel'],
    ['Cancel.', 'cancel'],
    ['  CANCEL!  ', 'cancel'],
    ['repeat', 'repeat'],
    ['Say again?', 'repeat'],
    ['say that again', 'repeat'],
    ['Stop listening.', 'stop'],
    ['hands-free off', 'stop'],
    ['Hands free off', 'stop'],
    ['handsfree off', 'stop'],
    ['send', 'send'],
    ['Send it.', 'send'],
  ])('%j as the whole utterance is the %s command', (text, command) => {
    expect(parseUtterance(text)).toEqual({ kind: 'command', command });
  });

  it('strips a trailing "send" and sends the rest, keeping its original casing', () => {
    expect(parseUtterance('Fix the login bug send')).toEqual({ kind: 'send', text: 'Fix the login bug' });
    expect(parseUtterance('Fix the login bug, send it.')).toEqual({ kind: 'send', text: 'Fix the login bug' });
    expect(parseUtterance('run the tests and send')).toEqual({ kind: 'send', text: 'run the tests' });
    expect(parseUtterance('run the tests then send it')).toEqual({ kind: 'send', text: 'run the tests' });
  });

  it('treats "send" inside a sentence as plain text, not a command', () => {
    expect(parseUtterance('send the email to Bob')).toEqual({ kind: 'text', text: 'send the email to Bob' });
    expect(parseUtterance('add a resend button')).toEqual({ kind: 'text', text: 'add a resend button' });
    expect(parseUtterance('cancel the old subscription flow')).toEqual({ kind: 'text', text: 'cancel the old subscription flow' });
  });

  it('only a final "send" word triggers sending, so a sentence that starts with send still can', () => {
    expect(parseUtterance('send the email to Bob send')).toEqual({ kind: 'send', text: 'send the email to Bob' });
  });

  it('does not send on a negated "send"', () => {
    expect(parseUtterance("draft the email but don't send")).toEqual({ kind: 'text', text: "draft the email but don't send" });
    expect(parseUtterance('write it, do not send')).toEqual({ kind: 'text', text: 'write it, do not send' });
  });

  it('returns empty for silence or punctuation only', () => {
    expect(parseUtterance('')).toEqual({ kind: 'empty' });
    expect(parseUtterance('  . ')).toEqual({ kind: 'empty' });
  });

  it('falls back to English for languages without their own word list', () => {
    expect(parseUtterance('cancel', 'de-DE')).toEqual({ kind: 'command', command: 'cancel' });
  });
});
