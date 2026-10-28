import { CONFIG_PATH, STATE_PATH, SETTINGS_PATH } from './paths.js';
import { loadConfig, updateSession } from './config.js';
import { Settings } from './settings.js';
import { State } from './state.js';
import { createHttp } from './http.js';
import { attachWs, WsHub } from './ws.js';
import { startRelay } from './relay.js';
import { SessionManager } from './session-manager.js';
import { ensureSelfSignedCert } from './cert.js';
import { listIPv4, formatBox } from './net-info.js';
import { assertInsecureTunnelAllowed, startCloudflareTunnel, startNamedTunnel } from './tunnel.js';
import type { SessionPatch } from '../../shared/protocol.js';

const DEFAULT_RELAY_URL = 'wss://app.drivenvibe.com';

const PORT = Number(process.env.PORT ?? 8787);
const TUNNEL = (process.env.TUNNEL || '').toLowerCase();
const TUNNEL_NAME = process.env.TUNNEL_NAME || 'drivenvibe';
const USE_TUNNEL = TUNNEL === 'cloudflare' || TUNNEL === 'named';
const USE_HTTPS = !USE_TUNNEL && process.env.HTTP_ONLY !== '1';

async function main() {
  if (TUNNEL === 'cloudflare') assertInsecureTunnelAllowed();

  const cfg = await loadConfig(CONFIG_PATH).catch((e: Error) => {
    console.error(`[drivenvibe] Failed to load ${CONFIG_PATH}:\n  ${e.message ?? e}`);
    console.error('Copy config.example.json to ~/.drivenvibe/config.json and add at least one session.');
    process.exit(1);
  });

  const settings = await Settings.load(SETTINGS_PATH);
  const state = await State.load(STATE_PATH);
  const sessions = new SessionManager(cfg, settings, state);
  const hub = new WsHub();

  const addrs = listIPv4();
  const ipsForCert = addrs.map((a) => a.address).concat(['127.0.0.1']);
  const tls = USE_HTTPS ? await ensureSelfSignedCert(ipsForCert) : undefined;

  const app = await createHttp(cfg, settings, tls);
  await app.listen({ port: PORT, host: '0.0.0.0' });

  const updateSessionConfig = async (sessionId: string, patch: SessionPatch): Promise<void> => {
    await updateSession(CONFIG_PATH, sessionId, patch);
    // Reflect the change in the in-memory cfg so SessionManager picks it up.
    const fresh = await loadConfig(CONFIG_PATH);
    cfg.projects = fresh.projects;
  };

  attachWs(app.server as any, { sessions, cfg, settings, configPath: CONFIG_PATH, updateSessionConfig, hub });

  // env overrides settings; url defaults to the hosted relay once a token exists.
  const relayToken = process.env.RELAY_TOKEN || settings.get('relay_token');
  const relayUrl = process.env.RELAY_URL || settings.get('relay_url') || DEFAULT_RELAY_URL;
  if (relayToken) {
    startRelay({ url: relayUrl, token: relayToken, sessions, cfg, settings, configPath: CONFIG_PATH, updateSessionConfig, hub });
  }

  let tunnelUrl: string | null = null;
  let tunnelLabel = '';
  if (TUNNEL === 'named') {
    console.log(`[drivenvibe] starting named Cloudflare tunnel '${TUNNEL_NAME}'…`);
    const { url } = await startNamedTunnel(TUNNEL_NAME);
    tunnelUrl = url;
    tunnelLabel = `Cloudflare named tunnel '${TUNNEL_NAME}' (stable URL, account-managed)`;
  } else if (TUNNEL === 'cloudflare') {
    console.log('[drivenvibe] starting Cloudflare quick tunnel…');
    const { url } = await startCloudflareTunnel(PORT);
    tunnelUrl = url;
    tunnelLabel = 'Cloudflare quick tunnel (random URL, no account needed)';
  }

  const proto = USE_HTTPS ? 'https' : 'http';
  const lines: string[] = [];
  lines.push(`drivenvibe running on port ${PORT} (${proto.toUpperCase()})`);
  lines.push('');
  if (tunnelUrl) {
    lines.push(`━━━ ${tunnelLabel} ━━━`);
    lines.push(`  ${tunnelUrl}`);
    lines.push('');
    lines.push('Open this URL on your phone (anywhere, any network).');
    if (TUNNEL === 'named') {
      lines.push('SECURITY: verify a Cloudflare Access policy is active; the tunnel alone is not authentication.');
    } else {
      lines.push('NOTE: this URL is publicly reachable. Treat it as a secret.');
    }
  } else {
    lines.push('Open one of these on your phone (same ZeroTier network):');
    if (addrs.length === 0) {
      lines.push('  (no external IPv4 addresses found — only localhost works)');
    } else {
      for (const a of addrs) {
        const tag = a.isZeroTier ? '  ← ZeroTier' : '';
        lines.push(`  ${proto}://${a.address}:${PORT}${tag}`);
      }
    }
    lines.push('');
    lines.push(`Local: ${proto}://localhost:${PORT}`);
    lines.push('SECURITY: use only a trusted LAN/ZeroTier network; connected clients can control sessions.');
    if (USE_HTTPS) {
      lines.push('');
      lines.push('First time on phone: accept the "untrusted certificate" warning.');
    }
  }
  if (relayToken) {
    lines.push('');
    lines.push(`Relay: ${relayUrl} (cloud phones can connect)`);
  }
  console.log('\n' + formatBox(lines) + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
