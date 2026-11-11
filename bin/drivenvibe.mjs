#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Before any dynamic import: the bundled server needs Node 20 APIs and would
// otherwise die with an unrelated-looking stack trace.
// ponytail: Node < 14.8 cannot even parse this file (top-level await) and fails first.
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) {
  console.error(`drivenvibe needs Node.js 20 or newer; this is Node ${process.versions.node}.
Install the LTS version from https://nodejs.org and run npx drivenvibe again.`);
  process.exit(1);
}

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
  npx drivenvibe doctor     check Node, config, Claude/Codex login, port, HTTPS, network
  drivenvibe --help         show this help
  drivenvibe --version      print the version

First run creates ~/.drivenvibe/config.json with one session pointing at the
current directory. Edit that file to add projects and sessions.

Environment:
  RELAY_TOKEN=dv1...        link token for the hosted relay (coming soon)
  RELAY_URL=wss://...       relay URL (default wss://app.drivenvibe.com)
  PORT=8787                 local HTTP(S) port (default 8787)
  HTTP_ONLY=1               serve plain HTTP instead of self-signed HTTPS
  TUNNEL=named|cloudflare   start a Cloudflare tunnel
  TUNNEL_NAME=drivenvibe    named tunnel to run (with TUNNEL=named)
  ALLOW_INSECURE_TUNNEL=1   required for TUNNEL=cloudflare (public quick tunnel)
  NO_QR=1                   do not print the QR code at startup
  DEBUG=1                   print full stack traces on startup errors

Docs: https://github.com/wminus-org/drivenvibe#readme`);
  process.exit(0);
}

if (args[0] === 'doctor') {
  const { runDoctorCli } = await import('../dist/server/doctor.js');
  process.exit(await runDoctorCli());
}

try {
  const { ensureConfig } = await import('../dist/server/init-config.js');
  const { path: configPath, created } = await ensureConfig({
    home: os.homedir(),
    cwd: process.cwd(),
    examplePath: fileURLToPath(new URL('../config.example.json', import.meta.url)),
  });
  if (created) {
    console.log(`[drivenvibe] First run: created ${configPath}
  One Claude Code session ("Coding") points at ${process.cwd()}.
  Add more projects later from the phone (+ button) or by editing that file.`);
  }
} catch (e) {
  console.error(`[drivenvibe] Could not create ~/.drivenvibe/config.json: ${e?.message ?? e}`);
  console.error('Run `npx drivenvibe doctor` to check your setup.');
  if (process.env.DEBUG === '1') console.error(e);
  process.exit(1);
}

await import('../dist/server/index.js');
