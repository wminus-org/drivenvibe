// Messages from phone → server
export type ClientMessage =
  | { type: 'open_session'; session_id: string }
  | { type: 'close_session' }
  | { type: 'user_message'; session_id: string; text: string }
  | { type: 'audio_blob'; session_id: string; audio: string; mime: string }
  | { type: 'cancel' }
  | { type: 'replay' }
  | { type: 'update_settings'; scope: 'global'; patch: GlobalPatch }
  | { type: 'update_settings'; scope: 'session'; session_id: string; patch: SessionPatch }
  | { type: 'add_session'; project_id: string; payload: NewSessionPayload }
  | { type: 'archive_session'; session_id: string }
  | { type: 'unarchive_session'; session_id: string }
  | { type: 'add_project'; payload: NewProjectPayload };

// Messages from server → phone
export type ServerMessage =
  | { type: 'ready' }
  /** Sent by the RELAY (not the desktop) in cloud mode: whether this user's
   *  desktop is currently connected. Never sent in local/self-host mode. */
  | { type: 'desktop_status'; online: boolean }
  | { type: 'cc_chunk'; session_id: string; text: string }
  | { type: 'cc_done'; session_id: string }
  | { type: 'say'; session_id: string; text: string }
  | { type: 'transcript'; session_id: string; text: string }
  | { type: 'error'; message: string }
  | { type: 'settings_changed'; scope: 'global'; patch: PublicGlobalPatch }
  | { type: 'settings_changed'; scope: 'session'; session_id: string; patch: SessionPatch }
  | { type: 'session_ready'; session_id: string; project_id: string; label: string; color: string }
  | { type: 'config_changed'; config: PublicConfig };

export type Provider = 'subscription' | 'anthropic-api' | 'openrouter' | 'codex';
export type Theme = 'auto' | 'light' | 'dark';

/** Fields the phone is allowed to patch on the global Settings store. */
export interface GlobalPatch {
  anthropic_api_key?: string;
  openrouter_api_key?: string;
  default_provider?: Provider;
  theme?: Theme;
  haptics?: boolean;
}

/** Same shape but with secrets redacted — what the server broadcasts back. */
export interface PublicGlobalPatch {
  default_provider?: Provider;
  theme?: Theme;
  haptics?: boolean;
  has_anthropic_key?: boolean;
  has_openrouter_key?: boolean;
}

export type SttBackend = 'browser' | 'server';

/** Fields the phone is allowed to patch per session. Creation-time fields
 *  (id, project_dir, color, label, emoji) are NOT mutable here — those are
 *  Issue #3 (+ button) territory. */
export interface SessionPatch {
  tts_rate?: number;
  lang?: string;
  voice_mode?: boolean;
  provider?: Provider;
  model?: string;
  stt_backend?: SttBackend;
}

export interface NewSessionPayload {
  label: string;
  color: string;
  emoji?: string;
  project_dir: string;
  provider?: Provider;
  model?: string;
}

export interface NewProjectPayload {
  label: string;
  color: string;
  emoji?: string;
}

export interface SessionPublic {
  id: string;
  label: string;
  color: string;
  emoji?: string;
  /** BCP-47 language tag for SpeechRecognition. */
  lang?: string;
  /** Playback rate for speechSynthesis. 1.0 = normal. */
  tts_rate?: number;
  /** Append voice-mode instructions to Claude's system prompt. */
  voice_mode?: boolean;
  /** Which Claude backend this session uses. */
  provider?: Provider;
  /** Model name (required for openrouter; optional for others). */
  model?: string;
  /** STT backend: 'browser' uses Web Speech API (default); 'server' uses whisper.cpp. */
  stt_backend?: SttBackend;
  archived?: boolean;
}

export interface ProjectPublic {
  id: string;
  label: string;
  color: string;
  emoji?: string;
  sessions: SessionPublic[];
}

export interface PublicConfig {
  projects: ProjectPublic[];
}

/** Shape returned by GET /api/settings — global UI prefs + key presence flags. */
export interface PublicSettings {
  default_provider: Provider;
  theme: Theme;
  haptics: boolean;
  has_anthropic_key: boolean;
  has_openrouter_key: boolean;
}
