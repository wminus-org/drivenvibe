import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, type Config } from './config.js';
import { Settings } from './settings.js';
import { CERT_PATH, KEY_PATH, isUsablePair } from './cert.js';
import { listIPv4 } from './net-info.js';
import { CONFIG_PATH, SETTINGS_PATH } from './paths.js';

/**
 * `npx drivenvibe doctor`: each check is a pure function over injected facts
 * (env, fs probes, exec results) so it is testable without touching the
 * machine. Checks never print secrets: keys are only ever tested for presence.
 */

export interface Check {
  status: 'ok' | 'warn' | 'fail';
  title: string;
  detail?: string;
  fix?: string;
}

export type Exec = (cmd: string, args: string[]) => { status: number | null };
type Env = Record<string, string | undefined>;

const activeSessions = (cfg: Config) => cfg.projects.flatMap((p) => p.sessions).filter((s) => !s.archived);

export function checkNode(version: string): Check {
  const major = Number(version.split('.')[0]);
  return major >= 20
    ? { status: 'ok', title: `Node.js ${version}` }
    : { status: 'fail', title: `Node.js ${version} is too old (need 20 or newer)`, fix: 'Install the LTS version from https://nodejs.org' };
}

export function checkConfig(
  input: { path: string; cfg?: Config; error?: string; missing?: boolean },
  dirExists: (p: string) => boolean,
): Check[] {
  if (input.missing) {
    return [{
      status: 'fail', title: `No config at ${input.path}`,
      fix: 'cd into your project folder and run: npx drivenvibe (it creates the config)',
    }];
  }
  if (!input.cfg) {
    return [{
      status: 'fail', title: `Config is invalid: ${input.path}`, detail: input.error?.split('\n')[0].slice(0, 300),
      fix: `Fix that file (see config.example.json), or delete it and run npx drivenvibe in your project folder`,
    }];
  }
  const sessions = activeSessions(input.cfg);
  const checks: Check[] = [{ status: 'ok', title: `Config ${input.path} (${sessions.length} session${sessions.length === 1 ? '' : 's'})` }];
  for (const s of sessions) {
    checks.push(dirExists(s.project_dir)
      ? { status: 'ok', title: `Session "${s.label}" folder ${s.project_dir}` }
      : { status: 'fail', title: `Session "${s.label}" folder does not exist: ${s.project_dir}`, fix: `Edit project_dir for "${s.label}" in ${input.path}` });
  }
  return checks;
}

/**
 * Claude credentials, per https://code.claude.com/docs/en/authentication
 * ("Credential management"): Windows/Linux keep the /login credential in
 * <CLAUDE_CONFIG_DIR or ~/.claude>/.credentials.json; macOS keeps it in the
 * Keychain, which we cannot read, so there we only say "could not verify".
 */
export function checkClaude(opts: {
  cfg: Config;
  keys: { has_anthropic_key: boolean; has_openrouter_key: boolean };
  env: Env;
  platform: NodeJS.Platform;
  home: string;
  fileExists: (p: string) => boolean;
}): Check[] {
  const providers = new Set(activeSessions(opts.cfg).map((s) => s.provider ?? 'subscription'));
  const checks: Check[] = [];
  if (providers.has('subscription')) {
    const dir = opts.env.CLAUDE_CONFIG_DIR || path.join(opts.home, '.claude');
    const file = path.join(dir, '.credentials.json');
    const loginFix = 'Install Claude Code (https://code.claude.com/docs/en/setup), then run: claude auth login';
    if (opts.env.ANTHROPIC_AUTH_TOKEN || opts.env.CLAUDE_CODE_OAUTH_TOKEN) {
      const name = opts.env.ANTHROPIC_AUTH_TOKEN ? 'ANTHROPIC_AUTH_TOKEN' : 'CLAUDE_CODE_OAUTH_TOKEN';
      checks.push({ status: 'ok', title: `Claude credentials from ${name}` });
    } else if (opts.fileExists(file)) {
      checks.push({ status: 'ok', title: `Claude login found (${file})` });
    } else if (opts.platform === 'darwin') {
      checks.push({
        status: 'warn', title: 'Claude login',
        detail: 'Could not verify: on macOS the login lives in the Keychain.',
        fix: 'If Claude does not answer, run claude once in a terminal and log in',
      });
    } else {
      checks.push({ status: 'fail', title: `Claude is not logged in (no ${file})`, fix: loginFix });
    }
    if (opts.env.ANTHROPIC_API_KEY) {
      checks.push({
        status: 'warn', title: 'ANTHROPIC_API_KEY is set in this shell',
        detail: 'drivenvibe removes it for subscription sessions, but claude in this terminal uses it instead of your login.',
        fix: opts.platform === 'win32' ? 'Remove-Item Env:ANTHROPIC_API_KEY' : 'unset ANTHROPIC_API_KEY',
      });
    }
  }
  if (providers.has('anthropic-api')) {
    checks.push(opts.keys.has_anthropic_key
      ? { status: 'ok', title: 'Anthropic API key saved in settings' }
      : {
        status: 'fail', title: 'A session uses anthropic-api but no API key is saved',
        detail: opts.env.ANTHROPIC_API_KEY ? 'drivenvibe reads the key from its Settings, not from ANTHROPIC_API_KEY.' : undefined,
        fix: 'Open Settings (gear icon) on the phone and paste your Anthropic API key',
      });
  }
  if (providers.has('openrouter')) {
    checks.push(opts.keys.has_openrouter_key
      ? { status: 'ok', title: 'OpenRouter key saved in settings' }
      : { status: 'fail', title: 'A session uses openrouter but no OpenRouter key is saved', fix: 'Add openrouter_api_key in Settings' });
  }
  return checks;
}

export function checkCodex(cfg: Config, exec: Exec): Check[] {
  if (!activeSessions(cfg).some((s) => s.provider === 'codex')) return [];
  if (exec('codex', ['--version']).status !== 0) {
    return [{ status: 'fail', title: 'Codex CLI not found on PATH', fix: 'npm i -g @openai/codex, then: codex login' }];
  }
  // Only the exit code: `codex login status` prints a (masked) API key.
  return [
    { status: 'ok', title: 'Codex CLI installed' },
    exec('codex', ['login', 'status']).status === 0
      ? { status: 'ok', title: 'Codex logged in' }
      : { status: 'fail', title: 'Codex is not logged in', fix: 'codex login' },
  ];
}

export type PortProbe = 'free' | 'busy' | 'denied';

export function checkPort(port: number, probe: PortProbe): Check {
  if (probe === 'free') return { status: 'ok', title: `Port ${port} is free` };
  if (probe === 'busy') {
    return { status: 'fail', title: `Port ${port} is busy`, fix: `Stop the other drivenvibe, or run PORT=${port + 1} npx drivenvibe` };
  }
  return { status: 'fail', title: `Not allowed to use port ${port}`, fix: 'Use a port above 1024, e.g. PORT=8788 npx drivenvibe' };
}

export function checkHttps(env: Env, cert: 'missing' | 'stale' | 'ok'): Check {
  if (env.TUNNEL) return { status: 'ok', title: 'HTTPS comes from the Cloudflare tunnel' };
  if (env.HTTP_ONLY === '1') {
    return {
      status: 'warn', title: 'HTTP_ONLY=1: serving plain HTTP',
      detail: 'Phone browsers only allow the microphone over HTTPS (or on localhost).',
      fix: 'Start without HTTP_ONLY to get HTTPS',
    };
  }
  if (cert === 'missing') return { status: 'warn', title: 'No HTTPS certificate yet', detail: 'It is created on the next start; accept the warning on the phone once.' };
  if (cert === 'stale') {
    return { status: 'warn', title: 'HTTPS certificate does not cover the current addresses', detail: 'It is regenerated on the next start; accept the new warning on the phone once.' };
  }
  return { status: 'ok', title: 'HTTPS certificate valid for this machine\'s addresses' };
}

export function checkTunnel(env: Env, exec: Exec): Check[] {
  const tunnel = (env.TUNNEL || '').toLowerCase();
  if (!tunnel) return [];
  const checks: Check[] = [exec('cloudflared', ['--version']).status === 0
    ? { status: 'ok', title: 'cloudflared installed' }
    : { status: 'fail', title: 'TUNNEL is set but cloudflared is not on PATH', fix: 'Windows: winget install Cloudflare.cloudflared   macOS: brew install cloudflared' }];
  if (tunnel === 'cloudflare' && env.ALLOW_INSECURE_TUNNEL !== '1') {
    checks.push({
      status: 'fail', title: 'TUNNEL=cloudflare needs an explicit opt-in (public URL, no login)',
      fix: 'ALLOW_INSECURE_TUNNEL=1 TUNNEL=cloudflare npx drivenvibe (temporary tests only)',
    });
  }
  return checks;
}

/** firewallRule: undefined when unknown (non-Windows). */
export function checkLan(ips: string[], platform: NodeJS.Platform, port: number, firewallRule: boolean | undefined): Check[] {
  if (ips.length === 0) {
    return [{
      status: 'warn', title: 'No LAN or ZeroTier address found: only localhost works',
      fix: 'Connect this computer to the same Wi-Fi as the phone, or join a ZeroTier network',
    }];
  }
  const checks: Check[] = [{ status: 'ok', title: `Reachable addresses: ${ips.join(', ')}` }];
  if (platform === 'win32') {
    // setup-firewall.bat ships only in the git repo, not in the npm package.
    checks.push(firewallRule
      ? { status: 'ok', title: 'Windows Firewall rule "drivenvibe" exists', detail: 'Its port and network scope are not checked.' }
      : {
        status: 'warn', title: 'No Windows Firewall rule for drivenvibe',
        detail: 'If the phone cannot connect, allow the port (or click Allow on the first-start firewall prompt).',
        fix: `In an admin terminal: netsh advfirewall firewall add rule name="drivenvibe" dir=in action=allow protocol=TCP localport=${port} profile=private`,
      });
  }
  return checks;
}

const MARK = { ok: '✓', warn: '!', fail: '✗' } as const;

export function formatReport(checks: Check[]): { text: string; exitCode: number } {
  const lines: string[] = [];
  for (const c of checks) {
    lines.push(`${MARK[c.status]} ${c.title}`);
    if (c.detail) lines.push(`    ${c.detail}`);
    if (c.fix) lines.push(`    fix: ${c.fix}`);
  }
  return { text: lines.join('\n'), exitCode: checks.some((c) => c.status === 'fail') ? 1 : 0 };
}

/** One line for the startup `main().catch`, instead of a stack trace. */
export function friendlyStartupError(e: unknown, port: number): string {
  const err = e as NodeJS.ErrnoException;
  if (err?.code === 'EADDRINUSE') return `Port ${port} is busy. Stop the other drivenvibe or run PORT=${port + 1} npx drivenvibe`;
  if (err?.code === 'EACCES' && err.syscall === 'listen') {
    return `Not allowed to use port ${port}. Use a port above 1024: PORT=8788 npx drivenvibe`;
  }
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split('\n')[0];
}

function probePort(port: number): Promise<PortProbe> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'EACCES' ? 'denied' : 'busy'));
    srv.listen(port, '0.0.0.0', () => srv.close(() => resolve('free')));
  });
}

// Fixed commands and args only (never user input), so a shell is safe; it is
// needed on Windows, where npm-installed CLIs are .cmd shims.
const realExec: Exec = (cmd, args) => {
  const r = spawnSync(cmd, args, { shell: process.platform === 'win32', stdio: 'ignore', timeout: 15_000 });
  return { status: r.error ? null : r.status };
};

function certState(ips: string[]): 'missing' | 'stale' | 'ok' {
  if (!existsSync(CERT_PATH) || !existsSync(KEY_PATH)) return 'missing';
  try {
    return isUsablePair(readFileSync(CERT_PATH, 'utf-8'), readFileSync(KEY_PATH, 'utf-8'), ips.concat('127.0.0.1')) ? 'ok' : 'stale';
  } catch {
    return 'stale';
  }
}

export async function runDoctorCli(): Promise<number> {
  const env = process.env;
  const port = Number(env.PORT ?? 8787);
  const ips = listIPv4().map((a) => a.address);
  const checks: Check[] = [checkNode(process.versions.node)];

  let cfg: Config | undefined;
  if (!existsSync(CONFIG_PATH)) {
    checks.push(...checkConfig({ path: CONFIG_PATH, missing: true }, existsSync));
  } else {
    try {
      cfg = await loadConfig(CONFIG_PATH);
      checks.push(...checkConfig({ path: CONFIG_PATH, cfg }, existsSync));
    } catch (e) {
      checks.push(...checkConfig({ path: CONFIG_PATH, error: (e as Error).message }, existsSync));
    }
  }
  if (cfg) {
    let keys = { has_anthropic_key: false, has_openrouter_key: false };
    try {
      keys = (await Settings.load(SETTINGS_PATH)).publicSafe();
    } catch {
      checks.push({ status: 'fail', title: `Settings file is invalid: ${SETTINGS_PATH}`, fix: 'Fix or delete that file, then re-enter keys in Settings' });
    }
    checks.push(...checkClaude({ cfg, keys, env, platform: process.platform, home: os.homedir(), fileExists: existsSync }));
    checks.push(...checkCodex(cfg, realExec));
  }
  checks.push(checkPort(port, await probePort(port)));
  checks.push(checkHttps(env, certState(ips)));
  checks.push(...checkTunnel(env, realExec));
  const firewallRule = process.platform === 'win32'
    ? realExec('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=drivenvibe']).status === 0
    : undefined;
  checks.push(...checkLan(ips, process.platform, port, firewallRule));

  const { text, exitCode } = formatReport(checks);
  console.log(`drivenvibe doctor\n\n${text}\n`);
  console.log('Phone: use Chrome (Android) or Safari (iPhone), not an in-app browser (Gmail, Slack, ...), and allow the microphone when asked.');
  console.log(exitCode ? '\nSomething needs fixing (✗ above).' : '\nNo blocking problems found.');
  return exitCode;
}
