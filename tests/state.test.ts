import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { State } from '../src/server/state.js';

const tmp = path.join(os.tmpdir(), `dv-state-${Date.now()}.json`);

beforeEach(async () => {
  try { await fs.unlink(tmp); } catch {}
});

describe('State', () => {
  it('returns undefined for unknown session', async () => {
    const s = await State.load(tmp);
    expect(s.getCcSessionId('x')).toBeUndefined();
  });

  it('persists session id across reloads', async () => {
    const s = await State.load(tmp);
    await s.setCcSessionId('coding', 'uuid-1');
    const s2 = await State.load(tmp);
    expect(s2.getCcSessionId('coding')).toBe('uuid-1');
  });

  it('stores and returns last response', async () => {
    const s = await State.load(tmp);
    await s.setLastResponse('coding', 'Hello');
    expect(s.getLastResponse('coding')).toBe('Hello');
  });
});
