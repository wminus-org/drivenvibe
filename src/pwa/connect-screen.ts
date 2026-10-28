import { apiFetch } from './api-fetch.js';

export interface ConnectScreenHandlers {
  onRetry: () => void;
  onSignOut: () => void;
}

/**
 * Cloud-mode-only "your computer is offline" panel. Shown when boot's
 * /api/config comes back 503 desktop_offline, or a desktop_status
 * {online:false} arrives while the app is up.
 */
export function renderConnectScreen(root: HTMLElement, handlers: ConnectScreenHandlers): void {
  root.innerHTML = '';
  root.setAttribute('aria-busy', 'false');
  document.title = 'Connect computer · drivenvibe';

  const wrap = document.createElement('div');
  wrap.className = 'boot-error connect-screen';

  const heading = document.createElement('h1');
  heading.className = 'connect-heading';
  heading.textContent = 'Connect your computer';

  const copy = document.createElement('p');
  copy.className = 'connect-copy';
  copy.innerHTML =
    'Install and run the drivenvibe desktop server on your computer. ' +
    'Paste a link token into <code>~/.drivenvibe/settings.json</code> ' +
    '(field <code>relay_token</code>), then restart it.';

  const generateBtn = document.createElement('button');
  generateBtn.className = 'modal-submit';
  generateBtn.textContent = 'Generate link token';

  const tokenBox = document.createElement('div');
  tokenBox.className = 'connect-token-box';
  tokenBox.hidden = true;
  const tokenText = document.createElement('div');
  tokenText.className = 'dnv-readonly connect-token';
  tokenText.tabIndex = 0;
  const copyBtn = document.createElement('button');
  copyBtn.className = 'modal-cancel';
  copyBtn.textContent = 'Copy';
  tokenBox.append(tokenText, copyBtn);

  const errorText = document.createElement('p');
  errorText.className = 'connect-error';
  errorText.setAttribute('role', 'alert');
  errorText.hidden = true;

  generateBtn.addEventListener('click', async () => {
    generateBtn.disabled = true;
    generateBtn.setAttribute('aria-busy', 'true');
    generateBtn.textContent = 'Generating…';
    errorText.hidden = true;
    try {
      const res = await apiFetch('/api/device-token', { method: 'POST' });
      if (!res.ok) throw new Error(`server error ${res.status}`);
      const { token } = (await res.json()) as { token: string };
      tokenText.textContent = token;
      tokenBox.hidden = false;
      tokenText.focus();
    } catch {
      errorText.textContent = 'Could not generate a token — check your connection and try again.';
      errorText.hidden = false;
    } finally {
      generateBtn.disabled = false;
      generateBtn.removeAttribute('aria-busy');
      generateBtn.textContent = 'Generate link token';
    }
  });

  copyBtn.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(tokenText.textContent ?? '');
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    } catch {
      errorText.textContent = 'Copy is unavailable. Select the token above and copy it manually.';
      errorText.hidden = false;
      tokenText.focus();
    }
  });

  const retryBtn = document.createElement('button');
  retryBtn.className = 'modal-cancel';
  retryBtn.textContent = 'Retry';
  retryBtn.addEventListener('click', handlers.onRetry);

  const signOutBtn = document.createElement('button');
  signOutBtn.className = 'connect-signout';
  signOutBtn.textContent = 'Sign out';
  signOutBtn.addEventListener('click', handlers.onSignOut);

  wrap.append(heading, copy, generateBtn, tokenBox, errorText, retryBtn, signOutBtn);
  root.appendChild(wrap);
}
