/**
 * Short audio cues for state transitions — much faster + less distracting
 * than spoken labels ("Recording", "Sending") when you're driving.
 */
let ctx: AudioContext | null = null;
function ac(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  // Resume on user-gesture (browsers suspend AC until interaction).
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function beep(freq: number, durationMs: number, volume = 0.08, type: OscillatorType = 'sine') {
  const c = ac();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + durationMs / 1000);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + durationMs / 1000);
}

function chord(notes: Array<[number, number]>) {
  notes.forEach(([freq, delay]) => setTimeout(() => beep(freq, 80, 0.08), delay));
}

export const tones = {
  /** Rising two-note: starting to listen */
  start: () => chord([[660, 0], [880, 90]]),
  /** Single mid note: paused */
  pause: () => beep(523, 130, 0.08),
  /** Single mid-high: resumed */
  resume: () => beep(740, 120, 0.08),
  /** Rising chime: sent successfully */
  send: () => chord([[523, 0], [659, 70], [784, 140]]),
  /** Low buzz: error */
  error: () => beep(180, 280, 0.1, 'square'),
  /** Soft notification: Claude is responding */
  reply: () => beep(880, 70, 0.05),
  /** Descending two-note: cleared */
  clear: () => chord([[523, 0], [392, 90]]),
};
