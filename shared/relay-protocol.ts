// Relay envelope protocol: desktop server ↔ relay worker (app.drivenvibe.com).
//
// The relay (a Cloudflare Durable Object, one per user) multiplexes many phone
// sockets over ONE outbound desktop socket. Phone↔server messages are the
// unchanged ClientMessage/ServerMessage from protocol.ts, wrapped in an
// envelope that names which phone ("peer") they belong to.
//
// The desktop also answers the PWA's two HTTP GETs (/api/config,
// /api/settings) via http_request/http_response frames, so the relay never
// needs to know anything about app state.

import type { ClientMessage, ServerMessage } from './protocol.js';

/** Relay → desktop. */
export type RelayToDesktop =
  | { type: 'from_phone'; peer: string; msg: ClientMessage }
  | { type: 'peer_gone'; peer: string }
  | { type: 'http_request'; id: string; method: 'GET'; path: '/api/config' | '/api/settings' };

/** Desktop → relay. */
export type DesktopToRelay =
  /** peer omitted = broadcast to every connected phone. */
  | { type: 'to_phone'; peer?: string; msg: ServerMessage }
  | { type: 'http_response'; id: string; status: number; body: unknown };

/**
 * Device token format (stateless, HMAC-signed by the relay worker):
 *   dv1.<base64url(clerkUserId)>.<base64url(hmacSHA256(clerkUserId, DEVICE_TOKEN_SECRET))>
 * ponytail: one global signing secret — no per-token revocation; rotate the
 * secret to invalidate all tokens. Move to KV-backed tokens if that hurts.
 */
export const DEVICE_TOKEN_PREFIX = 'dv1';

/**
 * Hosted-relay paywall (only when the worker runs with PAYWALL_ENABLED=1):
 * /ws, /desktop, /api/config and /api/settings answer HTTP 402
 * {"error":"plan_required"} for users without drivenvibe Pro. Self-hosting
 * (LAN or your own tunnel) never talks to the relay and stays free.
 */
export const PLAN_REQUIRED_STATUS = 402;
export const PLAN_REQUIRED_ERROR = 'plan_required';
