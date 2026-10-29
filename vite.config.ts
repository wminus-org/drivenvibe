import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Keep one manifest source of truth. The file is also easy to inspect and
// validate without executing the Vite config.
const pwaManifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/pwa/manifest.webmanifest'), 'utf8'),
);

// String planted by src/pwa/demo/install.ts. A non-demo build containing it means
// demo fakes (fetch/WebSocket/speech mocks) leaked into the npm package.
const DEMO_MARKER = 'DNV_DEMO_BUILD';

export default defineConfig(({ mode }) => {
const demo = mode === 'demo';
const outDir = resolve(process.cwd(), demo ? 'site/demo/app' : 'dist/pwa');
return {
  root: 'src/pwa',
  // The live demo is served by the landing site at /demo/app/ (see build-site.mjs).
  base: demo ? '/demo/app/' : '/',
  build: {
    outDir,
    emptyOutDir: true,
  },
  // Demo: never cloud mode, whatever .env says.
  define: demo ? { 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': 'undefined' } : {},
  server: {
    port: 5173,
    // NOTE: a bare string proxy key is a PREFIX match, so '/ws' also matched
    // '/ws-client.ts' and forwarded that module request to the backend (404),
    // which broke the whole module graph → black screen. Keys starting with '^'
    // are treated as a RegExp, so we anchor both rules to exact route shapes.
    proxy: {
      '^/api/': 'http://localhost:8787',
      '^/ws$': { target: 'ws://localhost:8787', ws: true },
    },
  },
  plugins: [
    // Demo: same app, but boot through demo/entry.ts (installs the fakes first),
    // and drop third-party font links so the demo makes no cross-origin requests.
    demo && {
      name: 'demo-entry',
      transformIndexHtml: {
        order: 'pre' as const,
        handler: (html: string) => html
          .replace('src="/main.ts"', 'src="/demo/entry.ts"')
          .replace(/\s*<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g, '')
          .replace('</title>', '</title>\n  <meta name="robots" content="noindex" />'),
      },
    },
    // No service worker for the demo: it would claim /demo/app/ on drivenvibe.com.
    !demo && VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      // Cloud builds must pass every navigation through Clerk/Access. Local
      // builds can safely cache the shell so the app opens immediately and
      // renders a useful offline state while the desktop reconnects.
      workbox: mode === 'cloud'
        ? { globPatterns: [], navigateFallback: null }
        : {
            globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
            // Clerk is cloud-only and reached through a dynamic import, so the local
            // build never loads this chunk — but the glob above would still precache
            // it. It is ~1.5 MB (clerk-js bundles Web3/Solana wallet adapters), which
            // is 25x the app's own code, so self-hosters would download all of it for
            // nothing. Guarded by a build assertion in the plugin below.
            globIgnores: ['**/clerk-*.js'],
            navigateFallback: '/index.html',
            cleanupOutdatedCaches: true,
          },
      manifest: pwaManifest,
    }),
    {
      // Cloudflare Access requires the manifest to be fetched WITH credentials,
      // otherwise it is 302'd to the login page and fails CORS. The browser
      // omits cookies for the manifest unless the link is crossorigin=use-credentials.
      // vite-plugin-pwa injects the manifest link late, so we rewrite the emitted
      // index.html on disk after the bundle is written.
      name: 'manifest-use-credentials',
      closeBundle() {
        if (demo) return;
        const file = resolve(outDir, 'index.html');
        if (!existsSync(file)) return;
        const html = readFileSync(file, 'utf8');
        if (html.includes('rel="manifest"') && !/rel="manifest"[^>]*crossorigin/.test(html)) {
          writeFileSync(
            file,
            html.replace(/<link rel="manifest"([^>]*)>/, '<link rel="manifest"$1 crossorigin="use-credentials">'),
          );
        }

        // The globIgnores above matches Clerk by chunk FILENAME. If Vite ever renames
        // that chunk, the ignore silently stops matching and 1.5 MB of Web3 wallet code
        // creeps back into every self-hoster's precache. Fail the build instead.
        const sw = resolve(outDir, 'sw.js');
        if (mode !== 'cloud' && existsSync(sw) && /clerk/i.test(readFileSync(sw, 'utf8'))) {
          throw new Error(
            'Clerk chunk leaked into the service-worker precache. The workbox globIgnores '
            + "pattern ('**/clerk-*.js') no longer matches the emitted chunk name — update it.",
          );
        }

        const leaked = readdirSync(outDir, { recursive: true, withFileTypes: true })
          .filter((f) => f.isFile() && /\.(js|html|css)$/.test(f.name))
          .find((f) => readFileSync(resolve(f.parentPath ?? f.path, f.name), 'utf8').includes(DEMO_MARKER));
        if (leaked) {
          throw new Error(`Demo code leaked into ${outDir} (${leaked.name} contains ${DEMO_MARKER}).`);
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@shared': '/../../shared',
      ...(demo ? { '@clerk/clerk-js': resolve(process.cwd(), 'src/pwa/demo/clerk-stub.ts') } : {}),
    },
  },
};
});
