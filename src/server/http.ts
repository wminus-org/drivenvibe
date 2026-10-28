import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPublic, Config } from './config.js';
import type { TlsPair } from './cert.js';
import type { Settings } from './settings.js';

/** `<package>/dist/pwa`: src/server/http.ts and the bundled dist/server/index.js sit at the same depth. */
export function pwaDirFor(moduleUrl: string): string {
  return path.resolve(fileURLToPath(moduleUrl), '../../../dist/pwa');
}

export async function createHttp(cfg: Config, settings: Settings, tls?: TlsPair) {
  const opts: any = { logger: false };
  if (tls) opts.https = { key: tls.key, cert: tls.cert };
  const app = Fastify(opts);

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
    return payload;
  });

  app.get('/api/config', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return toPublic(cfg);
  });
  app.get('/api/settings', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return settings.publicSafe();
  });

  const pwaDir = pwaDirFor(import.meta.url);
  try {
    await app.register(fastifyStatic, { root: pwaDir });
  } catch {
    app.get('/', async (_req: any, reply: any) => {
      reply.type('text/html');
      return '<h1>drivenvibe</h1><p>Build the PWA: <code>npm run build</code></p>';
    });
  }

  return app;
}
