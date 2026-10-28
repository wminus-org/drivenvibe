import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

export function extractTryCloudflareUrl(text: string): string | null {
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return m ? m[0] : null;
}

export function assertInsecureTunnelAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.ALLOW_INSECURE_TUNNEL === '1') return;

  throw new Error(
    '[drivenvibe] Refusing to start a public Cloudflare quick tunnel without application authentication. ' +
      'Set ALLOW_INSECURE_TUNNEL=1 only for an intentional temporary test. ' +
      'For normal remote access, use a named tunnel with Cloudflare Access: ' +
      'https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/ ' +
      'and https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/',
  );
}

/**
 * Spawn `cloudflared tunnel` against the local HTTP port and resolve to the
 * public trycloudflare.com URL once printed. URL changes every run.
 */
export async function startCloudflareTunnel(
  localPort: number,
): Promise<{ url: string; proc: ChildProcess }> {
  const proc = spawn(
    'cloudflared',
    ['tunnel', '--url', `http://localhost:${localPort}`, '--no-autoupdate'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const url = await waitForCloudflared(
    proc,
    (output) => extractTryCloudflareUrl(output),
    'Cloudflare tunnel',
  );
  proc.on('error', onCloudflaredRuntimeError);

  return { url, proc };
}

/**
 * Spawn a named cloudflared tunnel using a config file under ~/.cloudflared/.
 * Returns the stable public URL parsed from the config's ingress hostname.
 * URL is the same every run (named tunnel + DNS).
 */
export async function startNamedTunnel(
  tunnelName: string,
): Promise<{ url: string; proc: ChildProcess }> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(tunnelName)) {
    throw new Error('Invalid tunnel name; use only letters, numbers, underscores, and hyphens');
  }
  const configPath = path.join(os.homedir(), '.cloudflared', `${tunnelName}.yml`);
  const cfgText = await fs.readFile(configPath, 'utf-8').catch(() => {
    throw new Error(
      `Named tunnel config not found at ${configPath}. ` +
        `Run: cloudflared tunnel create ${tunnelName} && cloudflared tunnel route dns ${tunnelName} <hostname>`,
    );
  });
  const hostMatch = cfgText.match(/hostname:\s*['"]?([^'"\s#]+)['"]?/i);
  if (!hostMatch) throw new Error(`No hostname found in ${configPath}`);
  const hostname = hostMatch[1];
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)) {
    throw new Error(`Invalid hostname in ${configPath}`);
  }
  const url = `https://${hostname}`;

  const proc = spawn(
    'cloudflared',
    ['tunnel', '--config', configPath, '--no-autoupdate', 'run', tunnelName],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  // Wait until at least one connection is registered so we don't return a URL
  // that is not yet reachable.
  await waitForCloudflared(
    proc,
    (output) => /Registered tunnel connection|connIndex=0/i.test(output) ? true : null,
    'Named tunnel',
  );
  proc.on('error', onCloudflaredRuntimeError);

  return { url, proc };
}

function waitForCloudflared<T>(
  proc: ChildProcess,
  extract: (output: string) => T | null,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let output = '';
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      proc.stdout?.off('data', onData);
      proc.stderr?.off('data', onData);
      proc.off('error', onError);
      proc.off('exit', onExit);
      if (error) reject(error);
      else resolve(value as T);
    };
    const onData = (buf: Buffer) => {
      output = (output + buf.toString('utf8')).slice(-64 * 1024);
      const value = extract(output);
      if (value !== null) finish(undefined, value);
    };
    const onError = (error: NodeJS.ErrnoException) => finish(cloudflaredError(error));
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(new Error(`${label} exited before becoming ready (code ${code ?? 'none'}, signal ${signal ?? 'none'})`));
    };
    const timeout = setTimeout(() => {
      proc.kill();
      finish(new Error(`${label} start timed out after 30s`));
    }, 30_000);
    timeout.unref();
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.once('error', onError);
    proc.once('exit', onExit);
  });
}

function cloudflaredError(e: NodeJS.ErrnoException): Error {
  if (e.code === 'ENOENT') {
    return new Error(
      'cloudflared not found on PATH. Install it first ' +
      '(on Windows: winget install Cloudflare.cloudflared)',
    );
  }
  return e;
}

function onCloudflaredRuntimeError(e: NodeJS.ErrnoException): void {
  console.error(`[drivenvibe] cloudflared error: ${cloudflaredError(e).message}`);
}
