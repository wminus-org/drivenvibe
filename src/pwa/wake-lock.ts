let sentinel: WakeLockSentinel | null = null;

export async function requestWakeLock(): Promise<void> {
  if (document.visibilityState !== 'visible' || sentinel) return;
  try {
    sentinel = await navigator.wakeLock?.request('screen') ?? null;
    sentinel?.addEventListener('release', () => { sentinel = null; }, { once: true });
  } catch (e) {
    sentinel = null;
    console.warn('wake lock failed', e);
  }
}

// Re-request when visibility returns
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});
