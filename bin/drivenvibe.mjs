#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`drivenvibe - voice-first phone remote for Claude Code and Codex

Usage:
  npx drivenvibe            start the desktop companion
  drivenvibe --help         show this help
  drivenvibe --version      print the version

First run creates ~/.drivenvibe/config.json with one session pointing at the
current directory. Edit that file to add projects and sessions.

Environment:
  RELAY_TOKEN=dv1...        link token from app.drivenvibe.com (hosted relay)
  RELAY_URL=wss://...       relay URL (default wss://app.drivenvibe.com)
  PORT=8787                 local HTTP(S) port (default 8787)
  HTTP_ONLY=1               serve plain HTTP instead of self-signed HTTPS
  TUNNEL=named|cloudflare   start a Cloudflare tunnel
  TUNNEL_NAME=drivenvibe    named tunnel to run (with TUNNEL=named)
  ALLOW_INSECURE_TUNNEL=1   required for TUNNEL=cloudflare (public quick tunnel)

Docs: https://github.com/wminus-org/drivenvibe#readme`);
  process.exit(0);
}

const { ensureConfig } = await import('../dist/server/init-config.js');
const { path: configPath, created } = await ensureConfig({
  home: os.homedir(),
  cwd: process.cwd(),
  examplePath: fileURLToPath(new URL('../config.example.json', import.meta.url)),
});
if (created) {
  console.log(`[drivenvibe] Created ${configPath}
  One session ("Coding") now points at ${process.cwd()}.
  Next steps:
    1. Edit that file to add projects/sessions (see config.example.json in the package).
    2. Phone via hosted relay: sign in at https://app.drivenvibe.com, generate a link token,
       then restart with RELAY_TOKEN=<token> (or set "relay_token" in ~/.drivenvibe/settings.json).
    3. Phone on a trusted LAN/ZeroTier: open one of the URLs printed below.
`);
}

await import('../dist/server/index.js');
