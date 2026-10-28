import type { PublicConfig, ProjectPublic } from '../../shared/protocol.js';
import { renderHeader } from './header.js';
import type { RecentSession } from './recent-sessions.js';

const FOLDER_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

const TERMINAL_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 17 6-5-6-5"/><path d="M12 19h8"/></svg>';

const PLUS_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

const MORE_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

const DOWNLOAD_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';

/** Warm prompt shown in a tile grid that has no real items yet. Spans the grid. */
export function makeEmptyState(title: string, body: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'dnv-empty-grid';
  const h = document.createElement('h2');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = body;
  el.append(h, p);
  return el;
}

/** A colored project/session card: icon chip + name + meta. Optional long-press
 *  (used by session tiles for the edit/archive action sheet). */
export function makeCard(opts: {
  color: string;
  emoji?: string;
  name: string;
  meta: string;
  kind: 'project' | 'session';
  onClick: () => void;
  onLongPress?: () => void;
  onMenu?: () => void;
}): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'dnv-card-shell';

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'dnv-card';
  card.style.background = opts.color;
  card.setAttribute('aria-label', `${opts.name}, ${opts.meta}`);

  const chip = document.createElement('div');
  chip.className = 'dnv-card-chip';
  if (opts.emoji) {
    chip.textContent = opts.emoji;
  } else {
    chip.innerHTML = opts.kind === 'project' ? FOLDER_SVG : TERMINAL_SVG;
  }

  const text = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'dnv-card-name';
  name.textContent = opts.name;
  const meta = document.createElement('div');
  meta.className = 'dnv-card-meta';
  meta.textContent = opts.meta;
  text.append(name, meta);

  card.append(chip, text);

  // Long-press detection (touch + mouse), 500ms, cancelled on >10px move.
  let suppressClick = false;
  if (opts.onLongPress) {
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0, startY = 0;
    let lastActionAt = 0;
    const triggerActions = () => {
      // Mobile browsers can emit a contextmenu immediately after our custom
      // long press. Coalesce the two so the sheet is never opened twice.
      const now = Date.now();
      if (now - lastActionAt < 700) return;
      lastActionAt = now;
      opts.onLongPress!();
    };
    const startPress = (x: number, y: number) => {
      startX = x; startY = y; suppressClick = false;
      pressTimer = setTimeout(() => { pressTimer = null; suppressClick = true; triggerActions(); }, 500);
    };
    const cancelPress = () => { if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; } };
    const onMove = (x: number, y: number) => { if (Math.abs(x - startX) > 10 || Math.abs(y - startY) > 10) cancelPress(); };
    card.addEventListener('touchstart', (e) => startPress(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    card.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    card.addEventListener('touchend', cancelPress);
    card.addEventListener('touchcancel', cancelPress);
    card.addEventListener('mousedown', (e) => startPress(e.clientX, e.clientY));
    card.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    card.addEventListener('mouseup', cancelPress);
    card.addEventListener('mouseleave', cancelPress);
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      triggerActions();
    });
    card.title = 'Open session. Use the more button for session actions.';
  }

  card.addEventListener('click', () => {
    if (suppressClick) { suppressClick = false; return; }
    opts.onClick();
  });

  shell.appendChild(card);
  if (opts.onMenu) {
    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'dnv-card-menu';
    menu.innerHTML = MORE_SVG;
    menu.setAttribute('aria-label', `More options for ${opts.name}`);
    menu.setAttribute('aria-haspopup', 'dialog');
    menu.addEventListener('click', opts.onMenu);
    shell.appendChild(menu);
  }
  return shell;
}

/** The dashed "New …" add tile. */
export function makeAddCard(label: string, onClick: () => void): HTMLButtonElement {
  const add = document.createElement('button');
  add.className = 'dnv-card-add';
  add.setAttribute('aria-label', label);
  add.innerHTML = PLUS_SVG;
  const span = document.createElement('span');
  span.textContent = label;
  add.appendChild(span);
  add.addEventListener('click', () => onClick());
  return add;
}

export function renderMainSkeleton(root: HTMLElement): void {
  root.innerHTML = '';
  root.setAttribute('aria-busy', 'true');
  root.appendChild(renderHeader({ title: 'drivenvibe' }).el);
  const loading = document.createElement('div');
  loading.className = 'sr-only';
  loading.setAttribute('role', 'status');
  loading.textContent = 'Loading projects';
  root.appendChild(loading);
  const grid = document.createElement('div');
  grid.className = 'dnv-grid';
  for (let i = 0; i < 4; i++) {
    const tile = document.createElement('div');
    tile.className = 'dnv-skeleton-tile';
    grid.appendChild(tile);
  }
  root.appendChild(grid);
}

function makeResumeCard(recent: RecentSession, onResume: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dnv-resume';
  button.setAttribute('aria-label', `Continue ${recent.session.label} in ${recent.project.label}`);

  const chip = document.createElement('span');
  chip.className = 'dnv-resume-chip';
  chip.style.background = recent.session.color;
  chip.textContent = recent.session.emoji || '›_';

  const copy = document.createElement('span');
  copy.className = 'dnv-resume-copy';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'dnv-resume-eyebrow';
  eyebrow.textContent = 'CONTINUE';
  const name = document.createElement('span');
  name.className = 'dnv-resume-name';
  name.textContent = recent.session.label;
  const project = document.createElement('span');
  project.className = 'dnv-resume-project';
  project.textContent = recent.project.label;
  copy.append(eyebrow, name, project);

  const chevron = document.createElement('span');
  chevron.className = 'dnv-resume-chevron';
  chevron.innerHTML = CHEVRON_SVG;
  button.append(chip, copy, chevron);
  button.addEventListener('click', onResume);
  return button;
}

function makeInstallCard(onInstall: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dnv-install';
  button.innerHTML = DOWNLOAD_SVG;
  const copy = document.createElement('span');
  copy.innerHTML = '<strong>Install drivenvibe</strong><small>Faster launch and a full-screen driving view</small>';
  button.appendChild(copy);
  button.addEventListener('click', onInstall);
  return button;
}

export function renderMainScreen(
  root: HTMLElement,
  cfg: PublicConfig,
  onPickProject: (p: ProjectPublic) => void,
  onSettings: () => void,
  onAddProject: () => void,
  recent: RecentSession | null = null,
  onResume: (() => void) | null = null,
  onInstall: (() => void) | null = null,
): void {
  root.innerHTML = '';
  root.setAttribute('aria-busy', 'false');

  root.appendChild(renderHeader({ title: 'drivenvibe', onGear: onSettings }).el);

  if (recent && onResume) root.appendChild(makeResumeCard(recent, onResume));
  if (onInstall) root.appendChild(makeInstallCard(onInstall));

  const grid = document.createElement('div');
  grid.className = 'dnv-grid';

  if (cfg.projects.length === 0) {
    grid.appendChild(makeEmptyState(
      'Build by voice',
      'Create a project, connect a folder-backed session, then talk or type what you want to build.',
    ));
  }
  for (const p of cfg.projects) {
    const n = p.sessions.length;
    grid.appendChild(makeCard({
      color: p.color,
      emoji: p.emoji,
      name: p.label,
      meta: `${n} session${n === 1 ? '' : 's'}`,
      kind: 'project',
      onClick: () => onPickProject(p),
    }));
  }
  grid.appendChild(makeAddCard('New project', onAddProject));

  root.appendChild(grid);
}
