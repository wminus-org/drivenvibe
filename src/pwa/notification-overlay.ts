export interface NotificationPayload {
  session_id: string;
  project_id: string;
  label: string;
  color: string;
  emoji?: string;
}

export interface NotificationOverlayHandle {
  isShowing(): boolean;
  show(payload: NotificationPayload, opts: {
    onAccept: () => void;
    onDismiss: () => void;
  }): void;
  dismiss(): void;
}

const COUNTDOWN_SECONDS = 20;

export function createNotificationOverlay(parent: HTMLElement): NotificationOverlayHandle {
  const el = document.createElement('div');
  el.className = 'notification-overlay';
  el.style.display = 'none';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-hidden', 'true');
  parent.appendChild(el);

  let showing = false;
  let timerId: ReturnType<typeof setInterval> | null = null;
  let currentOnDismiss: (() => void) | null = null;
  let previousFocus: HTMLElement | null = null;
  let onKeyDown: ((event: KeyboardEvent) => void) | null = null;

  function cleanup() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
    showing = false;
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '';
    if (onKeyDown) el.removeEventListener('keydown', onKeyDown);
    onKeyDown = null;
    const screen = parent.querySelector<HTMLElement>('#screen');
    if (screen) screen.inert = false;
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
    currentOnDismiss = null;
  }

  return {
    isShowing() {
      return showing;
    },

    show(payload, opts) {
      cleanup();
      showing = true;
      currentOnDismiss = opts.onDismiss;
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      // Build hex color with 0.95 alpha as rgba
      const hex = payload.color.replace('#', '');
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      el.style.background = `rgba(${r}, ${g}, ${b}, 0.95)`;
      el.style.display = 'flex';
      el.setAttribute('aria-hidden', 'false');
      const screen = parent.querySelector<HTMLElement>('#screen');
      if (screen) screen.inert = true;

      const heading = document.createElement('div');
      heading.className = 'notif-heading';
      heading.textContent = (payload.emoji ? payload.emoji + ' ' : '') + payload.label;

      const subtext = document.createElement('div');
      subtext.className = 'notif-subtext';
      subtext.textContent = 'Tap to hear response';

      let remaining = COUNTDOWN_SECONDS;
      const countdown = document.createElement('div');
      countdown.className = 'notif-countdown';
      countdown.textContent = String(remaining);
      countdown.setAttribute('aria-hidden', 'true');

      const tapBtn = document.createElement('button');
      tapBtn.className = 'notif-tap-btn';
      tapBtn.setAttribute('aria-label', `Hear response from ${payload.label}`);
      tapBtn.appendChild(heading);
      tapBtn.appendChild(subtext);
      tapBtn.appendChild(countdown);
      tapBtn.addEventListener('click', () => {
        cleanup();
        opts.onAccept();
      });

      const dismissBtn = document.createElement('button');
      dismissBtn.className = 'notif-dismiss-btn';
      dismissBtn.textContent = 'NOT NOW';
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cb = opts.onDismiss;
        cleanup();
        cb();
      });

      el.innerHTML = '';
      el.appendChild(tapBtn);
      el.appendChild(dismissBtn);

      onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          const cb = opts.onDismiss;
          cleanup();
          cb();
        } else if (event.key === 'Tab') {
          if (event.shiftKey && document.activeElement === tapBtn) {
            event.preventDefault();
            dismissBtn.focus();
          } else if (!event.shiftKey && document.activeElement === dismissBtn) {
            event.preventDefault();
            tapBtn.focus();
          }
        }
      };
      el.addEventListener('keydown', onKeyDown);
      requestAnimationFrame(() => tapBtn.focus());

      timerId = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        remaining -= 1;
        countdown.textContent = String(remaining);
        if (remaining <= 0) {
          const cb = opts.onDismiss;
          cleanup();
          cb();
        }
      }, 1000);
    },

    dismiss() {
      const cb = currentOnDismiss;
      cleanup();
      cb?.();
    },
  };
}
