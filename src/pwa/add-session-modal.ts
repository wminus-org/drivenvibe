import type { NewSessionPayload, Provider } from '../../shared/protocol.js';
import { haptic } from './haptics.js';
import { bindOverlayDialog, makeModalShell, makeField, makeTextField, makeColorPicker, makeEmojiField, makeActions } from './modal-utils.js';

export interface AddSessionModalHandle {
  close(): void;
}

const isWindows = /Win/.test(navigator.userAgent);

export function renderAddSessionModal(
  parent: HTMLElement,
  opts: {
    projectId: string;
    defaultProvider: Provider;
    onSubmit: (payload: NewSessionPayload) => void;
    onCancel: () => void;
  },
): AddSessionModalHandle {
  const { overlay, panel } = makeModalShell('Add Session');

  const { field: nameField, input: nameInput } = makeTextField('Name', 'My session');
  nameInput.maxLength = 80;
  panel.appendChild(nameField);

  const color = makeColorPicker(validate);
  panel.appendChild(color.field);

  const emoji = makeEmojiField('🚀');
  panel.appendChild(emoji.field);

  const { field: folderField, input: folderInput } = makeTextField(
    'Folder path',
    isWindows ? 'C:\\Users\\you\\projects\\myapp' : '/Users/you/projects/myapp',
  );
  panel.appendChild(folderField);

  // Provider
  const providerField = makeField('Provider');
  const providerSelect = document.createElement('select');
  providerSelect.id = 'new-session-provider';
  providerSelect.className = 'modal-select';
  providerField.querySelector('label')?.setAttribute('for', providerSelect.id);
  for (const [val, label] of [
    ['subscription', 'Subscription'],
    ['anthropic-api', 'Anthropic API'],
    ['codex', 'Codex (local login)'],
    // OpenRouter deferred post-MVP (see issue #10)
    // ['openrouter', 'OpenRouter'],
  ] as [Provider, string][]) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (val === opts.defaultProvider) opt.selected = true;
    providerSelect.appendChild(opt);
  }
  providerField.appendChild(providerSelect);
  panel.appendChild(providerField);

  const { actions, submitBtn } = makeActions('Add session', () => opts.onCancel(), () => {
    if (!color.commit()) return;
    const payload: NewSessionPayload = {
      label: nameInput.value.trim(),
      color: color.getColor(),
      project_dir: folderInput.value.trim(),
    };
    const e = emoji.getEmoji();
    if (e) payload.emoji = e;
    const provider = providerSelect.value as Provider;
    if (provider !== 'subscription') payload.provider = provider;
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
    const folderOk = folderInput.value.trim().length > 0;
    submitBtn.disabled = !(nameOk && folderOk && color.isValid());
  }

  nameInput.addEventListener('input', validate);
  folderInput.addEventListener('input', validate);

  requestAnimationFrame(() => panel.classList.add('modal-panel-in'));

  return {
    close() {
      dialog.dispose();
      overlay.remove();
    },
  };
}
