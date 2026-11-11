/**
 * Media-button trigger for hands-free (docs/hands-free.md).
 *
 * Browsers send headset / steering-wheel buttons (MediaSession actions) only to
 * the page that holds the active media session, and they pick that page from
 * its playing <audio>/<video> elements. speechSynthesis and Web Audio beeps do
 * not count. So while hands-free is on we loop a short clip of digital silence
 * in a plain (unmuted) <audio> element, started from the toggle's tap.
 *
 * ponytail: costs a little battery (the audio output path stays awake) and may
 * be paused by the OS when another app (a call, navigation prompts, music) takes
 * audio focus; we do not fight that. Unverified on real car head units.
 */

let el: HTMLAudioElement | null = null;

/** 8 kHz, 8-bit mono PCM WAV of silence (sample value 128). 6 s: Chrome ignores media under 5 s for its media notification. */
function silentWav(seconds = 6, rate = 8000): Blob {
  const n = seconds * rate;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  return new Blob([buf], { type: 'audio/wav' });
}

/** Call from a user gesture (autoplay rules). Safe to call repeatedly. */
export function startMediaKeepalive(): void {
  if (typeof Audio === 'undefined') return;
  if (!el) {
    el = new Audio(URL.createObjectURL(silentWav()));
    el.loop = true;
    el.setAttribute('aria-hidden', 'true');
  }
  if (el.paused) el.play().catch(() => { /* autoplay refused: buttons just won't reach us */ });
}

export function stopMediaKeepalive(): void {
  el?.pause();
}
