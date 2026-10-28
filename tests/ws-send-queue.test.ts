import { describe, it, expect, vi, afterEach } from 'vitest';
import { SendQueue, SEND_QUEUE_CAP } from '../src/pwa/ws-client.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SendQueue', () => {
  it('starts empty', () => {
    const q = new SendQueue();
    expect(q.size).toBe(0);
  });

  it('enqueues and flushes in FIFO order', () => {
    const q = new SendQueue<number>();
    q.push(1);
    q.push(2);
    q.push(3);
    expect(q.size).toBe(3);
    expect(q.flush()).toEqual([1, 2, 3]);
    expect(q.size).toBe(0);
  });

  it('flush returns empty array when queue is empty', () => {
    const q = new SendQueue<number>();
    expect(q.flush()).toEqual([]);
  });

  it('is re-usable after flush', () => {
    const q = new SendQueue<number>();
    q.push(10);
    q.flush();
    q.push(20);
    expect(q.flush()).toEqual([20]);
  });

  it('drops the oldest entry and warns when cap is reached', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cap = 3;
    const q = new SendQueue<number>(cap);
    q.push(1);
    q.push(2);
    q.push(3);
    // This push exceeds the cap — oldest (1) should be dropped.
    q.push(4);
    expect(warn).toHaveBeenCalledOnce();
    expect(q.size).toBe(cap);
    expect(q.flush()).toEqual([2, 3, 4]);
  });

  it('keeps dropping oldest on every push past the cap', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const q = new SendQueue<number>(2);
    q.push(1);
    q.push(2);
    q.push(3); // drops 1
    q.push(4); // drops 2
    expect(warn).toHaveBeenCalledTimes(2);
    expect(q.flush()).toEqual([3, 4]);
  });

  it('default cap equals SEND_QUEUE_CAP constant', () => {
    const q = new SendQueue<number>();
    expect(q.cap).toBe(SEND_QUEUE_CAP);
  });
});
