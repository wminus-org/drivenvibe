import type { SessionPublic } from '../../shared/protocol.js';
import { haptic } from './haptics.js';
import { bindOverlayDialog } from './modal-utils.js';

export interface SessionActionSheetHandle {
  close(): void;
}

export function renderSessionActionSheet(
  parent: HTMLElement,
  session: SessionPublic,
  handlers: {
    onOpen: () => void;
    onEdit: () => void;
    onArchive: () => void;
    onDismiss: () => void;
  },
): SessionActionSheetHandle {
  const overlay = document.createElement('div');
  overlay.className = 'action-sheet-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'action-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.tabIndex = -1;

  const header = document.createElement('div');
  header.className = 'action-sheet-header';
  const headerLabel = document.createElement('span');
  headerLabel.id = `session-actions-${session.id}`;
  headerLabel.textContent = (session.emoji ? session.emoji + ' ' : '') + session.label;
  sheet.setAttribute('aria-labelledby', headerLabel.id);
  header.appendChild(headerLabel);
  sheet.appendChild(header);

  function makeRow(text: string, extraClass?: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'action-sheet-row' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = text;
    return btn;
  }

  const openBtn = makeRow('Open');
  openBtn.classList.add('primary');
  openBtn.addEventListener('click', () => {
    dismiss();
    handlers.onOpen();
  });
  sheet.appendChild(openBtn);

  const editBtn = makeRow('Session settings');
  editBtn.addEventListener('click', () => {
    dismiss();
    handlers.onEdit();
  });
  sheet.appendChild(editBtn);

  // Archive — two-tap confirm within 3s
  const archiveBtn = makeRow('Archive', 'danger');
  let archiveTimer: ReturnType<typeof setTimeout> | null = null;
  archiveBtn.addEventListener('click', () => {
    if (archiveBtn.classList.contains('confirming')) {
      if (archiveTimer !== null) {
        clearTimeout(archiveTimer);
        archiveTimer = null;
      }
      haptic([60, 40, 60]);
      dismiss();
      handlers.onArchive();
      return;
    }
    archiveBtn.classList.add('confirming');
    archiveBtn.textContent = 'Confirm archive?';
    archiveTimer = setTimeout(() => {
      archiveBtn.classList.remove('confirming');
      archiveBtn.textContent = 'Archive';
      archiveTimer = null;
    }, 3000);
  });
  sheet.appendChild(archiveBtn);

  const cancelBtn = makeRow('Cancel');
  cancelBtn.classList.add('cancel');
  cancelBtn.addEventListener('click', dismiss);
  sheet.appendChild(cancelBtn);

  overlay.appendChild(sheet);
  parent.appendChild(overlay);

  const dialog = bindOverlayDialog(overlay, sheet, {
    onDismiss: dismiss,
    initialFocus: openBtn,
  });

  requestAnimationFrame(() => sheet.classList.add('action-sheet-in'));

  function dismiss() {
    if (archiveTimer !== null) clearTimeout(archiveTimer);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dialog.dispose();
      overlay.remove();
      handlers.onDismiss();
    };
    sheet.classList.remove('action-sheet-in');
    sheet.classList.add('action-sheet-out');
    sheet.addEventListener('transitionend', finish, { once: true });
    // Fallback: if the close animation never fires (reduced-motion, missing
    // CSS), still tear down so the overlay can't get stuck on screen.
    setTimeout(finish, 400);
  }

  return {
    close() {
      if (archiveTimer !== null) clearTimeout(archiveTimer);
      dialog.dispose();
      overlay.remove();
    },
  };
}
