import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * First-run bootstrap for `npx drivenvibe`: write `<home>/.drivenvibe/config.json`
 * from the packaged config.example.json, with one Claude subscription session
 * pointing at `cwd`. Never overwrites an existing file.
 */
export async function ensureConfig(opts: { home: string; cwd: string; examplePath: string }): Promise<{ path: string; created: boolean }> {
  const dir = path.join(opts.home, '.drivenvibe');
  const file = path.join(dir, 'config.json');
  try {
    await fs.access(file);
    return { path: file, created: false };
  } catch { /* missing: create below */ }

  const example = JSON.parse((await fs.readFile(opts.examplePath, 'utf-8')).replace(/^\uFEFF/, ''));
  const project = example.projects[0];
  const session = project.sessions.find((s: { provider?: string }) => (s.provider ?? 'subscription') === 'subscription');
  const cfg = { projects: [{ ...project, sessions: [{ ...session, project_dir: opts.cwd }] }] };

  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    // 'wx' fails if the file appeared meanwhile, so a concurrent first run cannot clobber it.
    await fs.writeFile(file, JSON.stringify(cfg, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return { path: file, created: false };
    throw e;
  }
  return { path: file, created: true };
}
