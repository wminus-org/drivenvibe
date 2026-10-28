import type { ProjectPublic, SessionPublic } from '../../shared/protocol.js';
import { makeEmptyState, makeCard, makeAddCard } from './main-screen.js';
import { renderHeader, type HeaderHandle } from './header.js';

export interface ProjectScreenHandle {
  setProject: (p: ProjectPublic) => void;
}

function sessionMeta(s: SessionPublic): string {
  switch (s.provider) {
    case 'anthropic-api': return 'API key';
    case 'openrouter': return 'OpenRouter';
    default: return 'Claude';
  }
}

export function renderProjectScreen(
  root: HTMLElement,
  project: ProjectPublic,
  handlers: {
    onPickSession: (s: SessionPublic) => void;
    onBack: () => void;
    onAddSession: () => void;
    onLongPress: (s: SessionPublic) => void;
    onSettings: () => void;
  },
): ProjectScreenHandle {
  root.innerHTML = '';

  const header: HeaderHandle = renderHeader({
    title: (project.emoji ? project.emoji + ' ' : '') + project.label,
    onBack: handlers.onBack,
    onGear: handlers.onSettings,
  });
  root.appendChild(header.el);

  const grid = document.createElement('div');
  grid.className = 'dnv-grid';

  function buildGrid(p: ProjectPublic) {
    grid.innerHTML = '';
    if (p.sessions.length === 0) {
      grid.appendChild(makeEmptyState(
        'Add your first session',
        'A session connects this project to a folder and remembers its own voice settings.',
      ));
    }
    for (const s of p.sessions) {
      grid.appendChild(makeCard({
        color: s.color,
        emoji: s.emoji,
        name: s.label,
        meta: sessionMeta(s),
        kind: 'session',
        onClick: () => handlers.onPickSession(s),
        onLongPress: () => handlers.onLongPress(s),
        onMenu: () => handlers.onLongPress(s),
      }));
    }
    grid.appendChild(makeAddCard('New session', handlers.onAddSession));
  }

  buildGrid(project);
  root.appendChild(grid);

  return {
    setProject(p) {
      header.setTitle((p.emoji ? p.emoji + ' ' : '') + p.label);
      buildGrid(p);
    },
  };
}
