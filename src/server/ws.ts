import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { ClientMessage, ServerMessage, GlobalPatch, SessionPatch } from '../../shared/protocol.js';
import type { SessionManager } from './session-manager.js';
import type { Config } from './config.js';
import { loadConfig, addSession, addProject, archiveSession, unarchiveSession, findSession, toPublic } from './config.js';
import { ClientMessageSchema } from './client-message-schema.js';
import type { Settings } from './settings.js';
import { WhisperCppStt } from './stt-whisper.js';
import { createKeyedSerialQueue } from './serial-queue.js';

export interface WsContext {
  send: (msg: ServerMessage) => void;
  broadcast: (msg: ServerMessage) => void;
  sessions: SessionManager;
  getCfg: () => Config;
  configPath: string;
  settings: Settings;
  updateSessionConfig: (sessionId: string, patch: SessionPatch) => Promise<void>;
  peers: () => Iterable<{ send: (m: ServerMessage) => void; currentSession: string | null }>;
  whisper: WhisperCppStt;
}

interface PerSocketState {
  current_session: string | null;
  last_response: string;
  /** Prevents replaying session A's response under session B's id. */
  last_response_session?: string;
}

export const MAX_WS_PAYLOAD_BYTES = 256 * 1024;
const MAX_WS_BUFFERED_BYTES = 1024 * 1024;
const MAX_WS_PEERS = 64;
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Browser WebSockets always carry Origin. Requiring it to match Host blocks a
 * malicious website from silently driving a local drivenvibe server (CSWSH),
 * while command-line/native clients that omit Origin remain compatible.
 */
export function isAllowedWebSocketOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    const expected = new URL(`${parsed.protocol}//${host.trim()}`);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.host.toLowerCase() === expected.host.toLowerCase();
  } catch {
    return false;
  }
}

export interface WsHubPeer {
  send: (msg: ServerMessage) => void;
  currentSession: string | null;
}

/** Shares broadcasts and session-presence across local and relay transports. */
export class WsHub {
  private entries = new Set<{
    send: (msg: ServerMessage) => void;
    getCurrentSession: () => string | null;
  }>();
  private broadcasters = new Set<(msg: ServerMessage) => void>();

  addPeer(send: (msg: ServerMessage) => void, getCurrentSession: () => string | null): () => void {
    const entry = { send, getCurrentSession };
    this.entries.add(entry);
    return () => { this.entries.delete(entry); };
  }

  /** Register one efficient broadcast function per transport. */
  addBroadcaster(broadcast: (msg: ServerMessage) => void): () => void {
    this.broadcasters.add(broadcast);
    return () => { this.broadcasters.delete(broadcast); };
  }

  broadcast(msg: ServerMessage): void {
    for (const broadcast of this.broadcasters) broadcast(msg);
  }

  peers(): WsHubPeer[] {
    return Array.from(this.entries, (entry) => ({
      send: entry.send,
      currentSession: entry.getCurrentSession(),
    }));
  }
}

/** Keep disk reload + in-memory refresh + broadcast in the same order. */
const withConfigContextMutation = createKeyedSerialQueue();

/** Normalize an empty-string API key value into undefined so settings.patch clears it. */
export function normalizeGlobalPatch(patch: GlobalPatch): GlobalPatch {
  const out: GlobalPatch = { ...patch };
  if (out.anthropic_api_key === '') out.anthropic_api_key = undefined;
  if (out.openrouter_api_key === '') out.openrouter_api_key = undefined;
  return out;
}

/**
 * Run a config-file mutation, then reload from disk and broadcast the fresh
 * public config. Also refreshes the shared in-memory `cfg` so SessionManager
 * and GET /api/config don't serve stale data after add/archive.
 */
async function mutateAndBroadcast(ctx: WsContext, mutate: () => Promise<unknown>): Promise<void> {
  await withConfigContextMutation(ctx.configPath, async () => {
    await mutate();
    const fresh = await loadConfig(ctx.configPath);
    ctx.getCfg().projects = fresh.projects;
    ctx.broadcast({ type: 'config_changed', config: toPublic(fresh) });
  });
}

export async function handleClientMessage(
  ctx: WsContext,
  msg: ClientMessage,
  state?: PerSocketState,
): Promise<void> {
  const st = state ?? { current_session: null, last_response: '' };
  switch (msg.type) {
    case 'open_session':
      st.current_session = msg.session_id;
      ctx.send({ type: 'ready' });
      return;
    case 'close_session':
      st.current_session = null;
      return;
    case 'replay':
      if (st.current_session) {
        const inSocket = st.last_response
          && (st.last_response_session === undefined || st.last_response_session === st.current_session)
          ? st.last_response
          : undefined;
        const persisted = inSocket ?? ctx.sessions.getLastResponse?.(st.current_session);
        if (persisted) {
          ctx.send({ type: 'say', session_id: st.current_session, text: persisted });
        }
      }
      return;
    case 'update_settings':
      if (msg.scope === 'global') {
        const normalized = normalizeGlobalPatch(msg.patch);
        await ctx.settings.patch(normalized as any);
        // Build broadcast patch: start from publicSafe() (which has key-presence flags),
        // then overlay the public (non-secret) fields from the patch so clients see the
        // updated values even if the settings store mock/impl hasn't flushed yet.
        const base = ctx.settings.publicSafe();
        const { anthropic_api_key: _a, openrouter_api_key: _o, ...publicFields } = normalized;
        const broadcastPatch = { ...base, ...publicFields };
        ctx.broadcast({ type: 'settings_changed', scope: 'global', patch: broadcastPatch });
      } else {
        // Empty-string model means "clear" — mirror the API-key normalization.
        const normalized: SessionPatch = { ...msg.patch };
        if (normalized.model === '') normalized.model = undefined;
        await withConfigContextMutation(ctx.configPath, async () => {
          await ctx.updateSessionConfig(msg.session_id, normalized);
          ctx.broadcast({ type: 'settings_changed', scope: 'session', session_id: msg.session_id, patch: normalized });
        });
      }
      return;
    case 'user_message': {
      const sessionId = msg.session_id;
      const text = msg.text.trim();
      if (!text) {
        ctx.send({ type: 'cc_done', session_id: sessionId });
        return;
      }
      let collected = '';
      let cancelled = false;
      for await (const chunk of ctx.sessions.send(sessionId, text)) {
        if (chunk.cancelled) cancelled = true;
        if (chunk.text) {
          collected += chunk.text;
          ctx.send({ type: 'cc_chunk', session_id: sessionId, text: chunk.text });
        }
      }
      if (cancelled) {
        ctx.send({ type: 'cc_done', session_id: sessionId });
        return;
      }
      st.last_response = collected;
      st.last_response_session = sessionId;
      ctx.send({ type: 'cc_done', session_id: sessionId });
      if (collected) {
        ctx.send({ type: 'say', session_id: sessionId, text: collected });
        const cfg = ctx.getCfg();
        const found = findSession(cfg, sessionId);
        if (found) {
          const { project, session } = found;
          const readyMsg: ServerMessage = {
            type: 'session_ready',
            session_id: sessionId,
            project_id: project.id,
            label: session.label,
            color: session.color,
          };
          for (const peer of ctx.peers()) {
            if (peer.currentSession !== sessionId) {
              peer.send(readyMsg);
            }
          }
        }
      }
      return;
    }
    case 'add_session':
      await mutateAndBroadcast(ctx, () => addSession(ctx.configPath, msg.project_id, msg.payload));
      return;
    case 'add_project':
      await mutateAndBroadcast(ctx, () => addProject(ctx.configPath, msg.payload));
      return;
    case 'archive_session':
      await mutateAndBroadcast(ctx, () => archiveSession(ctx.configPath, msg.session_id));
      return;
    case 'unarchive_session':
      await mutateAndBroadcast(ctx, () => unarchiveSession(ctx.configPath, msg.session_id));
      return;
    case 'audio_blob': {
      // Server-side STT: decode base64 audio, transcribe via whisper.cpp,
      // then emit a `transcript` message back to the client so it can
      // display the text and send it as a user_message.
      const sessionId = msg.session_id;
      const cfg = ctx.getCfg();
      const found = findSession(cfg, sessionId);
      if (!found || found.session.stt_backend !== 'server') {
        // Guard: only handle when the session is explicitly configured for server STT.
        ctx.send({ type: 'error', message: 'audio_blob received but stt_backend is not "server" for this session' });
        return;
      }
      let audioBuffer: Buffer;
      try {
        audioBuffer = Buffer.from(msg.audio, 'base64');
      } catch {
        ctx.send({ type: 'error', message: 'audio_blob: invalid base64 payload' });
        return;
      }
      let text: string;
      try {
        text = await ctx.whisper.transcribe(audioBuffer, msg.mime);
      } catch (e: any) {
        ctx.send({ type: 'error', message: `STT failed: ${e?.message ?? String(e)}` });
        return;
      }
      ctx.send({ type: 'transcript', session_id: sessionId, text });
      return;
    }
    case 'cancel':
      if (st.current_session) ctx.sessions.cancel(st.current_session);
      return;
  }
}

export interface AttachOpts {
  sessions: SessionManager;
  cfg: Config;
  settings: Settings;
  configPath: string;
  updateSessionConfig: (sessionId: string, patch: SessionPatch) => Promise<void>;
  /** Optional cross-transport hub; use one instance for direct WS + relay. */
  hub?: WsHub;
  whisper?: WhisperCppStt;
}

export function attachWs(server: Server | HttpsServer, opts: AttachOpts) {
  const whisper = opts.whisper ?? new WhisperCppStt();
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: MAX_WS_PAYLOAD_BYTES,
    verifyClient: ({ origin, req }: { origin: string; secure: boolean; req: IncomingMessage }) => {
      const forwarded = req.headers['x-forwarded-host'];
      const forwardedHost = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
      return isAllowedWebSocketOrigin(origin, req.headers.host)
        || isAllowedWebSocketOrigin(origin, forwardedHost);
    },
  });

  /** Registry of every open client: send function + per-socket state reference. */
  const peerRegistry = new Set<{ send: (m: ServerMessage) => void; state: PerSocketState }>();

  const localBroadcast = (m: ServerMessage) => {
    for (const p of peerRegistry) p.send(m);
  };
  const removeBroadcaster = opts.hub?.addBroadcaster(localBroadcast);
  const broadcast = (m: ServerMessage) => {
    if (opts.hub) opts.hub.broadcast(m);
    else localBroadcast(m);
  };

  wss.on('connection', (ws: WebSocket & { isAlive?: boolean }) => {
    if (peerRegistry.size >= MAX_WS_PEERS) {
      ws.close(1013, 'too many connected clients');
      return;
    }
    const state: PerSocketState = { current_session: null, last_response: '' };
    const send = (m: ServerMessage) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
        ws.terminate();
        return;
      }
      try {
        ws.send(JSON.stringify(m));
      } catch {
        ws.terminate();
      }
    };
    const peerEntry = { send, state };
    peerRegistry.add(peerEntry);
    const removeFromHub = opts.hub?.addPeer(send, () => state.current_session);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const ctx: WsContext = {
      ...opts,
      whisper,
      send,
      broadcast,
      getCfg: () => opts.cfg,
      peers: () => {
        if (opts.hub) return opts.hub.peers();
        const result: { send: (m: ServerMessage) => void; currentSession: string | null }[] = [];
        for (const p of peerRegistry) {
          result.push({ send: p.send, currentSession: p.state.current_session });
        }
        return result;
      },
    };

    ws.on('message', async (raw, isBinary) => {
      if (isBinary) {
        send({ type: 'error', message: 'binary messages are not supported' });
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(raw.toString());
      } catch {
        send({ type: 'error', message: 'bad json' });
        return;
      }
      const parsed = ClientMessageSchema.safeParse(json);
      if (!parsed.success) {
        send({ type: 'error', message: 'invalid message' });
        return;
      }
      try {
        await handleClientMessage(ctx, parsed.data as ClientMessage, state);
      } catch (e: unknown) {
        send({ type: 'error', message: clientSafeError(e) });
      }
    });

    ws.on('error', () => {});
    ws.on('close', () => {
      peerRegistry.delete(peerEntry);
      removeFromHub?.();
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients as Set<WebSocket & { isAlive?: boolean }>) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  wss.on('close', () => {
    clearInterval(heartbeat);
    removeBroadcaster?.();
  });

  return wss;
}

function clientSafeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'request failed';
  // Avoid reflecting API keys/tokens that an upstream error happened to echo.
  return raw
    .replace(/\b(?:sk|dv1)[-_\.a-zA-Z0-9]{8,}\b/g, '[redacted]')
    .slice(0, 500) || 'request failed';
}
