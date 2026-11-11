import { describe, expect, it } from 'vitest';
import { phoneUrl, nextSteps, shouldPrintQr } from '../src/server/net-info.js';

const lan = { iface: 'Wi-Fi', address: '192.168.1.5', isZeroTier: false };
const zt = { iface: 'ZeroTier One', address: '10.147.17.2', isZeroTier: true };

describe('phoneUrl', () => {
  it('prefers the tunnel, then the first (ZeroTier-sorted) address, then localhost', () => {
    expect(phoneUrl({ tunnelUrl: 'https://x.example.com', addrs: [zt, lan], proto: 'https', port: 8787 })).toBe('https://x.example.com');
    expect(phoneUrl({ tunnelUrl: null, addrs: [zt, lan], proto: 'https', port: 8787 })).toBe('https://10.147.17.2:8787');
    expect(phoneUrl({ tunnelUrl: null, addrs: [], proto: 'http', port: 9000 })).toBe('http://localhost:9000');
  });
});

describe('nextSteps', () => {
  it('names the cert warning only for self-signed HTTPS', () => {
    expect(nextSteps({ selfSigned: true }).join('\n')).toMatch(/certificate/);
    expect(nextSteps({ selfSigned: false }).join('\n')).not.toMatch(/certificate/);
  });
  it('ends with the session + mic step and the doctor hint', () => {
    const text = nextSteps({ selfSigned: true }).join('\n');
    expect(text).toMatch(/tap the mic/);
    expect(text).toMatch(/npx drivenvibe doctor/);
  });
});

describe('shouldPrintQr', () => {
  it('prints only on a TTY and never with NO_QR=1', () => {
    expect(shouldPrintQr(true, {})).toBe(true);
    expect(shouldPrintQr(false, {})).toBe(false);
    expect(shouldPrintQr(undefined, {})).toBe(false);
    expect(shouldPrintQr(true, { NO_QR: '1' })).toBe(false);
  });
});

describe('addrRank', () => {
  it('orders ZeroTier, then real adapters, then virtual (Hyper-V/WSL/Docker), then link-local', async () => {
    const { addrRank } = await import('../src/server/net-info.js');
    const seen = [
      ['vEthernet (WSL)', '172.21.32.1'],
      ['Ethernet 3', '169.254.250.191'],
      ['Wi-Fi', '192.168.0.16'],
      ['docker0', '172.17.0.1'],
      ['ZeroTier One [x]', '10.242.118.12'],
    ].sort((a, b) => addrRank(a[0], a[1]) - addrRank(b[0], b[1])).map((a) => a[0]);
    expect(seen).toEqual(['ZeroTier One [x]', 'Wi-Fi', 'vEthernet (WSL)', 'docker0', 'Ethernet 3']);
  });
});
