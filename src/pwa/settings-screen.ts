import type { SessionPublic, PublicSettings, GlobalPatch, SessionPatch, Theme, Provider } from '../../shared/protocol.js';
import { renderHeader } from './header.js';

export type SettingsTab = 'global' | 'session';

export interface SettingsScreenHandle {
  setActiveTab: (t: SettingsTab) => void;
  setGlobal: (s: PublicSettings) => void;
  setSession: (s: SessionPublic) => void;
  setSaveState: (state: 'saving' | 'saved' | 'error') => void;
}

let settingsControlId = 0;
function nextControlId(prefix: string): string {
  settingsControlId += 1;
  return `${prefix}-${settingsControlId}`;
}

export function renderSettingsScreen(
  root: HTMLElement,
  initial: {
    tab: SettingsTab;
    global: PublicSettings;
    session: SessionPublic | null;
  },
  handlers: {
    onBack: () => void;
    onGlobalPatch: (patch: GlobalPatch) => void;
    onSessionPatch: (sessionId: string, patch: SessionPatch) => void;
  },
): SettingsScreenHandle {
  root.innerHTML = '';

  root.appendChild(renderHeader({ title: 'Settings', onBack: handlers.onBack }).el);

  const body = document.createElement('div');
  body.className = 'dnv-settings';

  const saveStatus = document.createElement('div');
  saveStatus.className = 'dnv-save-status';
  saveStatus.setAttribute('role', 'status');
  saveStatus.setAttribute('aria-live', 'polite');
  body.appendChild(saveStatus);

  // Tab pills
  const tabs = document.createElement('div');
  tabs.className = 'dnv-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Settings scope');
  const tabGlobal = document.createElement('button');
  tabGlobal.type = 'button';
  tabGlobal.className = 'dnv-tab';
  tabGlobal.id = 'settings-tab-global';
  tabGlobal.textContent = 'Global';
  tabGlobal.setAttribute('role', 'tab');
  const tabSession = document.createElement('button');
  tabSession.type = 'button';
  tabSession.className = 'dnv-tab';
  tabSession.id = 'settings-tab-session';
  tabSession.textContent = 'Session';
  tabSession.setAttribute('role', 'tab');
  if (!initial.session) tabSession.disabled = true;
  tabs.append(tabGlobal, tabSession);
  body.appendChild(tabs);

  const content = document.createElement('div');
  content.id = 'settings-tab-panel';
  content.setAttribute('role', 'tabpanel');
  tabGlobal.setAttribute('aria-controls', content.id);
  tabSession.setAttribute('aria-controls', content.id);
  body.appendChild(content);
  root.appendChild(body);

  let currentTab: SettingsTab = initial.tab;
  let global = { ...initial.global };
  let session: SessionPublic | null = initial.session;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function setSaveState(next: 'saving' | 'saved' | 'error') {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveStatus.className = `dnv-save-status ${next}`;
    saveStatus.textContent = next === 'saving' ? 'Saving…' : next === 'saved' ? 'Saved' : 'Could not save';
    if (next !== 'saving') {
      saveTimer = setTimeout(() => {
        saveStatus.textContent = '';
        saveStatus.className = 'dnv-save-status';
        saveTimer = null;
      }, 2200);
    }
  }

  function commitGlobal(patch: GlobalPatch) {
    setSaveState('saving');
    handlers.onGlobalPatch(patch);
  }

  function commitSession(sessionId: string, patch: SessionPatch) {
    setSaveState('saving');
    handlers.onSessionPatch(sessionId, patch);
  }

  function renderGlobal() {
    content.innerHTML = '';
    content.appendChild(buildGroup([
      keyRow({
        label: 'Anthropic API key',
        placeholder: global.has_anthropic_key ? '••••• (set — paste new to replace)' : 'sk-ant-…',
        isSet: global.has_anthropic_key,
        onCommit: (v) => commitGlobal({ anthropic_api_key: v }),
      }),
      selectRow({
        label: 'Default provider for new sessions',
        value: global.default_provider,
        options: [
          { value: 'subscription', label: 'Subscription (claude login)' },
          { value: 'anthropic-api', label: 'Anthropic API key' },
          { value: 'codex', label: 'Codex (local login)' },
        ],
        onChange: (v) => commitGlobal({ default_provider: v as Provider }),
      }),
      selectRow({
        label: 'Theme',
        value: global.theme,
        options: [
          { value: 'auto', label: 'Auto (follow system)' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ],
        onChange: (v) => commitGlobal({ theme: v as Theme }),
      }),
      toggleRow({
        label: 'Haptic feedback on taps',
        value: global.haptics,
        onChange: (v) => commitGlobal({ haptics: v }),
      }),
    ]));
  }

  function renderSession() {
    content.innerHTML = '';
    if (!session) {
      const note = document.createElement('div');
      note.className = 'dnv-group-note';
      note.textContent = 'Enter a session first to edit its settings.';
      content.appendChild(note);
      return;
    }
    const sid = session.id;
    content.appendChild(buildGroup([
      sliderRow({
        label: 'TTS speed',
        value: session.tts_rate ?? 1.2,
        min: 0.5, max: 3.0, step: 0.05,
        onChange: (v) => commitSession(sid, { tts_rate: v }),
      }),
      selectRow({
        label: 'Recognizer language',
        value: session.lang ?? 'en-US',
        options: [
          { value: 'en-US', label: 'English (US)' },
          { value: 'en-GB', label: 'English (UK)' },
          { value: 'sl-SI', label: 'Slovenian' },
          { value: 'de-DE', label: 'German' },
          { value: 'es-ES', label: 'Spanish' },
        ],
        onChange: (v) => commitSession(sid, { lang: v }),
      }),
      toggleRow({
        label: 'Voice-mode prompt',
        hint: 'Shorter, spoken-friendly replies',
        value: session.voice_mode ?? true,
        onChange: (v) => commitSession(sid, { voice_mode: v }),
      }),
      selectRow({
        label: 'Provider',
        value: session.provider ?? 'subscription',
        options: [
          { value: 'subscription', label: 'Subscription' },
          { value: 'anthropic-api', label: 'Anthropic API' },
          { value: 'codex', label: 'Codex (local login)' },
        ],
        onChange: (v) => commitSession(sid, { provider: v as Provider }),
      }),
      textRow({
        label: 'Model',
        value: session.model ?? '',
        placeholder: 'anthropic/claude-sonnet-4.5',
        onCommit: (v) => commitSession(sid, { model: v }),
      }),
    ]));
  }

  function activate(t: SettingsTab) {
    currentTab = t;
    tabGlobal.classList.toggle('active', t === 'global');
    tabSession.classList.toggle('active', t === 'session');
    tabGlobal.setAttribute('aria-selected', String(t === 'global'));
    tabSession.setAttribute('aria-selected', String(t === 'session'));
    tabGlobal.tabIndex = t === 'global' ? 0 : -1;
    tabSession.tabIndex = t === 'session' ? 0 : -1;
    content.setAttribute('aria-labelledby', t === 'global' ? tabGlobal.id : tabSession.id);
    if (t === 'global') renderGlobal();
    else renderSession();
  }

  tabGlobal.addEventListener('click', () => activate('global'));
  tabSession.addEventListener('click', () => { if (!tabSession.disabled) activate('session'); });
  tabs.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next: SettingsTab = event.key === 'ArrowLeft' || event.key === 'Home' || tabSession.disabled
      ? 'global'
      : 'session';
    activate(next);
    (next === 'global' ? tabGlobal : tabSession).focus();
  });

  activate(currentTab);

  return {
    setActiveTab: activate,
    setGlobal: (s) => {
      global = { ...s };
      // The controls update optimistically. Avoid destroying the active
      // control (and its keyboard focus) when the server echoes our patch.
      if (currentTab === 'global' && !content.contains(document.activeElement)) renderGlobal();
    },
    setSession: (s) => {
      session = s;
      tabSession.disabled = !s;
      if (currentTab === 'session' && !content.contains(document.activeElement)) renderSession();
    },
    setSaveState,
  };
}

// ─── Group + row builders ────────────────────────────────────────────────────

function buildGroup(rows: HTMLElement[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'dnv-group';
  rows.forEach((row, i) => {
    if (i > 0) {
      const div = document.createElement('div');
      div.className = 'dnv-srow-div';
      group.appendChild(div);
    }
    group.appendChild(row);
  });
  return group;
}

function srow(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dnv-srow';
  return row;
}

function title(text: string, htmlFor?: string): HTMLElement {
  const t = document.createElement(htmlFor ? 'label' : 'div');
  t.className = 'dnv-srow-title';
  t.textContent = text;
  if (htmlFor && t instanceof HTMLLabelElement) t.htmlFor = htmlFor;
  return t;
}

function keyRow(p: { label: string; placeholder: string; isSet: boolean; onCommit: (v: string) => void }): HTMLElement {
  const row = srow();
  const head = document.createElement('div');
  head.style.marginBottom = '10px';
  const inputId = nextControlId('settings-key');
  const t = title(p.label, inputId);
  t.style.display = 'inline';
  const status = document.createElement('span');
  status.className = 'dnv-key-status ' + (p.isSet ? 'set' : 'unset');
  status.textContent = p.isSet ? 'SET' : 'NOT SET';
  head.append(t, status);
  row.appendChild(head);

  const input = document.createElement('input');
  input.id = inputId;
  input.className = 'dnv-input';
  input.type = 'password';
  input.placeholder = p.placeholder;
  input.autocomplete = 'new-password';
  input.spellcheck = false;
  // Commit on blur, not per-keystroke (avoid spamming WS while typing).
  input.addEventListener('blur', () => {
    if (input.value !== '') { p.onCommit(input.value); input.value = ''; }
  });
  row.appendChild(input);
  if (p.isSet) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'dnv-inline-danger';
    remove.textContent = 'Remove saved key';
    let confirming = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    remove.addEventListener('click', () => {
      if (confirming) {
        if (timer !== null) clearTimeout(timer);
        p.onCommit('');
        remove.disabled = true;
        remove.textContent = 'Removing…';
        return;
      }
      confirming = true;
      remove.textContent = 'Tap again to confirm';
      timer = setTimeout(() => {
        confirming = false;
        remove.textContent = 'Remove saved key';
        timer = null;
      }, 3000);
    });
    row.appendChild(remove);
  }
  return row;
}

function textRow(p: { label: string; value: string; placeholder: string; onCommit: (v: string) => void }): HTMLElement {
  const row = srow();
  const inputId = nextControlId('settings-text');
  const t = title(p.label, inputId);
  t.style.marginBottom = '10px';
  row.appendChild(t);
  const input = document.createElement('input');
  input.id = inputId;
  input.className = 'dnv-input';
  input.type = 'text';
  input.value = p.value;
  input.placeholder = p.placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('blur', () => {
    if (input.value !== p.value) p.onCommit(input.value);
  });
  row.appendChild(input);
  return row;
}

function selectRow(p: { label: string; value: string; options: { value: string; label: string }[]; hint?: string; onChange: (v: string) => void }): HTMLElement {
  const row = srow();
  const selectId = nextControlId('settings-select');
  const t = title(p.label, selectId);
  t.style.marginBottom = '10px';
  row.appendChild(t);
  const sel = document.createElement('select');
  sel.id = selectId;
  sel.className = 'dnv-select';
  for (const o of p.options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === p.value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => p.onChange(sel.value));
  row.appendChild(sel);
  if (p.hint) {
    const h = document.createElement('div');
    h.className = 'dnv-srow-hint';
    h.textContent = p.hint;
    row.appendChild(h);
  }
  return row;
}

function sliderRow(p: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }): HTMLElement {
  const row = srow();
  const sliderId = nextControlId('settings-slider');
  const head = document.createElement('div');
  head.className = 'dnv-srow-head';
  const t = title(p.label, sliderId);
  const val = document.createElement('output');
  val.className = 'dnv-srow-val';
  val.setAttribute('for', sliderId);
  val.textContent = p.value.toFixed(2);
  head.append(t, val);
  row.appendChild(head);

  const slider = document.createElement('input');
  slider.id = sliderId;
  slider.className = 'dnv-slider';
  slider.type = 'range';
  slider.min = String(p.min);
  slider.max = String(p.max);
  slider.step = String(p.step);
  slider.value = String(p.value);
  slider.addEventListener('input', () => { val.textContent = parseFloat(slider.value).toFixed(2); });
  // Commit on release, not on every input event (avoid spamming WS).
  slider.addEventListener('change', () => p.onChange(parseFloat(slider.value)));
  row.appendChild(slider);
  return row;
}

function toggleRow(p: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }): HTMLElement {
  const row = srow();
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'dnv-srow-toggle';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(p.value));

  const textBlock = document.createElement('div');
  const t = title(p.label);
  textBlock.appendChild(t);
  if (p.hint) {
    const h = document.createElement('div');
    h.className = 'dnv-srow-hint';
    h.textContent = p.hint;
    textBlock.appendChild(h);
  }

  const sw = document.createElement('span');
  sw.className = 'dnv-switch' + (p.value ? ' on' : '');
  sw.setAttribute('aria-hidden', 'true');
  toggle.append(textBlock, sw);
  row.appendChild(toggle);

  let v = p.value;
  toggle.addEventListener('click', () => {
    v = !v;
    sw.classList.toggle('on', v);
    toggle.setAttribute('aria-checked', String(v));
    p.onChange(v);
  });
  return row;
}
