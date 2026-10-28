import { WebSocket } from 'ws';
import { z } from 'zod';
import { PLAN_REQUIRED_STATUS, type DesktopToRelay } from '../../shared/relay-protocol.js';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';
import { handleClientMessage, type AttachOpts, type WsContext } from './ws.js';
import { ClientMessageSchema } from './client-message-schema.js';
import { WhisperCppStt } from './stt-whisper.js';
import { toPublic } from './config.js';

/** Mirrors ws.ts's (unexported) PerSocketState shape — one per relay peer. */
interface PeerState {
  current_session: string | null;
  last_response: string;
  last_response_session?: string;
  removeFromHub?: () => void;
}

const relayId = z.string().min(1).max(256);
const RelayEnvelopeSchema = z.discriminatedUnion('type', [
  // optional: zod 4 rejects a missing z.unknown() key, which would silently drop the frame
  // instead of answering 'invalid message' below.
  z.object({ type: z.literal('from_phone'), peer: relayId, msg: z.unknown().optional() }),
  z.object({ type: z.literal('peer_gone'), peer: relayId }),
  // Keep path as a bounded string so the core can return an explicit 404 for
  // a newer/unknown route instead of making the relay wait for a timeout.
  z.object({
    type: z.literal('http_request'),
    id: relayId,
    method: z.literal('GET'),
    path: z.string().min(1).max(256),
  }),
]);

const MAX_RELAY_PEERS = 256;
const MAX_RELAY_PAYLOAD_BYTES = 256 * 1024;
const MAX_RELAY_BUFFERED_BYTES = 1024 * 1024;

export interface RelayCoreOpts extends AttachOpts {
  sendToRelay: (frame: DesktopToRelay) => void;
}

/**
 * Pure relay dispatch core: multiplexes many phone "peers" (relayed through
 * one outbound desktop socket) onto the same handleClientMessage used for
 * direct WS clients in ws.ts. No networking here — see startRelay for that.
 */
export function createRelayCore(opts: RelayCoreOpts) {
  // Server-STT must work over the relay too, not just direct WS: an audio_blob
  // arriving from a cloud-connected phone hits the same handleClientMessage.
  // Stateless HTTP client, so a per-transport instance costs nothing.
  const whisper = opts.whisper ?? new WhisperCppStt();
  const peers = new Map<string, PeerState>();
  const removeBroadcaster = opts.hub?.addBroadcaster((msg) => {
    opts.sendToRelay({ type: 'to_phone', msg });
  });

  const sendPeer = (peer: string, msg: ServerMessage) => {
    opts.sendToRelay({ type: 'to_phone', peer, msg });
  };

  function addPeer(peer: string): PeerState | null {
    const existing = peers.get(peer);
    if (existing) return existing;
    if (peers.size >= MAX_RELAY_PEERS) {
      sendPeer(peer, { type: 'error', message: 'too many connected peers' });
      return null;
    }
    const state: PeerState = { current_session: null, last_response: '' };
    if (opts.hub) {
      state.removeFromHub = opts.hub.addPeer(
        (msg) => sendPeer(peer, msg),
        () => state.current_session,
      );
    }
    peers.set(peer, state);
    return state;
  }

  function removePeer(peer: string): void {
    peers.get(peer)?.removeFromHub?.();
    peers.delete(peer);
  }

  function resetPeers(): void {
    for (const state of peers.values()) state.removeFromHub?.();
    peers.clear();
  }

  function dispose(): void {
    resetPeers();
    removeBroadcaster?.();
  }

  function ctxFor(peer: string): WsContext {
    return {
      send: (msg: ServerMessage) => sendPeer(peer, msg),
      broadcast: (msg: ServerMessage) => {
        if (opts.hub) opts.hub.broadcast(msg);
        else opts.sendToRelay({ type: 'to_phone', msg });
      },
      sessions: opts.sessions,
      whisper,
      getCfg: () => opts.cfg,
      configPath: opts.configPath,
      settings: opts.settings,
      updateSessionConfig: opts.updateSessionConfig,
      peers: () => opts.hub?.peers() ?? Array.from(peers.entries()).map(([p, state]) => ({
        send: (m: ServerMessage) => sendPeer(p, m),
        currentSession: state.current_session,
      })),
    };
  }

  async function handleFrame(input: unknown): Promise<void> {
    const envelope = RelayEnvelopeSchema.safeParse(input);
    if (!envelope.success) return;
    const frame = envelope.data;
    switch (frame.type) {
      case 'from_phone': {
        const parsed = ClientMessageSchema.safeParse(frame.msg);
        if (!parsed.success) {
          sendPeer(frame.peer, { type: 'error', message: 'invalid message' });
          return;
        }
        const state = addPeer(frame.peer);
        if (!state) return;
        try {
          await handleClientMessage(ctxFor(frame.peer), parsed.data as ClientMessage, state);
        } catch (e: unknown) {
          sendPeer(frame.peer, { type: 'error', message: safeRelayError(e) });
        }
        return;
      }
      case 'peer_gone':
        removePeer(frame.peer);
        return;
      case 'http_request':
        if (frame.path === '/api/config') {
          opts.sendToRelay({ type: 'http_response', id: frame.id, status: 200, body: toPublic(opts.cfg) });
        } else if (frame.path === '/api/settings') {
          opts.sendToRelay({ type: 'http_response', id: frame.id, status: 200, body: opts.settings.publicSafe() });
        } else {
          opts.sendToRelay({ type: 'http_response', id: frame.id, status: 404, body: { error: 'not_found' } });
        }
        return;
    }
  }

  return { handleFrame, resetPeers, dispose };
}

export interface StartRelayOpts extends AttachOpts {
  url: string;
  token: string;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
// A 402 (no Pro plan) will not fix itself in seconds; don't hammer the relay.
const PLAN_REQUIRED_BACKOFF_MS = 5 * 60_000;

export function buildRelayWebSocketUrl(baseUrl: string, token: string): string {
  const parsed = new URL(`${baseUrl.replace(/\/+$/, '')}/desktop`);
  if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
  else if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error('Relay URL must use ws, wss, http, or https');
  }
  parsed.searchParams.set('token', token);
  return parsed.toString();
}

export const PLAN_REQUIRED_HINT =
  '[relay] The hosted relay refused this computer: it needs drivenvibe Pro. ' +
  'Upgrade in the app at app.drivenvibe.com, or self-host for free (LAN or your own tunnel, no relay_token). ' +
  'Retrying in the background.';

/** Operator hint for a refused relay handshake ('ws' reports a non-101 answer as an error). */
export function relayHandshakeHint(error: unknown): string | null {
  return error instanceof Error && error.message === `Unexpected server response: ${PLAN_REQUIRED_STATUS}`
    ? PLAN_REQUIRED_HINT
    : null;
}

/** Outbound relay client: connects to the cloud relay and reconnects forever. */
export function startRelay(opts: StartRelayOpts): void {
  const { url, token, ...collaborators } = opts;
  const wsUrl = buildRelayWebSocketUrl(url, token);
  let backoff = INITIAL_BACKOFF_MS;
  let current: WebSocket | null = null;
  let planHintShown = false;

  const core = createRelayCore({
    ...collaborators,
    sendToRelay: (frame) => {
      if (!current || current.readyState !== WebSocket.OPEN) return;
      if (current.bufferedAmount > MAX_RELAY_BUFFERED_BYTES) {
        current.terminate();
        return;
      }
      try {
        current.send(JSON.stringify(frame));
      } catch {
        current.terminate();
      }
    },
  });

  function connect() {
    const socket = new WebSocket(wsUrl, { maxPayload: MAX_RELAY_PAYLOAD_BYTES });
    current = socket;
    let alive = true;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let stableConnection: ReturnType<typeof setTimeout> | undefined;
    let planRequired = false;

    socket.on('open', () => {
      console.log('[relay] connected');
      // Only reset exponential backoff after a genuinely stable connection;
      // auth failures often open and immediately close the WebSocket.
      stableConnection = setTimeout(() => { backoff = INITIAL_BACKOFF_MS; }, 30_000);
      stableConnection.unref();
      heartbeat = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, 30_000);
      heartbeat.unref();
    });

    socket.on('pong', () => { alive = true; });

    socket.on('message', (raw) => {
      alive = true;
      let json: unknown;
      try {
        json = JSON.parse(raw.toString());
      } catch {
        return; // malformed inbound JSON: ignore
      }
      void core.handleFrame(json).catch((error) => {
        console.error(`[relay] frame handling failed: ${safeRelayError(error)}`);
      });
    });

    socket.on('close', () => {
      if (heartbeat) clearInterval(heartbeat);
      if (stableConnection) clearTimeout(stableConnection);
      if (current === socket) current = null;
      core.resetPeers();
      const delay = Math.round((planRequired ? PLAN_REQUIRED_BACKOFF_MS : backoff) * (0.8 + Math.random() * 0.4));
      console.log(`[relay] disconnected, retrying in ${(delay / 1000).toFixed(1)}s`);
      const timer = setTimeout(connect, delay);
      timer.unref();
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    });

    // 'ws' always fires 'close' after a connection-level 'error', so the backoff
    // above still applies; this handler flags a paywall refusal (5 min backoff), explains it once
    // and stops EventEmitter throwing on unhandled 'error'.
    socket.on('error', (error) => {
      const hint = relayHandshakeHint(error);
      if (hint) planRequired = true;
      if (hint && !planHintShown) {
        planHintShown = true;
        console.warn(hint);
      }
    });
  }

  connect();
}

function safeRelayError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'request failed';
  return raw
    .replace(/\b(?:sk|dv1)[-_\.a-zA-Z0-9]{8,}\b/g, '[redacted]')
    .slice(0, 500) || 'request failed';
}
