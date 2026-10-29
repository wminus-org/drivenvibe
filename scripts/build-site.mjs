import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = [
  resolve(root, 'site/drivenvibe-stickers.jsx'),
  resolve(root, 'site/drivenvibe-app.jsx'),
];
const output = resolve(root, 'site/drivenvibe.min.js');

const sources = await Promise.all(inputs.map((file) => readFile(file, 'utf8')));

// React is BUNDLED here, not pulled from unpkg. The landing page is the one asset
// that has to render before anything else earns attention, and a CDN React cost two
// extra cross-origin round trips and made the page's uptime depend on a third party.
// The .jsx sources were written against the UMD builds and reference `React` and
// `ReactDOM` as globals, so shim those as real imports rather than rewriting them.
const entry = [
  "import React from 'react';",
  "import * as ReactDOM from 'react-dom/client';",
  ...sources,
].join('\n');

const result = await build({
  stdin: {
    contents: entry,
    resolveDir: resolve(root, 'site'),
    loader: 'jsx',
  },
  bundle: true,
  format: 'iife',
  target: 'es2019',
  minify: true,
  legalComments: 'none',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  // Without this esbuild bundles React's DEVELOPMENT build: dev-only warnings, slower
  // renders, and a `process is not defined` crash in the browser.
  define: { 'process.env.NODE_ENV': '"production"' },
  write: false,
});

const [file] = result.outputFiles;
await writeFile(output, `'use strict';\n${file.text}`, 'utf8');
console.log(`[site] built ${output} (${Buffer.byteLength(file.text)} bytes, React bundled)`);

// Live demo at /demo/: the real PWA built in demo mode (fake server, mic and voice;
// see src/pwa/demo/) into site/demo/app/, plus a small frame page around it.
process.chdir(root); // vite.config.ts resolves paths from the cwd
await viteBuild({ mode: 'demo', logLevel: 'warn' });
await copyFile(resolve(root, 'src/pwa/demo/frame.html'), resolve(root, 'site/demo/index.html'));
await copyFile(resolve(root, 'src/pwa/demo/frame.js'), resolve(root, 'site/demo/frame.js'));
console.log('[site] built site/demo/ (live demo)');
