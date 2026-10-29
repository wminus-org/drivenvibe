import type { Clerk as ClerkClass } from '@clerk/clerk-js';

let clerk: ClerkClass | null = null;

/** Matches the app's dark palette (see style.css :root). */
const DARK_APPEARANCE = {
  variables: {
    colorBackground: '#000000',
    colorInputBackground: '#1c1c1e',
    colorInputText: '#ffffff',
    colorText: '#ffffff',
    colorTextSecondary: 'rgba(235, 235, 245, 0.55)',
    colorPrimary: '#0a84ff',
    colorDanger: '#ff3b30',
    colorNeutral: '#ffffff',
    borderRadius: '14px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter, system-ui, sans-serif',
  },
  elements: {
    rootBox: { width: '100%' },
    card: { backgroundColor: 'transparent', boxShadow: 'none' },
  },
};

/**
 * Loads Clerk (dynamic import — never pulled into the local build). If
 * nobody is signed in, mounts a full-screen sign-in panel into `root` and
 * waits until sign-in completes. Resolves once a user session exists.
 */
export async function initCloud(publishableKey: string, root: HTMLElement): Promise<void> {
  if (!clerk) {
    const { Clerk } = await import('@clerk/clerk-js');
    clerk = new Clerk(publishableKey);
    await clerk.load();
  }
  if (clerk.user) return;

  await new Promise<void>((resolve) => {
    root.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'cloud-signin';
    root.appendChild(wrap);
    clerk!.mountSignIn(wrap, { appearance: DARK_APPEARANCE as any });
    const unsubscribe = clerk!.addListener(({ user }) => {
      if (user) {
        unsubscribe();
        clerk!.unmountSignIn(wrap);
        resolve();
      }
    });
  });
}

/** Fresh session token for the WS `?auth=` param and API Authorization headers. */
export async function getToken(): Promise<string | null> {
  if (!clerk?.session) return null;
  return clerk.session.getToken();
}

/**
 * Forces a new session token from Clerk (skipping its token cache) so a plan
 * change written to public_metadata — e.g. right after checkout — reaches the
 * relay through the `plan` claim instead of waiting for the cached token to expire.
 */
export async function refreshToken(): Promise<void> {
  await clerk?.session?.getToken({ skipCache: true });
}

export async function signOut(): Promise<void> {
  await clerk?.signOut();
}
