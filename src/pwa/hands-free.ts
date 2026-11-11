/**
 * Hands-free loop (issue #48): answer spoken → listen → send on "… send" or
 * after a silence window → answer spoken → listen again.
 *
 * Pure (no DOM): main.ts owns the session state machine and injects the
 * actions; tests/hands-free.test.ts drives this with fakes. See docs/hands-free.md.
 */
import type { SessionState } from './session-screen.js';
import { parseUtterance, type VoiceCommand } from './voice-commands.js';

/** No new recognition result for this long, with text heard → send. */
export const SILENCE_SEND_MS = 2000;
/** A request running this long gets one spoken "Still working". */
export const STILL_WORKING_MS = 20_000;
export const HANDS_FREE_STORAGE_KEY = 'dnv-hands-free';

export interface HandsFreeDeps {
  /** Start a fresh listening segment: clears the draft, plays the listening cue. */
  listen(): void;
  /** Stop recognition and drop what this segment heard (e.g. the command words). */
  stopListening(): void;
  /** Stop recognition and send exactly `text`. */
  send(text: string): void;
  /** Draft committed before the current listening segment. */
  draft(): string;
  /** Ask for the last answer again; false when there is none. */
  replay(): boolean;
  say(text: string, then?: () => void): void;
  lang(): string;
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): KeyValueStorage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export class HandsFree {
  private on = false;
  /** False after navigation until a user gesture / media button (mic autostart rules). */
  private armed = false;
  private silence: ReturnType<typeof setTimeout> | null = null;
  private stillWorking: ReturnType<typeof setTimeout> | null = null;
  private wasConnected: boolean | null = null;

  constructor(private readonly deps: HandsFreeDeps, private readonly storage: KeyValueStorage | null = defaultStorage()) {
    try { this.on = storage?.getItem(HANDS_FREE_STORAGE_KEY) === '1'; } catch { /* storage blocked */ }
  }

  get enabled(): boolean { return this.on; }

  /** From the toggle (a user gesture), so it arms the loop too. */
  setEnabled(on: boolean): void {
    this.on = on;
    this.armed = on;
    try { this.storage?.setItem(HANDS_FREE_STORAGE_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
    if (!on) this.clearTimers();
  }

  /** A user gesture or media button on the session screen. */
  arm(): void { this.armed = true; }

  /** Left the session screen: stop the loop until the next gesture. */
  suspend(): void {
    this.armed = false;
    this.clearSilence();
  }

  private get live(): boolean { return this.on && this.armed; }

  answerSpoken(): void {
    if (this.live) this.deps.listen();
  }

  /** Every recognition update. `utterance` = this segment's text, `interim` = its unfinished tail. */
  hear(utterance: string, interim: string): void {
    if (!this.live) return;
    this.clearSilence();
    if (!utterance.trim()) return;
    // Act on final text at once; interim text may still change ("send" → "sender").
    if (!interim.trim() && this.act(utterance, false)) return;
    this.silence = setTimeout(() => {
      this.silence = null;
      if (this.live) this.act(utterance, true);
    }, SILENCE_SEND_MS);
  }

  /** Returns true when it acted. Plain text only goes out once the silence window ends. */
  private act(utterance: string, silenceEnded: boolean): boolean {
    const p = parseUtterance(utterance, this.deps.lang());
    if (p.kind === 'command') { this.command(p.command); return true; }
    if (p.kind === 'send' || (p.kind === 'text' && silenceEnded)) { this.sendDraftPlus(p.text); return true; }
    return false;
  }

  private sendDraftPlus(text: string): void {
    const full = [this.deps.draft().trim(), text.trim()].filter(Boolean).join(' ');
    if (full) { this.deps.send(full); return; }
    this.deps.stopListening();
    this.deps.say('Nothing to send', () => this.answerSpoken());
  }

  private command(c: VoiceCommand): void {
    this.clearSilence();
    switch (c) {
      case 'send':
        this.sendDraftPlus('');
        return;
      case 'cancel':
        this.deps.stopListening();
        this.deps.listen();
        return;
      case 'repeat':
        this.deps.stopListening();
        // The replayed answer flows back through answerSpoken() → listen.
        if (!this.deps.replay()) this.deps.say('Nothing to repeat', () => this.answerSpoken());
        return;
      case 'stop':
        this.setEnabled(false);
        this.deps.stopListening();
        this.deps.say('Hands-free off');
        return;
    }
  }

  /** True while a request is processing/queued. "Still working" fires once per request. */
  busy(isBusy: boolean): void {
    if (!isBusy) {
      if (this.stillWorking) clearTimeout(this.stillWorking);
      this.stillWorking = null;
      return;
    }
    if (this.stillWorking || !this.on) return;
    this.stillWorking = setTimeout(() => {
      // Keep the handle (not null) until busy(false), so it cannot re-arm this request.
      if (this.on) this.deps.say('Still working');
    }, STILL_WORKING_MS);
  }

  connection(connected: boolean): void {
    const changed = this.wasConnected !== null && this.wasConnected !== connected;
    this.wasConnected = connected;
    if (changed && this.on) this.deps.say(connected ? 'Back online' : 'Connection lost');
  }

  private clearSilence(): void {
    if (this.silence) clearTimeout(this.silence);
    this.silence = null;
  }

  private clearTimers(): void {
    this.clearSilence();
    this.busy(false);
  }
}

export type MediaButton = 'play' | 'pause' | 'nexttrack' | 'previoustrack' | 'stop';
export type MediaButtonAction =
  | 'listen' | 'resume' | 'send' | 'bargeIn' | 'repeat' | 'status' | 'cancel' | 'pause' | 'stopSpeaking' | null;

/**
 * What a headset / steering-wheel button does in hands-free. The single main
 * button (play/pause) walks the loop. Cancelling a running request needs the
 * explicit "stop" action: a stray press must not throw away agent work.
 */
export function mediaButtonAction(button: MediaButton, state: SessionState): MediaButtonAction {
  if (state === 'processing' || state === 'queued') return button === 'stop' ? 'cancel' : 'status';
  if (button === 'stop') return state === 'listening' ? 'pause' : state === 'playing' ? 'stopSpeaking' : null;
  if (button === 'previoustrack') return 'repeat';
  if (state === 'listening') return 'send';
  if (state === 'playing') return 'bargeIn';
  return state === 'paused' ? 'resume' : 'listen';
}
