import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { writeJsonAtomic, readJsonOrDefault } from './fs-util.js';
import { createSerialQueue } from './serial-queue.js';

const SettingsSchema = z.object({
  anthropic_api_key: z.string().max(16_384).optional(),
  openrouter_api_key: z.string().max(16_384).optional(),
  default_provider: z
    .enum(['subscription', 'anthropic-api', 'openrouter', 'codex'])
    .default('subscription'),
  theme: z.enum(['auto', 'light', 'dark']).default('auto'),
  haptics: z.boolean().default(true),
  /** Cloud relay creds. Desktop-only config — never exposed via publicSafe(),
   *  and phones can't set them (not in GlobalPatch / client-message-schema). */
  relay_url: z.string().max(2048).optional(),
  relay_token: z.string().max(16_384).optional(),
});

export type SettingsData = z.infer<typeof SettingsSchema>;
export type SettingsKey = keyof SettingsData;

export class Settings {
  /** Serializes durable snapshots so an older write can never land last. */
  private writeQueue = createSerialQueue();

  private constructor(private path: string, private data: SettingsData) {}

  static async load(p: string): Promise<Settings> {
    const raw = await readJsonOrDefault<unknown>(p, {});
    const data = SettingsSchema.parse(raw);
    // Repair overly broad permissions on pre-existing settings files. The file
    // contains API keys, so relying only on permissions used for future writes
    // leaves an avoidable exposure window after upgrade.
    await fs.chmod(p, 0o600).catch(() => {});
    return new Settings(p, data);
  }

  get<K extends SettingsKey>(k: K): SettingsData[K] {
    return this.data[k];
  }

  async set<K extends SettingsKey>(k: K, v: SettingsData[K]): Promise<void> {
    this.data = SettingsSchema.parse({ ...this.data, [k]: v });
    await this.flush(this.data);
  }

  async patch(patch: Partial<SettingsData>): Promise<void> {
    // Re-parse through the schema so unknown keys are dropped and types enforced.
    this.data = SettingsSchema.parse({ ...this.data, ...patch });
    await this.flush(this.data);
  }

  /** Returns a copy safe for sending to the client (keys redacted). */
  publicSafe(): Pick<SettingsData, 'default_provider' | 'theme' | 'haptics'> & {
    has_anthropic_key: boolean;
    has_openrouter_key: boolean;
  } {
    return {
      default_provider: this.data.default_provider,
      theme: this.data.theme,
      haptics: this.data.haptics,
      has_anthropic_key: !!this.data.anthropic_api_key,
      has_openrouter_key: !!this.data.openrouter_api_key,
    };
  }

  private flush(snapshot: SettingsData): Promise<void> {
    // Each snapshot is immutable because set/patch replace (rather than
    // mutate) data, so queuing them by reference is safe.
    return this.writeQueue(() => writeJsonAtomic(this.path, snapshot, { mkdir: true, mode: 0o600 }));
  }
}
