import type { Theme } from '../../shared/protocol.js';
import { settingsStore } from './settings-store.js';

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

function applyTheme(theme: Theme): void {
  const resolved = theme === 'auto' ? (systemDark.matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  themeMeta?.setAttribute('content', resolved === 'dark' ? '#060708' : '#f4f5f7');
}

function syncTheme(): void {
  applyTheme(settingsStore.getGlobal().theme);
}

settingsStore.subscribe(syncTheme);
const onSystemThemeChange = () => {
  if (settingsStore.getGlobal().theme === 'auto') syncTheme();
};
if ('addEventListener' in systemDark) systemDark.addEventListener('change', onSystemThemeChange);
else (systemDark as MediaQueryList & { addListener?: (listener: () => void) => void }).addListener?.(onSystemThemeChange);

// Apply the system preference immediately; loadGlobal() will re-apply the
// persisted choice before the first real screen is shown.
syncTheme();
