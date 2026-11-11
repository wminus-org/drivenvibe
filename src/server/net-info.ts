import os from 'node:os';

export interface IfaceAddr {
  iface: string;
  address: string;
  isZeroTier: boolean;
}

/** Enumerate all non-loopback IPv4 addresses across all interfaces. */
export function listIPv4(): IfaceAddr[] {
  const out: IfaceAddr[] = [];
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) {
        // ZeroTier on Windows tends to name the adapter "ZeroTier One [ID]" or similar.
        const isZeroTier = /zerotier/i.test(name);
        out.push({ iface: name, address: a.address, isZeroTier });
      }
    }
  }
  // Best phone address first: the first entry is the one the QR code points at.
  out.sort((a, b) => addrRank(a.iface, a.address) - addrRank(b.iface, b.address));
  return out;
}

/**
 * Lower is better: ZeroTier, then real adapters, then host-only virtual
 * switches (Hyper-V/WSL/Docker/VM), then link-local 169.254.x (no DHCP).
 * ponytail: name-based heuristic; unusual adapter names just fall into "real".
 */
export function addrRank(iface: string, address: string): number {
  if (/zerotier/i.test(iface)) return 0;
  if (address.startsWith('169.254.')) return 3;
  if (/vEthernet|WSL|docker|br-|veth|virtualbox|vbox|vmware|vmnet|hyper-v/i.test(iface)) return 2;
  return 1;
}

export function formatBox(lines: string[]): string {
  const w = Math.max(...lines.map((l) => l.length));
  const top = '┌' + '─'.repeat(w + 4) + '┐';
  const bot = '└' + '─'.repeat(w + 4) + '┘';
  const body = lines.map((l) => '│  ' + l.padEnd(w) + '  │').join('\n');
  return `${top}\n${body}\n${bot}`;
}

/** THE URL to open on the phone: tunnel, else the first address (ZeroTier sorts first), else localhost. */
export function phoneUrl(opts: { tunnelUrl: string | null; addrs: IfaceAddr[]; proto: 'http' | 'https'; port: number }): string {
  if (opts.tunnelUrl) return opts.tunnelUrl;
  const host = opts.addrs[0]?.address ?? 'localhost';
  return `${opts.proto}://${host}:${opts.port}`;
}

export function nextSteps(opts: { selfSigned: boolean }): string[] {
  const steps = ['Open the URL above on your phone (Chrome or Safari, not an in-app browser).'];
  if (opts.selfSigned) steps.push('Accept the "untrusted certificate" warning once (Advanced > Proceed).');
  steps.push('Pick the session, tap the mic and allow microphone access.');
  return [
    'Next:',
    ...steps.map((s, i) => `  ${i + 1}. ${s}`),
    'Something not working? Run: npx drivenvibe doctor',
  ];
}

/** QR codes are for humans: keep piped/logged output clean, and honour NO_QR=1. */
export function shouldPrintQr(isTTY: boolean | undefined, env: Record<string, string | undefined>): boolean {
  return !!isTTY && env.NO_QR !== '1';
}
