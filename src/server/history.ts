import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { HistoryEntry } from '../../shared/protocol.js';
import { writeJsonAtomic, readJsonOrDefault } from './fs-util.js';
import { createSerialQueue } from './serial-queue.js';
import { HOME_DIR } from './paths.js';

/** Rolling log length per session; older entries fall off the front. */
export const MAX_HISTORY_ENTRIES = 200;
/** Per-entry text cap. Long answers are cut with TRUNCATION_MARKER. */
export const MAX_HISTORY_TEXT_CHARS = 8_000;
/** Largest page get_history returns, whatever the client asks for. */
export const MAX_HISTORY_PAGE = 50;
/** Entry bytes per page: well under the 256 KB relay frame and 1 MB WS buffer caps. */
export const HISTORY_PAGE_BYTES = 128 * 1024;
const DEFAULT_PAGE = 30;
const TRUNCATION_MARKER = '… [truncated]';

interface SessionLog {
  next_seq: number;
  /** Earlier conversation is missing (cap dropped it, or it predates the log). */
  truncated?: boolean;
  entries: HistoryEntry[];
}

export interface TurnToken { readonly sid: string }

export interface FinishedTurn {
  user: string;
  userTs: number;
  assistant?: { text: string; cancelled?: boolean; error?: boolean };
  /** The session already had a conversation before its first logged turn. */
  priorUnlogged?: boolean;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  has_more: boolean;
  starts_at?: number;
}

/**
 * Per-session conversation log in its own file (history.json), so the hot
 * state.json stays small. Session ids are Map keys only — never paths, never
 * plain-object keys — so `__proto__` & co. are inert.
 * ponytail: rewrites the whole file every turn (≤ 200 × 8 KB per session); move
 * to one file per session if many busy sessions make that write noticeable.
 */
export class HistoryStore {
  private sessions = new Map<string, SessionLog>();
  private current = new Map<string, TurnToken>();
  private loaded: Promise<void> | null = null;
  private writeQueue = createSerialQueue();

  constructor(private file: string) {}

  /** A new turn takes ownership of its session; the previous turn is now superseded. */
  beginTurn(sid: string): TurnToken {
    const token: TurnToken = { sid };
    this.current.set(sid, token);
    return token;
  }

  /**
   * Log a finished turn. A superseded (barge-in) turn keeps only what the user
   * said: its partial answer is stale. `validIds` are the config's session ids;
   * logs for anything else are dropped on this write.
   */
  async finishTurn(token: TurnToken, turn: FinishedTurn, validIds: ReadonlySet<string>): Promise<void> {
    await this.load();
    const { sid } = token;
    const superseded = this.current.get(sid) !== token;
    if (!superseded) this.current.delete(sid);

    for (const id of this.sessions.keys()) if (!validIds.has(id)) this.sessions.delete(id);
    if (!validIds.has(sid)) return;

    let log = this.sessions.get(sid);
    if (!log) {
      log = { next_seq: 1, entries: [] };
      if (turn.priorUnlogged) log.truncated = true;
      this.sessions.set(sid, log);
    }
    const push = (e: Omit<HistoryEntry, 'seq'>) => log!.entries.push({ seq: log!.next_seq++, ...e, text: cap(e.text) });
    push({ role: 'user', text: turn.user, ts: turn.userTs });
    const a = turn.assistant;
    if (a && !superseded && (a.text || a.cancelled || a.error)) {
      push({ role: 'assistant', text: a.text, ts: Date.now(), ...(a.cancelled && { cancelled: true }), ...(a.error && { error: true }) });
    }
    if (log.entries.length > MAX_HISTORY_ENTRIES) {
      log.entries.splice(0, log.entries.length - MAX_HISTORY_ENTRIES);
      log.truncated = true;
    }
    // Memory is current now; the disk write runs behind it so a reply is never
    // held up by fsync. Failure only costs persistence, never the turn.
    void this.flush().catch((e) => console.warn(`[history] could not save ${this.file}: ${e?.message ?? e}`));
  }

  /** Newest `limit` entries older than `before` (exclusive seq cursor), oldest first. */
  async page(sid: string, opts: { before?: number; limit?: number } = {}): Promise<HistoryPage> {
    await this.load();
    const log = this.sessions.get(sid);
    if (!log) return { entries: [], has_more: false };
    const limit = Math.min(MAX_HISTORY_PAGE, Math.max(1, Math.floor(opts.limit ?? DEFAULT_PAGE)));
    const before = opts.before ?? Number.POSITIVE_INFINITY;
    let end = log.entries.length;
    while (end > 0 && log.entries[end - 1].seq >= before) end--;

    let start = end;
    let bytes = 0;
    while (start > 0 && end - start < limit) {
      const size = Buffer.byteLength(JSON.stringify(log.entries[start - 1])) + 1;
      if (end - start > 0 && bytes + size > HISTORY_PAGE_BYTES) break;
      bytes += size;
      start--;
    }
    const entries = log.entries.slice(start, end);
    const has_more = start > 0;
    const page: HistoryPage = { entries, has_more };
    if (!has_more && log.truncated && entries.length) page.starts_at = entries[0].ts;
    return page;
  }

  /** Resolves once every queued write has landed (tests, shutdown). */
  whenIdle(): Promise<void> {
    return this.writeQueue(async () => {});
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const raw = await readJsonOrDefault<unknown>(this.file, {});
        const sessions = (raw as { sessions?: unknown })?.sessions;
        if (isObject(sessions)) {
          for (const [sid, value] of Object.entries(sessions)) {
            const log = parseLog(value);
            if (log) this.sessions.set(sid, log);
          }
        }
        await fs.chmod(this.file, 0o600).catch(() => {});
      } catch (e: any) {
        // A damaged log must never stop the server; start over and let the next write replace it.
        console.warn(`[history] ignoring unreadable ${this.file}: ${e?.message ?? e}`);
      }
    })();
    return this.loaded;
  }

  private flush(): Promise<void> {
    const sessions: Record<string, SessionLog> = Object.create(null);
    for (const [sid, log] of this.sessions) sessions[sid] = { ...log, entries: [...log.entries] };
    const snapshot = { version: 1, sessions };
    return this.writeQueue(() => writeJsonAtomic(this.file, snapshot, { mkdir: true, mode: 0o600 }));
  }
}

function cap(text: string): string {
  return text.length <= MAX_HISTORY_TEXT_CHARS
    ? text
    : text.slice(0, MAX_HISTORY_TEXT_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseLog(v: unknown): SessionLog | null {
  if (!isObject(v) || !Array.isArray(v.entries)) return null;
  const entries: HistoryEntry[] = [];
  for (const e of v.entries) {
    if (!isObject(e)) continue;
    const { seq, role, text, ts } = e;
    if (!Number.isSafeInteger(seq) || (role !== 'user' && role !== 'assistant')
      || typeof text !== 'string' || typeof ts !== 'number' || !Number.isFinite(ts)) continue;
    const prev = entries.at(-1);
    if (prev && (seq as number) <= prev.seq) continue;
    entries.push({
      seq: seq as number, role, text: cap(text), ts,
      ...(e.cancelled === true && { cancelled: true }),
      ...(e.error === true && { error: true }),
    });
  }
  const last = entries.at(-1)?.seq ?? 0;
  const nextSeq = Number.isSafeInteger(v.next_seq) && (v.next_seq as number) > last ? v.next_seq as number : last + 1;
  return {
    next_seq: nextSeq,
    ...((v.truncated === true || entries.length > MAX_HISTORY_ENTRIES) && { truncated: true }),
    entries: entries.slice(-MAX_HISTORY_ENTRIES),
  };
}

let defaultStore: HistoryStore | undefined;
/** The server's one store (~/.drivenvibe/history.json), shared by direct WS and relay. */
export function defaultHistoryStore(): HistoryStore {
  return defaultStore ??= new HistoryStore(path.join(HOME_DIR, 'history.json'));
}
