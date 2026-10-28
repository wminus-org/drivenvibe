import { apiFetch } from './api-fetch.js';
import { PLAN_REQUIRED_ERROR, PLAN_REQUIRED_STATUS } from '../../shared/relay-protocol.js';

export const DEFAULT_PRO_PRICE_LABEL = '€7 / month';
export const SELF_HOST_URL = 'https://github.com/wminus-org/drivenvibe#desktop-setup';
const CHECKOUT_PARAM = 'checkout';

export interface UpgradeScreenHandlers {
  onRetry: () => void;
  onSignOut: () => void;
  /** True right after returning from a successful checkout (plan may still be syncing). */
  checkoutPending?: boolean;
}

/** Boot's /api/config said the hosted relay needs Pro. */
export function isPlanRequired(status: number, body: unknown): boolean {
  return status === PLAN_REQUIRED_STATUS
    && typeof body === 'object' && body !== null
    && (body as { error?: unknown }).error === PLAN_REQUIRED_ERROR;
}

export function proPriceLabel(raw: string | undefined): string {
  return raw?.trim() || DEFAULT_PRO_PRICE_LABEL;
}

/** The checkout URL from POST /api/checkout, or null unless it is a well-formed https URL. */
export function checkoutUrlFrom(body: unknown): string | null {
  const url = typeof body === 'object' && body !== null ? (body as { url?: unknown }).url : undefined;
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * If `href` carries ?checkout=success (Polar's success_url), returns the
 * same-origin path to replace it with (param removed); otherwise null.
 */
export function takeCheckoutSuccess(href: string): string | null {
  const url = new URL(href);
  if (url.searchParams.get(CHECKOUT_PARAM) !== 'success') return null;
  url.searchParams.delete(CHECKOUT_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** POST /api/checkout and hand the browser to Polar's hosted checkout. */
export async function startCheckout(navigate: (url: string) => void): Promise<void> {
  const res = await apiFetch('/api/checkout', { method: 'POST' });
  if (!res.ok) throw new Error(`checkout failed (${res.status})`);
  const url = checkoutUrlFrom(await res.json().catch(() => null));
  if (!url) throw new Error('checkout url invalid');
  navigate(url);
}

/**
 * Cloud-mode-only "hosted relay needs Pro" panel. Shown when boot's
 * /api/config answers 402 plan_required. Reuses the connect-screen styles.
 */
export function renderUpgradeScreen(root: HTMLElement, handlers: UpgradeScreenHandlers): void {
  root.innerHTML = '';
  root.setAttribute('aria-busy', 'false');
  document.title = 'Upgrade · drivenvibe';

  const wrap = document.createElement('div');
  wrap.className = 'boot-error connect-screen upgrade-screen';

  const heading = document.createElement('h1');
  heading.className = 'connect-heading';
  heading.textContent = handlers.checkoutPending ? 'Activating drivenvibe Pro…' : 'drivenvibe Pro';

  const copy = document.createElement('p');
  copy.className = 'connect-copy';
  copy.textContent = handlers.checkoutPending
    ? 'Thanks! Your payment went through. It can take a few seconds to unlock the hosted relay — tap Retry in a moment.'
    : 'The hosted relay at app.drivenvibe.com is part of drivenvibe Pro. ' +
      'Running drivenvibe on your own network or tunnel stays free.';

  const price = document.createElement('p');
  price.className = 'upgrade-price';
  price.textContent = proPriceLabel(import.meta.env.VITE_PRO_PRICE_LABEL);

  const errorText = document.createElement('p');
  errorText.className = 'connect-error';
  errorText.setAttribute('role', 'alert');
  errorText.hidden = true;

  const upgradeBtn = document.createElement('button');
  upgradeBtn.className = 'modal-submit';
  upgradeBtn.textContent = 'Upgrade to Pro';
  upgradeBtn.addEventListener('click', async () => {
    upgradeBtn.disabled = true;
    upgradeBtn.setAttribute('aria-busy', 'true');
    upgradeBtn.textContent = 'Opening checkout…';
    errorText.hidden = true;
    try {
      await startCheckout((url) => location.assign(url));
    } catch {
      errorText.textContent = 'Checkout could not be opened — check your connection and try again.';
      errorText.hidden = false;
      upgradeBtn.disabled = false;
      upgradeBtn.removeAttribute('aria-busy');
      upgradeBtn.textContent = 'Upgrade to Pro';
    }
  });

  const selfHost = document.createElement('a');
  selfHost.className = 'upgrade-selfhost';
  selfHost.href = SELF_HOST_URL;
  selfHost.target = '_blank';
  selfHost.rel = 'noopener noreferrer';
  selfHost.textContent = 'Self-host for free';

  const retryBtn = document.createElement('button');
  retryBtn.className = 'modal-cancel';
  retryBtn.textContent = 'Retry';
  retryBtn.addEventListener('click', handlers.onRetry);

  const signOutBtn = document.createElement('button');
  signOutBtn.className = 'connect-signout';
  signOutBtn.textContent = 'Sign out';
  signOutBtn.addEventListener('click', handlers.onSignOut);

  if (handlers.checkoutPending) {
    wrap.append(heading, copy, retryBtn, errorText, signOutBtn);
  } else {
    wrap.append(heading, copy, price, upgradeBtn, errorText, selfHost, retryBtn, signOutBtn);
  }
  root.appendChild(wrap);
}
