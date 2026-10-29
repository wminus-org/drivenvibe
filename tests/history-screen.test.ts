import { describe, it, expect } from 'vitest';
import { mergeHistory, type HistoryView } from '../src/pwa/history-screen.js';
import type { HistoryEntry } from '../shared/protocol.js';

const e = (seq: number): HistoryEntry => ({ seq, role: seq % 2 ? 'user' : 'assistant', text: `m${seq}`, ts: seq * 1000 });
const empty: HistoryView = { entries: [], hasMore: false };
const seqs = (v: HistoryView) => v.entries.map((x) => x.seq);

describe('mergeHistory (history screen paging)', () => {
  it('takes the first latest page as-is', () => {
    const v = mergeHistory(empty, { entries: [e(5), e(6)], has_more: true });
    expect(seqs(v)).toEqual([5, 6]);
    expect(v.hasMore).toBe(true);
  });

  it('prepends an older page and adopts its has_more / starts_at', () => {
    const v1 = mergeHistory(empty, { entries: [e(5), e(6)], has_more: true });
    const v2 = mergeHistory(v1, { entries: [e(3), e(4)], has_more: false, before: 5, starts_at: 3000 });
    expect(seqs(v2)).toEqual([3, 4, 5, 6]);
    expect(v2.hasMore).toBe(false);
    expect(v2.startsAt).toBe(3000);
  });

  it('appends new turns on refresh without losing loaded older pages', () => {
    const v1 = mergeHistory(empty, { entries: [e(3), e(4)], has_more: false, starts_at: 3000 });
    const v2 = mergeHistory(v1, { entries: [e(4), e(5), e(6)], has_more: true });
    expect(seqs(v2)).toEqual([3, 4, 5, 6]);
    expect(v2.hasMore).toBe(false);
    expect(v2.startsAt).toBe(3000);
  });

  it('replaces the view when a refresh does not overlap what is shown', () => {
    const v1 = mergeHistory(empty, { entries: [e(1), e(2)], has_more: false });
    const v2 = mergeHistory(v1, { entries: [e(9), e(10)], has_more: true });
    expect(seqs(v2)).toEqual([9, 10]);
    expect(v2.hasMore).toBe(true);
  });

  it('ignores an older page that no longer fits the view', () => {
    const v1 = mergeHistory(empty, { entries: [e(5), e(6)], has_more: true });
    const v2 = mergeHistory(v1, { entries: [e(1), e(2)], has_more: true, before: 3 });
    expect(seqs(v2)).toEqual([5, 6]);
  });
});
