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

  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(_data: string) {}
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
}

describe('WsClient cloud-mode tokenProvider', () => {
  afterEach(() => {
    FakeWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  it('appends ?auth=<token> when tokenProvider is set', async () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'app.example.com' });
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const client = new WsClient();
    client.tokenProvider = async () => 'tok123';

    const connecting = client.connect();
    // connect() now awaits tokenProvider() before constructing the socket —
    // let that microtask settle before grabbing the instance.
    await new Promise((r) => setTimeout(r, 0));
    FakeWebSocket.instances[0].open();
    await connecting;

    expect(FakeWebSocket.instances[0].url).toBe('wss://app.example.com/ws?auth=tok123');
  });

  it('omits the query param when no tokenProvider is set (local mode)', async () => {
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const client = new WsClient();

    const connecting = client.connect();
    FakeWebSocket.instances[0].open();
    await connecting;

    expect(FakeWebSocket.instances[0].url).toBe('ws://localhost/ws');
  });
});
