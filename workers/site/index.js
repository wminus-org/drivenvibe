// drivenvibe.com: static assets (site/) plus one endpoint, the hosted-relay waitlist.
// Assets are matched first; only requests that match no file reach this code.
// Count sign-ups: npx wrangler d1 execute drivenvibe-waitlist --remote --command "SELECT COUNT(*) FROM waitlist"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function waitlist(request, env) {
  // Same-origin only: the form on drivenvibe.com is the one legitimate caller.
  // ponytail: no rate limit; add a Cloudflare rate-limiting rule if spam shows up.
  const origin = request.headers.get('origin');
  if (!origin || new URL(origin).host !== new URL(request.url).host) return json(403, { ok: false });

  let data;
  try {
    data = await request.json();
  } catch {
    return json(400, { ok: false });
  }
  const email = String(data?.email ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return json(400, { ok: false });
  // Honeypot filled in: answer like a success so the bot moves on, store nothing.
  if (data?.company) return json(200, { ok: true });

  // Duplicates are ignored and get the same answer, so the form does not reveal who signed up.
  await env.DB.prepare('INSERT OR IGNORE INTO waitlist (email, created_at) VALUES (?1, ?2)')
    .bind(email, new Date().toISOString())
    .run();
  return json(200, { ok: true });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/waitlist') {
      return request.method === 'POST' ? waitlist(request, env) : json(405, { ok: false });
    }
    return env.ASSETS.fetch(request);
  },
};
