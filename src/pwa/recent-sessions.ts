import type { ProjectPublic, PublicConfig, SessionPublic } from '../../shared/protocol.js';

const STORAGE_KEY = 'drivenvibe.recent-sessions.v1';
const MAX_RECENTS = 8;

interface StoredRecent {
  sessionId: string;
  openedAt: number;
}

export interface RecentSession {
  project: ProjectPublic;
  session: SessionPublic;
}

function read(): StoredRecent[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is StoredRecent => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<StoredRecent>;
      return typeof candidate.sessionId === 'string' && typeof candidate.openedAt === 'number';
    });
  } catch {
    return [];
  }
}

function write(recents: StoredRecent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
  } catch {
    // Private browsing and managed devices can deny storage. Recents are a
    // convenience only, so the core session flow must continue to work.
  }
}

export function markSessionOpened(sessionId: string): void {
  const recents = read().filter((item) => item.sessionId !== sessionId);
  recents.unshift({ sessionId, openedAt: Date.now() });
  write(recents);
}

/** Finds the newest still-active session. Deleted/archived entries are pruned. */
export function getMostRecentSession(config: PublicConfig): RecentSession | null {
  const recents = read().sort((a, b) => b.openedAt - a.openedAt);
  const active = new Map<string, RecentSession>();
  for (const project of config.projects) {
    for (const session of project.sessions) {
      active.set(session.id, { project, session });
    }
  }

  const valid = recents.filter((item) => active.has(item.sessionId));
  if (valid.length !== recents.length) write(valid);
  return valid.length > 0 ? active.get(valid[0].sessionId) ?? null : null;
}
