import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRO_PRICE_LABEL,
  SELF_HOST_URL,
  checkoutUrlFrom,
  isPlanRequired,
  proPriceLabel,
  startCheckout,
  takeCheckoutSuccess,
} from '../src/pwa/upgrade-screen.js';
import { PLAN_REQUIRED_HINT, relayHandshakeHint, startRelay } from '../src/server/relay.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('upgrade screen logic', () => {
  it('recognises only the 402 plan_required boot response', () => {
    expect(isPlanRequired(402, { error: 'plan_required' })).toBe(true);
    expect(isPlanRequired(402, { error: 'other' })).toBe(false);
    expect(isPlanRequired(403, { error: 'plan_required' })).toBe(false);
    expect(isPlanRequired(402, null)).toBe(false);
  });

  it('uses the configured price label, falling back to the default', () => {
    expect(proPriceLabel(undefined)).toBe(DEFAULT_PRO_PRICE_LABEL);
    expect(proPriceLabel('   ')).toBe(DEFAULT_PRO_PRICE_LABEL);
    expect(proPriceLabel('$9 / month')).toBe('$9 / month');
    expect(DEFAULT_PRO_PRICE_LABEL).toBe('€7 / month');
  });

  it('links self-hosting to the README desktop setup', () => {
    expect(SELF_HOST_URL).toBe('https://github.com/wminus-org/drivenvibe#desktop-setup');
  });

  it('only follows https checkout urls', () => {
    expect(checkoutUrlFrom({ url: 'https://sandbox.polar.sh/checkout/co_1' })).toBe('https://sandbox.polar.sh/checkout/co_1');
    expect(checkoutUrlFrom({ url: 'http://polar.sh/checkout' })).toBeNull();
    expect(checkoutUrlFrom({ url: 'javascript:alert(1)' })).toBeNull();
    expect(checkoutUrlFrom({ url: 'not a url' })).toBeNull();
    expect(checkoutUrlFrom({})).toBeNull();
    expect(checkoutUrlFrom(null)).toBeNull();
  });

  it('detects and strips ?checkout=success, keeping the rest of the url', () => {
    expect(takeCheckoutSuccess('https://app.drivenvibe.com/?checkout=success')).toBe('/');
    expect(takeCheckoutSuccess('https://app.drivenvibe.com/?checkout=success&checkout_id=co_1&x=1#top'))
      .toBe('/?checkout_id=co_1&x=1#top');
    expect(takeCheckoutSuccess('https://app.drivenvibe.com/?checkout=failed')).toBeNull();
    expect(takeCheckoutSuccess('https://app.drivenvibe.com/')).toBeNull();
  });

  it('startCheckout posts to /api/checkout and navigates only to a valid https url', async () => {
    const fetchMock = vi.fn(async () => Response.json({ url: 'https://polar.sh/checkout/co_9' }));
    vi.stubGlobal('fetch', fetchMock);
    const navigate = vi.fn();
    await startCheckout(navigate);
    expect(fetchMock).toHaveBeenCalledWith('/api/checkout', { method: 'POST' });
    expect(navigate).toHaveBeenCalledWith('https://polar.sh/checkout/co_9');

    fetchMock.mockImplementation(async () => Response.json({ url: 'http://evil.example' }));
    await expect(startCheckout(navigate)).rejects.toThrow();
    fetchMock.mockImplementation(async () => Response.json({ error: 'billing_unavailable' }, { status: 503 }));
    await expect(startCheckout(navigate)).rejects.toThrow();
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe('desktop relay handshake refused with 402', () => {
  let server: Server | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  it('maps only the 402 handshake error to the Pro hint', () => {
    expect(relayHandshakeHint(new Error('Unexpected server response: 402'))).toBe(PLAN_REQUIRED_HINT);
    expect(relayHandshakeHint(new Error('Unexpected server response: 401'))).toBeNull();
    expect(relayHandshakeHint('nope')).toBeNull();
    expect(PLAN_REQUIRED_HINT).toMatch(/Pro/);
    expect(PLAN_REQUIRED_HINT).toMatch(/self-host/i);
  });

  it('logs the hint once against a relay that answers 402, and retries after ~5 minutes, not 1 s', async () => {
    let attempts = 0;
    server = createServer((_req, res) => { res.writeHead(404).end(); });
    server.on('upgrade', (_req, socket) => {
      attempts += 1;
      socket.end('HTTP/1.1 402 Payment Required\r\nContent-Type: application/json\r\nContent-Length: 26\r\n\r\n{"error":"plan_required"}\n');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['setTimeout'] }); // only the reconnect timer; sockets stay real

    startRelay({ url: `http://127.0.0.1:${port}`, token: 'dv1.test.token' } as Parameters<typeof startRelay>[0]);
    const retryLog = () => log.mock.calls.map(([message]) => String(message)).find((message) => message.includes('retrying in'));
    await vi.waitFor(() => expect(retryLog()).toBeDefined(), { timeout: 5000, interval: 20 });
    const seconds = Number(/retrying in ([\d.]+)s/.exec(retryLog()!)![1]);
    expect(seconds).toBeGreaterThanOrEqual(240); // 5 min ± 20 % jitter
    expect(seconds).toBeLessThanOrEqual(360);

    vi.advanceTimersByTime(239_000);
    expect(attempts).toBe(1);
    vi.advanceTimersByTime(122_000);
    await vi.waitFor(() => expect(attempts).toBe(2), { timeout: 5000, interval: 20 });
    const hints = warn.mock.calls.filter(([message]) => message === PLAN_REQUIRED_HINT);
    expect(hints).toHaveLength(1);
  }, 15_000);
});
