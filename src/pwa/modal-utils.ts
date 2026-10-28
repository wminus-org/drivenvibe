/**
 * Shared building blocks for the Add Project / Add Session modals.
 * Both modals are structurally identical (name + color + emoji + actions);
 * these helpers keep that scaffolding in one place.
 */

// Muted, warm-leaning palette to match the editorial dark theme (white text).
export const COLOR_PRESETS = ['#c2613f', '#5f8c5a', '#4f6f87', '#c2873c', '#8a6f9c', '#a85751', '#5b7a6f', '#b08a4a'];
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
let controlId = 0;

function nextId(prefix: string): string {
  controlId += 1;
  return `${prefix}-${controlId}`;
}

export function makeField(labelText: string): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'modal-field';
  const label = document.createElement('label');
  label.className = 'modal-label';
  label.textContent = labelText;
  field.appendChild(label);
  return field;
}

export interface ModalShell {
  overlay: HTMLDivElement;
  panel: HTMLDivElement;
}

/** overlay > panel > title scaffold. Caller appends fields to `panel`. */
export function makeModalShell(titleText: string): ModalShell {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const panel = document.createElement('div');
  panel.className = 'modal-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.tabIndex = -1;
  const title = document.createElement('h2');
  title.className = 'modal-title';
  title.id = nextId('modal-title');
  title.textContent = titleText;
  panel.setAttribute('aria-labelledby', title.id);
  panel.appendChild(title);
  overlay.appendChild(panel);
  return { overlay, panel };
}

export function makeTextField(
  labelText: string,
  placeholder: string,
): { field: HTMLDivElement; input: HTMLInputElement } {
  const field = makeField(labelText);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'modal-input';
  input.id = nextId('modal-input');
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  field.querySelector('label')?.setAttribute('for', input.id);
  field.appendChild(input);
  return { field, input };
}

export function makeEmojiField(placeholder: string): { field: HTMLDivElement; getEmoji: () => string } {
  const { field, input } = makeTextField('Emoji (optional)', placeholder);
  input.maxLength = 4;
  return { field, getEmoji: () => input.value.trim() };
}

export interface ColorPicker {
  field: HTMLDivElement;
  getColor: () => string;
  /** True if the optional hex override is empty or a valid hex string. */
  isValid: () => boolean;
  /** Shows an inline error when the hex override is non-empty but invalid. */
  commit: () => boolean;
}

/** Preset swatch grid + free-form hex input that stay mutually exclusive. */
export function makeColorPicker(onChange: () => void): ColorPicker {
  const field = makeField('Color');
  const grid = document.createElement('div');
  grid.className = 'color-preset-grid';
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-label', 'Color presets');
  let selected = COLOR_PRESETS[0];
  const swatches: HTMLButtonElement[] = [];

  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.className = 'modal-input';
  hexInput.placeholder = '#a1b2c3';
  hexInput.maxLength = 7;
  hexInput.autocomplete = 'off';
  hexInput.setAttribute('aria-label', 'Custom hex color');

  const hexError = document.createElement('div');
  hexError.className = 'modal-field-error';
  hexError.id = nextId('color-error');
  hexError.setAttribute('role', 'alert');
  hexInput.setAttribute('aria-describedby', hexError.id);

  for (const hex of COLOR_PRESETS) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch' + (hex === selected ? ' selected' : '');
    swatch.style.background = hex;
    swatch.setAttribute('aria-label', `Use color ${hex}`);
    swatch.setAttribute('role', 'radio');
    swatch.setAttribute('aria-checked', String(hex === selected));
    swatch.addEventListener('click', () => {
      selected = hex;
      hexInput.value = '';
      hexError.textContent = '';
      hexInput.setAttribute('aria-invalid', 'false');
      swatches.forEach((s) => {
        s.classList.remove('selected');
        s.setAttribute('aria-checked', 'false');
      });
      swatch.classList.add('selected');
      swatch.setAttribute('aria-checked', 'true');
      onChange();
    });
    swatches.push(swatch);
    grid.appendChild(swatch);
  }
  field.appendChild(grid);

  hexInput.addEventListener('input', () => {
    const v = hexInput.value.trim();
    if (HEX_RE.test(v)) {
      selected = v;
      hexError.textContent = '';
      hexInput.setAttribute('aria-invalid', 'false');
      swatches.forEach((s) => {
        s.classList.remove('selected');
        s.setAttribute('aria-checked', 'false');
      });
    } else if (v) {
      hexError.textContent = 'Enter a 6-digit hex color, for example #a1b2c3';
      hexInput.setAttribute('aria-invalid', 'true');
    } else {
      hexError.textContent = '';
      hexInput.setAttribute('aria-invalid', 'false');
    }
    onChange();
  });
  field.appendChild(hexInput);
  field.appendChild(hexError);

  return {
    field,
    getColor: () => selected,
    isValid: () => {
      const v = hexInput.value.trim();
      return !v || HEX_RE.test(v);
    },
    commit: () => {
      const v = hexInput.value.trim();
      if (v && !HEX_RE.test(v)) {
        hexError.textContent = 'Invalid hex color (e.g. #a1b2c3)';
        hexInput.setAttribute('aria-invalid', 'true');
        hexInput.focus();
        return false;
      }
      return true;
    },
  };
}

export function makeActions(
  submitText: string,
  onCancel: () => void,
  onSubmit: () => void,
): { actions: HTMLDivElement; submitBtn: HTMLButtonElement } {
  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'modal-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', onCancel);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'modal-submit';
  submitBtn.textContent = submitText;
  submitBtn.disabled = true;
  submitBtn.addEventListener('click', onSubmit);

  actions.appendChild(cancelBtn);
  actions.appendChild(submitBtn);
  return { actions, submitBtn };
}

export interface DialogBinding {
  dispose: () => void;
}

/** Adds Escape/backdrop dismissal, focus trapping, Enter submit and focus restoration. */
export function bindOverlayDialog(
  overlay: HTMLElement,
  panel: HTMLElement,
  opts: {
    onDismiss: () => void;
    initialFocus?: HTMLElement;
    submitButton?: HTMLButtonElement;
  },
): DialogBinding {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const inerted = Array.from(overlay.parentElement?.children ?? [])
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay)
    .map((element) => ({ element, wasInert: element.inert }));
  inerted.forEach(({ element }) => { element.inert = true; });
  let disposed = false;

  const focusableSelector = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const onClick = (event: Event) => {
    if (event.target === overlay) opts.onDismiss();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      opts.onDismiss();
      return;
    }

    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      event.target instanceof HTMLInputElement &&
      opts.submitButton &&
      !opts.submitButton.disabled
    ) {
      event.preventDefault();
      opts.submitButton.click();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  overlay.addEventListener('click', onClick);
  overlay.addEventListener('keydown', onKeyDown);
  requestAnimationFrame(() => (opts.initialFocus ?? panel).focus());

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      overlay.removeEventListener('click', onClick);
      overlay.removeEventListener('keydown', onKeyDown);
      inerted.forEach(({ element, wasInert }) => { element.inert = wasInert; });
      if (previousFocus?.isConnected) previousFocus.focus();
    },
  };
}
