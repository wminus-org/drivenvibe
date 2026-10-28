import { describe, expect, it } from 'vitest';
import { assertInsecureTunnelAllowed } from '../src/server/tunnel.js';

describe('Cloudflare quick tunnel guard', () => {
  it('rejects quick tunnels unless explicitly opted in', () => {
    expect(() => assertInsecureTunnelAllowed({})).toThrow(/ALLOW_INSECURE_TUNNEL=1/);
  });

  it('rejects values other than 1', () => {
    expect(() => assertInsecureTunnelAllowed({ ALLOW_INSECURE_TUNNEL: 'true' })).toThrow();
  });

  it('allows the explicit temporary opt-in', () => {
    expect(() => assertInsecureTunnelAllowed({ ALLOW_INSECURE_TUNNEL: '1' })).not.toThrow();
  });
});
