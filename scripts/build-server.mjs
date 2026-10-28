// Bundles the desktop server for the npm package: plain Node >= 20, no tsx at runtime.
// Runtime deps stay external (installed from "dependencies"); only our own src/server
// and shared/ code is inlined.
import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'dist/server');

await rm(outdir, { recursive: true, force: true });
await build({
  entryPoints: {
    index: resolve(root, 'src/server/index.ts'),
    'init-config': resolve(root, 'src/server/init-config.ts'),
  },
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  logLevel: 'warning',
});
console.log(`built ${outdir}`);
