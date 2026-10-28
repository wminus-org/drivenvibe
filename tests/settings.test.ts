import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Settings } from '../src/server/settings.js';

const tmp = path.join(os.tmpdir(), `dv-settings-${Date.now()}.json`);

beforeEach(async () => {
  try { await fs.unlink(tmp); } catch {}
});

describe('Settings', () => {
  it('returns defaults when file missing', async () => {
    const s = await Settings.load(tmp);
    expect(s.get('anthropic_api_key')).toBeUndefined();
    expect(s.get('openrouter_api_key')).toBeUndefined();
    expect(s.get('default_provider')).toBe('subscription');
    expect(s.get('theme')).toBe('auto');
  });

  it('persists and reloads a value', async () => {
    const s1 = await Settings.load(tmp);
    await s1.set('anthropic_api_key', 'sk-ant-xyz');
    const s2 = await Settings.load(tmp);
    expect(s2.get('anthropic_api_key')).toBe('sk-ant-xyz');
  });

  it('persists multiple keys via patch', async () => {
    const s = await Settings.load(tmp);
    await s.patch({ openrouter_api_key: 'sk-or-1', theme: 'dark' });
    const s2 = await Settings.load(tmp);
    expect(s2.get('openrouter_api_key')).toBe('sk-or-1');
    expect(s2.get('theme')).toBe('dark');
  });

  it('accepts codex as the default provider without a provider key', async () => {
    const s = await Settings.load(tmp);
    await s.set('default_provider', 'codex');
    expect((await Settings.load(tmp)).publicSafe()).toEqual({
      default_provider: 'codex', theme: 'auto', haptics: true,
      has_anthropic_key: false, has_openrouter_key: false,
    });
  });

  it('rejects unknown keys at the type level (smoke: still saves but not typed)', async () => {
    const s = await Settings.load(tmp);
    // unknown keys are silently dropped by the schema
    // @ts-expect-error
    await s.patch({ foo: 'bar' });
    const s2 = await Settings.load(tmp);
    // @ts-expect-error
    expect(s2.get('foo')).toBeUndefined();
  });
});
