import type { PublicSettings, PublicGlobalPatch } from '../../shared/protocol.js';
import { apiFetch } from './api-fetch.js';

type Listener = () => void;

const DEFAULTS: PublicSettings = {
  default_provider: 'subscription',
  theme: 'auto',
  haptics: true,
  has_anthropic_key: false,
  has_openrouter_key: false,
};

class SettingsStore {
  private global: PublicSettings = { ...DEFAULTS };
  private listeners: Set<Listener> = new Set();

  /** Load global settings from /api/settings. */
  async loadGlobal(): Promise<void> {
    try {
      const r = await apiFetch('/api/settings');
      if (!r.ok) return;
      const s = (await r.json()) as PublicSettings;
      this.global = { ...DEFAULTS, ...s };
      this.emit();
    } catch {
      /* network failed; keep defaults */
    }
  }

  getGlobal(): PublicSettings {
    return { ...this.global };
  }

  /** Merge a server-broadcast global patch. */
  applyGlobalPatch(patch: PublicGlobalPatch): void {
    this.global = { ...this.global, ...patch };
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() { this.listeners.forEach((l) => l()); }
}

export const settingsStore = new SettingsStore();
