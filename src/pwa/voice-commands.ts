/**
 * Hands-free spoken commands. Pure (no DOM) so tests/voice-commands.test.ts can
 * cover it.
 *
 * Rules:
 * - A command counts only when it is the WHOLE utterance (case-insensitive,
 *   surrounding punctuation ignored): "cancel", "say again", "stop listening",
 *   "send". "cancel the old subscription flow" is plain text.
 * - "send" / "send it" as the LAST words sends the text before it right away,
 *   with an optional joiner ("… and send", "… then send it"). "send" anywhere
 *   else ("send the email to Bob") is plain text.
 * - A negated send ("… don't send", "… do not send") is plain text.
 *
 * Other languages: add an entry to LEXICONS keyed by the BCP-47 primary tag.
 */

export type VoiceCommand = 'cancel' | 'repeat' | 'stop' | 'send';

export type ParsedUtterance =
  | { kind: 'empty' }
  | { kind: 'command'; command: VoiceCommand }
  /** Text to send now, with the trailing send word removed. */
  | { kind: 'send'; text: string }
  | { kind: 'text'; text: string };

interface Lexicon {
  /** Whole-utterance phrases, normalised (lowercase, single spaces, no punctuation). */
  commands: Record<VoiceCommand, string[]>;
  /** Trailing words that mean "send this now". */
  sendSuffixes: string[];
  /** Words allowed between the text and the send suffix ("and send"). */
  joiners: string[];
  /** Words that, right before the send suffix, cancel it ("don't send"). */
  negations: string[];
}

const LEXICONS: Record<string, Lexicon> = {
  en: {
    commands: {
      cancel: ['cancel', 'cancel that', 'never mind'],
      repeat: ['repeat', 'repeat that', 'say again', 'say that again'],
      stop: ['stop listening', 'hands free off', 'handsfree off'],
      send: ['send', 'send it'],
    },
    sendSuffixes: ['send it', 'send'],
    joiners: ['and', 'then'],
    negations: ["don't", 'dont', 'do not', 'not', 'never'],
  },
};

const EDGE_PUNCT = /^[\s.,!?;:…"'“”-]+|[\s.,!?;:…"'“”-]+$/g;

function normalise(s: string): string {
  return s.toLowerCase().replace(/-/g, ' ').replace(EDGE_PUNCT, '').replace(/[.,!?;:…]/g, '').replace(/\s+/g, ' ').trim();
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
}

export function parseUtterance(raw: string, lang = 'en-US'): ParsedUtterance {
  const lex = LEXICONS[lang.split('-')[0].toLowerCase()] ?? LEXICONS.en;
  const text = raw.replace(EDGE_PUNCT, '').trim();
  const norm = normalise(raw);
  if (!norm) return { kind: 'empty' };

  for (const [command, phrases] of Object.entries(lex.commands) as [VoiceCommand, string[]][]) {
    if (phrases.includes(norm)) return { kind: 'command', command };
  }

  const suffix = lex.sendSuffixes.map(escape).join('|');
  const m = new RegExp(`^(.*?)[\\s,;:]+(?:(?:${lex.joiners.map(escape).join('|')})\\s+)?(?:${suffix})$`, 'i').exec(text);
  if (m) {
    const before = m[1].replace(EDGE_PUNCT, '').trim();
    const negated = new RegExp(`(?:^|\\s)(?:${lex.negations.map(escape).join('|')})$`, 'i').test(before);
    if (before && !negated) return { kind: 'send', text: before };
  }
  return { kind: 'text', text };
}
