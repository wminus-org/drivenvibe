// Cross-platform dev launcher: runs the API/WS server (with hot reload) and the
// Vite PWA dev server together, in one command.
//
// Why this exists instead of `concurrently "npm:dev:server" "npm:dev:pwa"`:
// on Windows, `tsx watch` (which spawns its own inner worker) silently hangs
// when launched as a grandchild of concurrently — it prints its banner but
// never binds the port, and Vite then logs ECONNREFUSED proxying /api. Node's
// native `--watch` with the tsx loader runs in a single process and starts
// reliably under a process manager, so we spawn the two halves ourselves.

import { spawn } from 'node:child_process';
import process from 'node:process';

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (c.exitCode === null && !c.killed) c.kill();
  }
  process.exit(code);
}

function run(name, args, extraEnv = {}) {
  // Always spawn `node` (process.execPath) directly — no shell, no .cmd
  // wrapper — so this behaves identically on Windows, macOS and Linux.
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  child.on('error', (err) => {
    console.error(`[dev] failed to start ${name}: ${err.message}`);
    shutdown(1);
  });
  child.on('exit', (code) => {
    console.log(`[dev] ${name} exited (code ${code}); stopping the other process.`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] starting drivenvibe in dev mode (server :8787 + Vite PWA :5173)…');
console.log('[dev] open http://localhost:5173  —  Ctrl+C stops both.');

// Server: force HTTP (HTTP_ONLY=1) so Vite's http://localhost:8787 proxy lines
// up; the server otherwise defaults to a self-signed HTTPS listener.
run('server', ['--import', 'tsx', '--watch', 'src/server/index.ts'], { HTTP_ONLY: '1' });

// PWA: Vite dev server (HMR + proxy of /api and /ws to the server).
run('pwa', ['node_modules/vite/bin/vite.js']);
