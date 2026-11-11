import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS Worker module, no types
import { waitlist } from '../workers/site/index.js';

function fakeDb() {
  const rows = new Map<string, string>();
  return {
    rows,
    prepare: () => ({
      bind: (email: string, at: string) => ({
        run: async () => { if (!rows.has(email)) rows.set(email, at); },
      }),
    }),
  };
}

const post = (body: unknown, origin = 'https://drivenvibe.com') =>
  new Request('https://drivenvibe.com/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });

describe('waitlist worker', () => {
  it('stores a valid email once, normalized', async () => {
    const DB = fakeDb();
    expect((await waitlist(post({ email: ' Ana@Example.com ' }), { DB })).status).toBe(200);
    expect((await waitlist(post({ email: 'ana@example.com' }), { DB })).status).toBe(200);
    expect([...DB.rows.keys()]).toEqual(['ana@example.com']);
  });

  it('rejects bad input, other origins, and stores nothing for the honeypot', async () => {
    const DB = fakeDb();
    expect((await waitlist(post({ email: 'nope' }), { DB })).status).toBe(400);
    expect((await waitlist(post({ email: 'a@b.co' }, 'https://evil.example'), { DB })).status).toBe(403);
    expect((await waitlist(post({ email: 'a@b.co' }, ''), { DB })).status).toBe(403);
    expect((await waitlist(post({ email: 'bot@b.co', company: 'x' }), { DB })).status).toBe(200);
    expect(DB.rows.size).toBe(0);
  });
});
