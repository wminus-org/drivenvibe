import type { NotificationPayload } from './notification-overlay.js';

export interface NotificationQueueHandle {
  enqueue(payload: NotificationPayload): void;
  drain(): void;
  remove(session_id: string): void;
  size(): number;
}

export function createNotificationQueue(deps: {
  canShowNow: () => boolean;
  showOverlay: (p: NotificationPayload, onAccept: () => void, onDismiss: () => void) => void;
  onAccept: (p: NotificationPayload) => void;
  onDismiss: (p: NotificationPayload) => void;
}): NotificationQueueHandle {
  const queue: NotificationPayload[] = [];
  let activeSessionId: string | null = null;

  function tryShowNext() {
    if (!deps.canShowNow()) return;
    if (activeSessionId !== null) return;
    const next = queue.shift();
    if (!next) return;
    activeSessionId = next.session_id;
    deps.showOverlay(
      next,
      () => {
        activeSessionId = null;
        deps.onAccept(next);
        tryShowNext();
      },
      () => {
        activeSessionId = null;
        deps.onDismiss(next);
        tryShowNext();
      },
    );
  }

  return {
    enqueue(payload) {
      // Dedupe: ignore if already active or queued
      if (activeSessionId === payload.session_id) return;
      if (queue.some((p) => p.session_id === payload.session_id)) return;
      queue.push(payload);
      tryShowNext();
    },

    drain() {
      tryShowNext();
    },

    remove(session_id) {
      const idx = queue.findIndex((p) => p.session_id === session_id);
      if (idx !== -1) queue.splice(idx, 1);
    },

    size() {
      return queue.length + (activeSessionId !== null ? 1 : 0);
    },
  };
}
