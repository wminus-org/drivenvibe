import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  checkNode, checkConfig, checkClaude, checkCodex, checkPort, checkHttps, checkTunnel, checkLan,
  formatReport, friendlyStartupError, type Check,
} from '../src/server/doctor.js';
import type { Config } from '../src/server/config.js';

const home = path.resolve('/home/u');
const session = (over: Record<string, unknown> = {}) => ({
  id: 's1', label: 'S', color: '#abcdef', project_dir: '/work/app',
  provider: 'subscription', voice_mode: true, tts_rate: 1.2, stt_backend: 'browser', ...over,
});
const cfgWith = (...sessions: object[]) => ({
  projects: [{ id: 'p', label: 'P', color: '#123456', sessions }],
}) as unknown as Config;
const noKeys = { has_anthropic_key: false, has_openrouter_key: false };
const statuses = (checks: Check[]) => checks.map((c) => c.status);

describe('checkNode', () => {
  it('passes on Node 20+ and fails below with an install hint', () => {
    expect(checkNode('20.0.0').status).toBe('ok');
    const old = checkNode('18.19.1');
    expect(old.status).toBe('fail');
    expect(old.fix).toMatch(/nodejs\.org/);
  });
});

describe('checkConfig', () => {
  it('fails when the config file is missing, telling how to create it', () => {
    const [c] = checkConfig({ path: '/c.json', missing: true }, () => true);
    expect(c.status).toBe('fail');
    expect(c.fix).toMatch(/npx drivenvibe/);
  });

  it('fails on an invalid config with the parse error', () => {
    const [c] = checkConfig({ path: '/c.json', error: 'Malformed JSON in /c.json: Unexpected token' }, () => true);
    expect(c.status).toBe('fail');
    expect(c.detail).toMatch(/Malformed JSON/);
  });

  it('flags each session whose project_dir is missing, ignoring archived ones', () => {
    const cfg = cfgWith(session(), session({ id: 's2', project_dir: '/gone' }), session({ id: 's3', project_dir: '/gone2', archived: true }));
    const checks = checkConfig({ path: '/c.json', cfg }, (p) => p === '/work/app');
    expect(statuses(checks)).toEqual(['ok', 'ok', 'fail']);
    expect(checks[2].title).toMatch(/\/gone/);
  });
});

describe('checkClaude', () => {
  const base = { cfg: cfgWith(session()), keys: noKeys, env: {}, platform: 'win32' as NodeJS.Platform, home };

  it('passes when the subscription login file exists in ~/.claude', () => {
    const want = path.join(home, '.claude', '.credentials.json');
    const [c] = checkClaude({ ...base, fileExists: (p) => p === want });
    expect(c.status).toBe('ok');
  });

  it('honours CLAUDE_CONFIG_DIR', () => {
    const want = path.join('/alt', '.credentials.json');
    const [c] = checkClaude({ ...base, env: { CLAUDE_CONFIG_DIR: '/alt' }, fileExists: (p) => p === want });
    expect(c.status).toBe('ok');
  });

  it('fails on Windows/Linux without a login, with the login command', () => {
    const [c] = checkClaude({ ...base, fileExists: () => false });
    expect(c.status).toBe('fail');
    expect(c.fix).toMatch(/claude auth login/);
  });

  it('only warns on macOS, where the login lives in the Keychain', () => {
    const [c] = checkClaude({ ...base, platform: 'darwin', fileExists: () => false });
    expect(c.status).toBe('warn');
    expect(c.detail).toMatch(/could not verify/i);
  });

  it('accepts CLAUDE_CODE_OAUTH_TOKEN without printing it', () => {
    const checks = checkClaude({ ...base, env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-secretsecret' }, fileExists: () => false });
    expect(checks[0].status).toBe('ok');
    expect(JSON.stringify(checks)).not.toContain('secretsecret');
  });

  it('warns when ANTHROPIC_API_KEY is set next to a subscription session, without printing it', () => {
    const checks = checkClaude({ ...base, env: { ANTHROPIC_API_KEY: 'sk-ant-api03-secretsecret' }, fileExists: () => true });
    expect(statuses(checks)).toEqual(['ok', 'warn']);
    expect(JSON.stringify(checks)).not.toContain('secretsecret');
  });

  it('fails an anthropic-api session without a saved key, even if the env var is set', () => {
    const checks = checkClaude({ ...base, cfg: cfgWith(session({ provider: 'anthropic-api' })), env: { ANTHROPIC_API_KEY: 'x' }, fileExists: () => false });
    expect(statuses(checks)).toEqual(['fail']);
    expect(checks[0].fix).toMatch(/Settings/);
    const ok = checkClaude({ ...base, cfg: cfgWith(session({ provider: 'anthropic-api' })), keys: { ...noKeys, has_anthropic_key: true }, fileExists: () => false });
    expect(statuses(ok)).toEqual(['ok']);
  });

  it('checks nothing when only codex sessions exist', () => {
    expect(checkClaude({ ...base, cfg: cfgWith(session({ provider: 'codex' })), fileExists: () => false })).toEqual([]);
  });
});

describe('checkCodex', () => {
  const exec = (results: Record<string, number | null>) => (cmd: string, args: string[]) => ({ status: results[[cmd, ...args].join(' ')] ?? null });

  it('is skipped when no codex session is configured', () => {
    expect(checkCodex(cfgWith(session()), exec({}))).toEqual([]);
  });

  it('fails when codex is not on PATH', () => {
    const checks = checkCodex(cfgWith(session({ provider: 'codex' })), exec({}));
    expect(statuses(checks)).toEqual(['fail']);
    expect(checks[0].fix).toMatch(/npm i(nstall)? -g @openai\/codex/);
  });

  it('fails when codex is installed but not logged in', () => {
    const checks = checkCodex(cfgWith(session({ provider: 'codex' })), exec({ 'codex --version': 0, 'codex login status': 1 }));
    expect(statuses(checks)).toEqual(['ok', 'fail']);
    expect(checks[1].fix).toBe('codex login');
  });

  it('passes when logged in', () => {
    expect(statuses(checkCodex(cfgWith(session({ provider: 'codex' })), exec({ 'codex --version': 0, 'codex login status': 0 })))).toEqual(['ok', 'ok']);
  });
});

describe('checkPort', () => {
  it('reports a busy port with the PORT override', () => {
    const c = checkPort(8787, 'busy');
    expect(c.status).toBe('fail');
    expect(c.fix).toMatch(/PORT=8788/);
    expect(checkPort(8787, 'free').status).toBe('ok');
  });
});

describe('checkHttps', () => {
  it('notes that HTTP_ONLY blocks the phone mic except on localhost', () => {
    const c = checkHttps({ HTTP_ONLY: '1' }, 'missing');
    expect(c.status).toBe('warn');
    expect(c.detail).toMatch(/localhost/);
  });
  it('treats a missing or stale cert as a heads-up, not a failure', () => {
    expect(checkHttps({}, 'missing').status).toBe('warn');
    expect(checkHttps({}, 'stale').status).toBe('warn');
    expect(checkHttps({}, 'ok').status).toBe('ok');
  });
});

describe('checkTunnel', () => {
  it('is skipped without TUNNEL and checks cloudflared with it', () => {
    expect(checkTunnel({}, () => ({ status: null }))).toEqual([]);
    const missing = checkTunnel({ TUNNEL: 'named' }, () => ({ status: null }));
    expect(statuses(missing)).toEqual(['fail']);
    expect(missing[0].fix).toMatch(/winget install Cloudflare\.cloudflared|brew install cloudflared/);
  });
  it('fails a quick tunnel without the explicit opt-in', () => {
    const checks = checkTunnel({ TUNNEL: 'cloudflare' }, () => ({ status: 0 }));
    expect(statuses(checks)).toEqual(['ok', 'fail']);
    expect(checks[1].fix).toMatch(/ALLOW_INSECURE_TUNNEL=1/);
  });
});

describe('checkLan', () => {
  it('warns when there is no LAN address', () => {
    expect(statuses(checkLan([], 'linux', 8787, undefined))).toEqual(['warn']);
  });
  it('gives the netsh command on Windows when no firewall rule exists', () => {
    const checks = checkLan(['192.168.1.5'], 'win32', 8787, false);
    expect(statuses(checks)).toEqual(['ok', 'warn']);
    expect(checks[1].fix).toMatch(/netsh advfirewall firewall add rule name="drivenvibe".*localport=8787/);
  });
  it('accepts an existing firewall rule', () => {
    expect(statuses(checkLan(['10.0.0.2'], 'win32', 8787, true))).toEqual(['ok', 'ok']);
  });
});

describe('formatReport', () => {
  it('prints one marked line per check and exits 1 only on a hard failure', () => {
    const warnOnly = formatReport([{ status: 'ok', title: 'a' }, { status: 'warn', title: 'b', fix: 'do b' }]);
    expect(warnOnly.exitCode).toBe(0);
    expect(warnOnly.text).toMatch(/✓ a/);
    expect(warnOnly.text).toMatch(/! b/);
    expect(warnOnly.text).toMatch(/do b/);
    expect(formatReport([{ status: 'fail', title: 'c' }]).exitCode).toBe(1);
  });
});

describe('friendlyStartupError', () => {
  it('turns EADDRINUSE into the PORT hint', () => {
    const e = Object.assign(new Error('listen EADDRINUSE: address already in use 0.0.0.0:8787'), { code: 'EADDRINUSE' });
    expect(friendlyStartupError(e, 8787)).toBe('Port 8787 is busy. Stop the other drivenvibe or run PORT=8788 npx drivenvibe');
  });
  it('turns EACCES on listen into a port hint', () => {
    const e = Object.assign(new Error('listen EACCES: permission denied 0.0.0.0:80'), { code: 'EACCES', syscall: 'listen' });
    expect(friendlyStartupError(e, 80)).toMatch(/not allowed to use port 80/i);
  });
  it('keeps the first line of other errors', () => {
    expect(friendlyStartupError(new Error('cloudflared not found on PATH.\nmore'), 8787)).toBe('cloudflared not found on PATH.');
  });
});
