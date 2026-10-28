import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { pwaDirFor } from '../src/server/http.js';
import { ensureConfig } from '../src/server/init-config.js';
import { loadConfig } from '../src/server/config.js';

const root = path.resolve('/pkg');
const example = path.resolve('config.example.json');

describe('pwaDirFor', () => {
  it('resolves <repo>/dist/pwa from the TypeScript source', () => {
    const url = pathToFileURL(path.join(root, 'src/server/http.ts')).href;
    expect(pwaDirFor(url)).toBe(path.join(root, 'dist/pwa'));
  });

  it('resolves <package>/dist/pwa from the bundled server', () => {
    const url = pathToFileURL(path.join(root, 'dist/server/index.js')).href;
    expect(pwaDirFor(url)).toBe(path.join(root, 'dist/pwa'));
  });
});

describe('ensureConfig', () => {
  it('writes a valid config pointing at cwd when none exists', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'dnv-home-'));
    const cwd = path.join(home, 'my-project');
    const result = await ensureConfig({ home, cwd, examplePath: example });

    expect(result.created).toBe(true);
    expect(result.path).toBe(path.join(home, '.drivenvibe', 'config.json'));
    const cfg = await loadConfig(result.path);
    const sessions = cfg.projects.flatMap((p) => p.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].project_dir).toBe(cwd);
    expect(sessions[0].provider).toBe('subscription');
  });

  it('never overwrites an existing config', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'dnv-home-'));
    const first = await ensureConfig({ home, cwd: home, examplePath: example });
    writeFileSync(first.path, '{"projects":[]}');
    const second = await ensureConfig({ home, cwd: '/elsewhere', examplePath: example });

    expect(second.created).toBe(false);
    expect(readFileSync(first.path, 'utf8')).toBe('{"projects":[]}');
  });
});
