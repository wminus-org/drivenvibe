import { z } from 'zod';
import { SessionPatchSchema } from './config.js';

/**
 * Runtime validation for messages arriving over the WebSocket. The wire types
 * in shared/protocol.ts are compile-time only; a malicious or buggy client can
 * send any JSON, so every message is parsed against this union before dispatch.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;
const providerEnum = z.enum(['subscription', 'anthropic-api', 'openrouter', 'codex']);
const id = z.string().min(1).max(256);
const label = z.string().min(1).max(200);
const emoji = z.string().max(64);
const model = z.string().max(512);

/** Large enough for pasted context, bounded to prevent one frame exhausting RAM. */
export const MAX_USER_MESSAGE_CHARS = 100_000;

/**
 * Base64 audio for one server-STT utterance. Must stay under the 256 KB WS frame
 * cap (see MAX_WS_PAYLOAD_BYTES) — the blob ships as a single frame, so anything
 * larger is dropped by the socket before the schema ever sees it. At the 24 kbps
 * Opus the recorder is pinned to, this is roughly 45 s of speech.
 * ponytail: single-frame upload; chunk the audio if utterances need to run longer.
 */
export const MAX_AUDIO_BLOB_CHARS = 240_000;

const GlobalPatchSchema = z.object({
  anthropic_api_key: z.string().max(16_384).optional(),
  openrouter_api_key: z.string().max(16_384).optional(),
  default_provider: providerEnum.optional(),
  theme: z.enum(['auto', 'light', 'dark']).optional(),
  haptics: z.boolean().optional(),
}).strict();

const NewSessionPayloadSchema = z.object({
  label,
  color: z.string().regex(HEX),
  emoji: emoji.optional(),
  project_dir: z.string().min(1).max(4096),
  provider: providerEnum.optional(),
  model: model.optional(),
}).strict();

const NewProjectPayloadSchema = z.object({
  label,
  color: z.string().regex(HEX),
  emoji: emoji.optional(),
}).strict();

// A plain union (not discriminatedUnion) because `update_settings` appears
// twice with the same `type` discriminator — distinguished by `scope` instead,
// which discriminatedUnion can't express.
export const ClientMessageSchema = z.union([
  z.object({ type: z.literal('open_session'), session_id: id }),
  z.object({ type: z.literal('close_session') }),
  z.object({ type: z.literal('user_message'), session_id: id, text: z.string().max(MAX_USER_MESSAGE_CHARS) }),
  z.object({
    type: z.literal('audio_blob'),
    session_id: id,
    audio: z.string().min(1).max(MAX_AUDIO_BLOB_CHARS),
    mime: z.string().min(1).max(128),
  }),
  z.object({ type: z.literal('cancel') }),
  z.object({ type: z.literal('replay') }),
  z.object({ type: z.literal('update_settings'), scope: z.literal('global'), patch: GlobalPatchSchema }),
  z.object({ type: z.literal('update_settings'), scope: z.literal('session'), session_id: id, patch: SessionPatchSchema }),
  z.object({ type: z.literal('add_session'), project_id: id, payload: NewSessionPayloadSchema }),
  z.object({ type: z.literal('archive_session'), session_id: id }),
  z.object({ type: z.literal('unarchive_session'), session_id: id }),
  z.object({ type: z.literal('add_project'), payload: NewProjectPayloadSchema }),
]);
