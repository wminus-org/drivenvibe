import type { HistoryEntry, ServerMessage, SessionPublic } from '../../shared/protocol.js';
import { renderHeader } from './header.js';
import { iconHtml, faCircleNotch, faVolumeHigh, faCopy, faClockRotateLeft } from './icons.js';

type HistoryMessage = Extract<ServerMessage, { type: 'history' }>;
type HistoryPage = Pick<HistoryMessage, 'entries' | 'has_more' | 'before' | 'starts_at'>;

export interface HistoryView {
  entries: HistoryEntry[];
  hasMore: boolean;
  startsAt?: number;
}

/**
 * Fold one server page into what is on screen. Latest pages (no `before`)
 * append new turns, or replace the view if they no longer overlap it; older
 * pages prepend only when they answer the cursor the view is showing.
 */
export function mergeHistory(view: HistoryView, page: HistoryPage): HistoryView {
  const fresh = { entries: page.entries, hasMore: page.has_more, startsAt: page.starts_at };
  if (!view.entries.length) return page.before === undefined ? fresh : view;
  if (page.before !== undefined) {
    if (page.before !== view.entries[0].seq) return view;
    return { entries: [...page.entries, ...view.entries], hasMore: page.has_more, startsAt: page.starts_at };
  }
  const last = view.entries[view.entries.length - 1].seq;
  if (!page.entries.length || page.entries[0].seq > last + 1) return fresh;
  return { ...view, entries: [...view.entries, ...page.entries.filter((x) => x.seq > last)] };
}

export interface HistoryScreenHandle {
  receive: (msg: HistoryMessage) => void;
  setConnected: (connected: boolean) => void;
}

const SPIN_SVG = iconHtml(faCircleNotch);
const REPLAY_SVG = iconHtml(faVolumeHigh);
const COPY_SVG = iconHtml(faCopy);
const HISTORY_SVG = iconHtml(faClockRotateLeft);

export function renderHistoryScreen(
  root: HTMLElement,
  session: SessionPublic,
  opts: {
    connected: boolean;
    onBack: () => void;
    /** Ask the server for a page; `before` = seq cursor for older entries. */
    request: (before?: number) => void;
    onReplay: (text: string) => void;
    onCopy: (text: string) => void;
  },
): HistoryScreenHandle {
  root.innerHTML = '';
  root.appendChild(renderHeader({ title: 'History', onBack: opts.onBack }).el);

  const list = document.createElement('div');
  list.className = 'dnv-transcript dnv-history';
  list.setAttribute('role', 'log');
  list.setAttribute('aria-label', `${session.label} history`);
  root.appendChild(list);

  let view: HistoryView = { entries: [], hasMore: false };
  let loaded = false;
  let loadingOlder = false;
  let connected = opts.connected;

  function render(scrollToBottom: boolean) {
    const fromBottom = list.scrollHeight - list.scrollTop;
    list.textContent = '';
    list.setAttribute('aria-busy', String(!loaded || loadingOlder));

    if (!loaded || !view.entries.length) {
      const empty = document.createElement('div');
      empty.className = 'dnv-empty';
      if (!loaded && connected) {
        empty.innerHTML = '<div class="dnv-history-spin">' + SPIN_SVG + '</div>';
        empty.setAttribute('role', 'status');
        empty.setAttribute('aria-label', 'Loading history');
      } else {
        const offline = !loaded && !connected;
        empty.innerHTML = '<div class="dnv-empty-icon">' + HISTORY_SVG + '</div>';
        const title = document.createElement('div');
        title.className = 'dnv-empty-text';
        title.textContent = offline ? 'You are offline' : 'No messages yet';
        const sub = document.createElement('div');
        sub.className = 'dnv-empty-subtext';
        sub.textContent = offline
          ? 'History loads when the connection is back.'
          : 'Your conversation with Claude in this session will show up here.';
        empty.append(title, sub);
      }
      list.appendChild(empty);
      return;
    }

    if (view.hasMore) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'dnv-history-more';
      if (loadingOlder) {
        more.innerHTML = '<span class="dnv-history-spin">' + SPIN_SVG + '</span>';
        more.setAttribute('aria-label', 'Loading earlier messages');
        more.disabled = true;
      } else {
        more.textContent = 'Load earlier';
        more.disabled = !connected;
        more.addEventListener('click', () => {
          loadingOlder = true;
          render(false);
          opts.request(view.entries[0].seq);
        });
      }
      list.appendChild(more);
    } else if (view.startsAt !== undefined) {
      const starts = document.createElement('div');
      starts.className = 'dnv-history-starts';
      starts.textContent = `History starts ${formatWhen(view.startsAt, true)}`;
      list.appendChild(starts);
    }

    for (const entry of view.entries) list.appendChild(renderEntry(entry));

    list.scrollTop = scrollToBottom ? list.scrollHeight : list.scrollHeight - fromBottom;
  }

  function renderEntry(entry: HistoryEntry): HTMLElement {
    const mine = entry.role === 'user';
    const wrap = document.createElement('div');
    wrap.className = mine ? 'dnv-you-wrap' : 'dnv-claude-wrap';
    const label = document.createElement('div');
    label.className = 'dnv-bubble-label';
    const flag = entry.error ? ' · failed' : entry.cancelled ? ' · cancelled' : '';
    label.textContent = (mine ? 'YOU' : 'CLAUDE') + flag;
    const time = document.createElement('time');
    time.className = 'dnv-history-time';
    time.dateTime = new Date(entry.ts).toISOString();
    time.textContent = formatWhen(entry.ts, false);
    label.appendChild(time);

    const bubble = document.createElement('div');
    bubble.className = mine ? 'dnv-you' : 'dnv-claude';
    if (entry.text) {
      bubble.textContent = entry.text;
    } else {
      bubble.classList.add('dnv-history-blank');
      bubble.textContent = entry.error ? 'No answer (the request failed)' : 'No answer (cancelled)';
    }
    wrap.append(label, bubble);

    if (!mine && entry.text) {
      const actions = document.createElement('div');
      actions.className = 'dnv-history-actions';
      actions.append(
        actionButton(REPLAY_SVG, 'Replay', () => opts.onReplay(entry.text)),
        actionButton(COPY_SVG, 'Copy', () => opts.onCopy(entry.text)),
      );
      wrap.appendChild(actions);
    }
    return wrap;
  }

  render(true);
  opts.request();

  return {
    receive(msg) {
      const wasOlder = msg.before !== undefined;
      if (wasOlder) loadingOlder = false;
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
      view = mergeHistory(view, msg);
      loaded = true;
      // New turns follow the reader only if they were already at the bottom.
      render(!wasOlder && atBottom);
    },
    setConnected(value) {
      if (value === connected) return;
      connected = value;
      // A "Load earlier" that went out offline is queued by WsClient; keep its spinner.
      render(false);
    },
  };
}

function actionButton(svg: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dnv-iconbtn';
  b.innerHTML = svg;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('click', onClick);
  return b;
}

function formatWhen(ts: number, long: boolean): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  if (sameDay && !long) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString(undefined, { dateStyle: long ? 'long' : 'medium', timeStyle: 'short' });
}

/** Clipboard API with a textarea fallback for non-secure contexts (LAN http). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* unsupported */ }
    ta.remove();
    return ok;
  }
}
