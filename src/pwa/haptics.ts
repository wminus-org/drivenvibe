import { settingsStore } from './settings-store.js';

export function haptic(pattern: number | number[] = 20): void {
  if (!('vibrate' in navigator)) return;
  if (!settingsStore.getGlobal().haptics) return;
  navigator.vibrate(pattern);
}
