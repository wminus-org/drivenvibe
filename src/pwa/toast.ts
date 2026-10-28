import { haptic } from './haptics.js';

export type ToastKind = 'error' | 'info' | 'success';

export interface ToastHandle {
  show(text: string, kind?: ToastKind, opts?: {
    durationMs?: number;
    actionLabel?: string;
    onAction?: () => void;
  }): void;
}

const MAX_VISIBLE = 3;

export function createToastManager(parent: HTMLElement): ToastHandle {
  const container = document.createElement('div');
  container.className = 'toast-container';
  parent.appendChild(container);

  const active: { el: HTMLElement; timer: ReturnType<typeof setTimeout> }[] = [];

  function dismiss(el: HTMLElement, timer: ReturnType<typeof setTimeout>) {
    clearTimeout(timer);
    const idx = active.findIndex((t) => t.el === el);
    if (idx !== -1) active.splice(idx, 1);
    el.classList.add('toast-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 300);
  }

  return {
    show(text, kind = 'info', opts) {
      const durationMs = opts?.durationMs ?? 3000;

      if (kind === 'error') haptic(20);

      // If at cap, force-dismiss the oldest
      while (active.length >= MAX_VISIBLE) {
        const oldest = active[0];
        dismiss(oldest.el, oldest.timer);
      }

      const el = document.createElement('div');
      el.className = `toast toast-${kind}`;
      el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      const message = document.createElement('span');
      message.className = 'toast-message';
      message.textContent = text;
      el.appendChild(message);

      if (opts?.actionLabel && opts.onAction) {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'toast-action';
        action.textContent = opts.actionLabel;
        action.addEventListener('click', (event) => {
          event.stopPropagation();
          opts.onAction?.();
          dismiss(el, timer);
        });
        el.appendChild(action);
      }

      el.addEventListener('click', () => dismiss(el, timer));
      container.appendChild(el);

      // Force reflow so slide-in animation plays
      void el.offsetWidth;
      el.classList.add('toast-in');

      const timer = setTimeout(() => dismiss(el, timer), durationMs);
      active.push({ el, timer });
    },
  };
}
