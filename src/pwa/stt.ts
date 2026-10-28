/**
 * Browser SpeechRecognition wrapper (Web Speech API).
 * On Android Chrome this uses Google's STT service; on iOS Safari, Apple's.
 * No API key, no audio upload — recognition happens via the platform.
 */

type SR = any; // SpeechRecognition isn't in lib.dom for all TS versions

export interface SttCallbacks {
  /** Fires whenever the transcript (final + interim) changes. */
  onUpdate: (full: string, interim: string) => void;
  /** Fires once when recognition fully stops (either via stop() or unrecoverable end). */
  onEnd: (final: string) => void;
  /** Fires on non-recoverable errors (no mic, permission denied, etc). */
  onError: (msg: string) => void;
}

export class Stt {
  private rec: SR | null = null;
  private active = false;
  private finalText = '';
  private interimText = '';
  private cbs: SttCallbacks | null = null;

  static isSupported(): boolean {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  start(lang: string, cbs: SttCallbacks): void {
    const Ctor: any =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      cbs.onError('SpeechRecognition not supported in this browser');
      return;
    }

    const rec: SR = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    this.rec = rec;
    this.cbs = cbs;
    this.finalText = '';
    this.interimText = '';
    this.active = true;

    rec.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          this.finalText += r[0].transcript;
        } else {
          interim += r[0].transcript;
        }
      }
      this.interimText = interim;
      this.cbs?.onUpdate(this.fullText(), interim);
    };

    rec.onerror = (e: any) => {
      // 'no-speech' and 'aborted' are common and recoverable; ignore.
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.cbs?.onError(String(e.error ?? 'unknown'));
    };

    rec.onend = () => {
      // Chrome auto-stops recognition periodically; if user hasn't tapped STOP, restart.
      if (this.active) {
        try {
          rec.start();
          return;
        } catch {
          // Restart failed — treat as a real end.
          this.active = false;
        }
      }
      this.cbs?.onEnd(this.fullText());
    };

    try {
      rec.start();
    } catch (e: any) {
      this.active = false;
      cbs.onError(e?.message ?? 'failed to start');
    }
  }

  stop(): string {
    this.active = false;
    if (this.rec) {
      try { this.rec.stop(); } catch {}
    }
    return this.fullText();
  }

  fullText(): string {
    const t = (this.finalText + ' ' + this.interimText).trim();
    return t.replace(/\s+/g, ' ');
  }
}
