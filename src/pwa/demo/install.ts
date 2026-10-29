/**
 * Demo build only (vite --mode demo). Swaps the browser APIs the PWA talks to
 * for in-page fakes BEFORE main.ts runs: /api/* fetches, the /ws WebSocket,
 * SpeechRecognition (scripted phrase, no microphone) and speechSynthesis
 * (silent). The marker string below is what vite.config.ts greps for to keep
 * demo code out of the normal build.
 */
import type { ClientMessage, ServerMessage } from '../../../shared/protocol.js';
import { DemoServer, nextTranscript } from './server.js';

console.info('[DNV_DEMO_BUILD] drivenvibe demo: all data is fake and stays in this page.');

const server = new DemoServer();

// ── fetch: canned /api/*, everything else untouched ──────────────
const realFetch = window.fetch.bind(window);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
  if (url.pathname === '/api/config') return json(structuredClone(server.config));
  if (url.pathname === '/api/settings') return json(server.settings);
  return json({ error: 'not available in the demo' }, 404);
};

// ── WebSocket: one fake socket at a time, wired to the shared server ─
class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    setTimeout(() => {
      if (this.readyState !== FakeWebSocket.CONNECTING) return;
      this.readyState = FakeWebSocket.OPEN;
      server.emit = (msg) => this.deliver(msg);
      this.fire('open', new Event('open'));
      this.deliver({ type: 'ready' });
    }, 150);
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new DOMException('WebSocket is not open', 'InvalidStateError');
    server.handle(JSON.parse(data) as ClientMessage);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.fire('close', new Event('close'));
  }

  private deliver(msg: ServerMessage): void {
    // Async like a real socket, so handlers never re-enter the sender.
    setTimeout(() => {
      if (this.readyState === FakeWebSocket.OPEN) this.fire('message', new MessageEvent('message', { data: JSON.stringify(msg) }));
    }, 0);
  }

  private fire(type: 'open' | 'message' | 'close', ev: Event): void {
    const handler = this[`on${type}`] as ((e: Event) => void) | null;
    handler?.call(this, ev);
    this.dispatchEvent(ev);
  }
}
(window as any).WebSocket = FakeWebSocket;

// ── SpeechRecognition: types a scripted phrase word by word ─────
class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = 'en-US';
  onresult: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private words: string[] = [];

  start(): void {
    if (this.timer) throw new DOMException('recognition has already started', 'InvalidStateError');
    this.words = nextTranscript().split(' ');
    let shown = 0;
    this.timer = setInterval(() => {
      if (shown < this.words.length) this.result(this.words.slice(0, ++shown).join(' '), false);
    }, 180);
  }

  /** Finalises synchronously: Stt.stop() reads the text right after calling us. */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.result(this.words.join(' '), true);
    setTimeout(() => this.onend?.(), 0);
  }

  abort(): void { this.stop(); }

  private result(transcript: string, isFinal: boolean): void {
    const alt = Object.assign([{ transcript, confidence: 0.92 }], { isFinal });
    this.onresult?.({ resultIndex: 0, results: [alt] });
  }
}
(window as any).SpeechRecognition = FakeRecognition;
(window as any).webkitSpeechRecognition = FakeRecognition;

// ── speechSynthesis: silent, but takes as long as speaking would ─
let speaking: ReturnType<typeof setTimeout> | null = null;
const silentSynth = {
  get speaking() { return speaking !== null; },
  pending: false,
  paused: false,
  onvoiceschanged: null,
  getVoices: () => [],
  speak(u: SpeechSynthesisUtterance) {
    silentSynth.cancel();
    const ms = Math.min(6000, Math.max(800, (u.text.length * 55) / (u.rate || 1)));
    speaking = setTimeout(() => {
      speaking = null;
      u.onend?.call(u, new Event('end') as SpeechSynthesisEvent);
    }, ms);
  },
  // Like the app expects: a cancelled utterance fires no callbacks.
  cancel() {
    if (speaking) clearTimeout(speaking);
    speaking = null;
  },
  pause() {},
  resume() {},
  addEventListener() {},
  removeEventListener() {},
};
Object.defineProperty(window, 'speechSynthesis', { value: silentSynth, configurable: true });
if (!('SpeechSynthesisUtterance' in window)) {
  (window as any).SpeechSynthesisUtterance = class {
    rate = 1; pitch = 1; volume = 1; lang = '';
    onend: ((e: Event) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    constructor(public text = '') {}
  };
}
