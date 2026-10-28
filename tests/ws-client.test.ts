import { afterEach, describe, expect, it, vi } from 'vitest';
import { WsClient } from '../src/pwa/ws-client.js';

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: string[] = [];

  constructor(_url: string) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
  fail() { this.onerror?.(); this.close(); }
}

describe('WsClient', () => {
  afterEach(() => {
    vi.useRealTimers();
    FakeWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  it('rejects the first connect and keeps retrying', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const client = new WsClient();

    const pending = client.connect();
    const rejected = expect(pending).rejects.toThrow('WebSocket connection error');
    FakeWebSocket.instances[0].fail();
    await rejected;

    await vi.advanceTimersByTimeAsync(1500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const opened = new Promise<void>((resolve) => client.onStatus((status) => {
      if (status === 'open') resolve();
    }));
    FakeWebSocket.instances[1].open();
    await opened;
  });

  it('queues messages while disconnected and flushes them in order', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const client = new WsClient();
    client.send({ type: 'cancel' });
    const connection = client.connect();
    FakeWebSocket.instances[0].open();
    await connection;
    expect(FakeWebSocket.instances[0].sent).toEqual(['{"type":"cancel"}']);
  });
});
