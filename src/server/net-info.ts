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
  // Put ZeroTier interfaces first so they're easy to spot.
  out.sort((a, b) => Number(b.isZeroTier) - Number(a.isZeroTier));
  return out;
}

export function formatBox(lines: string[]): string {
  const w = Math.max(...lines.map((l) => l.length));
  const top = '┌' + '─'.repeat(w + 4) + '┐';
  const bot = '└' + '─'.repeat(w + 4) + '┘';
  const body = lines.map((l) => '│  ' + l.padEnd(w) + '  │').join('\n');
  return `${top}\n${body}\n${bot}`;
}
