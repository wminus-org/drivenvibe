import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';

export type ServerHandler = (msg: ServerMessage) => void;
export type ConnStatus = 'connecting' | 'open' | 'closed';
export type StatusHandler = (status: ConnStatus) => void;

/** Maximum number of messages buffered while disconnected. */
export const SEND_QUEUE_CAP = 20;

/**
 * Bounded FIFO queue for outbound messages buffered while the WebSocket is not
 * OPEN.  Oldest entry is dropped (with a console.warn) when the cap is hit.
 * Exported for unit testing.
 */
export class SendQueue<T> {
  private items: T[] = [];

  constructor(readonly cap: number = SEND_QUEUE_CAP) {}

  /** Enqueue a message, dropping the oldest if the cap is reached. */
  push(msg: T): void {
    if (this.items.length >= this.cap) {
      const dropped = this.items.shift();
      console.warn('[WsClient] send queue full; dropping oldest message:', dropped);
    }
    this.items.push(msg);
  }

  /** Drain and return all queued messages in FIFO order. */
  flush(): T[] {
    const drained = this.items;
    this.items = [];
    return drained;
  }

  get size(): number {
    return this.items.length;
  }
}

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<ServerHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectTimer: number | null = null;
  private opened = false;
  private readonly queue = new SendQueue<ClientMessage>();

  /** Cloud mode only: set to fetch a fresh Clerk token per (re)connect attempt. */
  tokenProvider?: () => Promise<string | null>;

  async connect(): Promise<void> {
    const token = this.tokenProvider ? await this.tokenProvider() : null;
    return new Promise((resolve, reject) => {
      // Only surface 'connecting' once we've been connected before — avoids a
      // flash of "reconnecting" on the very first page load.
      if (this.opened) this.emitStatus('connecting');
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${location.host}/ws` + (token ? `?auth=${encodeURIComponent(token)}` : '');
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;
      const fail = (reason: unknown) => {
        if (settled) return;
        settled = true;
        reject(reason instanceof Error ? reason : new Error('WebSocket connection failed'));
      };
      ws.onopen = () => {
        if (this.ws !== ws) return;
        settled = true;
        this.opened = true;
        this.emitStatus('open');
        for (const msg of this.queue.flush()) ws.send(JSON.stringify(msg));
        resolve();
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerMessage;
          this.handlers.forEach((h) => h(msg));
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        this.emitStatus('closed');
        fail(new Error('WebSocket connection closed before opening'));
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          void this.connect().catch(() => {
            // A failed attempt schedules its own next retry.
          });
        }, 1500);
      };
      ws.onerror = () => fail(new Error('WebSocket connection error'));
    });
  }

  on(h: ServerHandler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  onStatus(h: StatusHandler): () => void {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }

  private emitStatus(s: ConnStatus): void {
    this.statusHandlers.forEach((h) => h(s));
  }

  send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      // Socket is not ready — buffer the message for replay on reconnect.
      this.queue.push(msg);
    }
  }
}
