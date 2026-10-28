import type { NewProjectPayload } from '../../shared/protocol.js';
import { haptic } from './haptics.js';
import { bindOverlayDialog, makeModalShell, makeTextField, makeColorPicker, makeEmojiField, makeActions } from './modal-utils.js';

export interface AddProjectModalHandle {
  close(): void;
}

export function renderAddProjectModal(
  parent: HTMLElement,
  opts: {
    onSubmit: (payload: NewProjectPayload) => void;
    onCancel: () => void;
  },
): AddProjectModalHandle {
  const { overlay, panel } = makeModalShell('Add Project');

  const { field: nameField, input: nameInput } = makeTextField('Name', 'My project');
  nameInput.maxLength = 80;
  panel.appendChild(nameField);

  const color = makeColorPicker(validate);
  panel.appendChild(color.field);

  const emoji = makeEmojiField('📁');
  panel.appendChild(emoji.field);

  const { actions, submitBtn } = makeActions('Add project', () => opts.onCancel(), () => {
    if (!color.commit()) return;
    const payload: NewProjectPayload = {
      label: nameInput.value.trim(),
      color: color.getColor(),
    };
    const e = emoji.getEmoji();
    if (e) payload.emoji = e;
    haptic(40);
    opts.onSubmit(payload);
  });
  panel.appendChild(actions);
  parent.appendChild(overlay);

  const dialog = bindOverlayDialog(overlay, panel, {
    onDismiss: opts.onCancel,
    initialFocus: nameInput,
    submitButton: submitBtn,
  });

  function validate() {
    const nameOk = nameInput.value.trim().length > 0;
    submitBtn.disabled = !(nameOk && color.isValid());
  }

  nameInput.addEventListener('input', validate);

  requestAnimationFrame(() => panel.classList.add('modal-panel-in'));

  return {
    close() {
      dialog.dispose();
      overlay.remove();
    },
  };
}
