import type { ConnStatus } from './ws-client.js';

export interface ConnectionStatusHandle {
  set(status: ConnStatus): void;
}

/**
 * A small pill that drops in from the top only while the socket is down.
 * Silent when connected — for a driving tool, you only want to be told when
 * something needs attention.
 */
export function createConnectionStatus(parent: HTMLElement): ConnectionStatusHandle {
  const el = document.createElement('div');
  el.className = 'conn-status';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-hidden', 'true');
  const dot = document.createElement('span');
  dot.className = 'dot';
  const label = document.createElement('span');
  el.append(dot, label);
  parent.appendChild(el);

  return {
    set(status) {
      if (status === 'open') {
        el.classList.remove('show');
        el.setAttribute('aria-hidden', 'true');
        label.textContent = '';
        return;
      }
      label.textContent = status === 'connecting' ? 'Reconnecting…' : 'Offline';
      el.classList.toggle('conn-offline', status === 'closed');
      el.classList.add('show');
      el.setAttribute('aria-hidden', 'false');
    },
  };
}
