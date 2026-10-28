import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, configureApiFetch } from '../src/pwa/api-fetch.js';

describe('apiFetch', () => {
  afterEach(() => {
    configureApiFetch(null);
    vi.unstubAllGlobals();
  });

  it('calls fetch unmodified when no token provider is configured (local mode)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/config');

    expect(fetchMock).toHaveBeenCalledWith('/api/config', undefined);
  });

  it('adds an Authorization header when a token provider is configured (cloud mode)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    configureApiFetch(async () => 'tok123');

    await apiFetch('/api/settings');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/settings');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer tok123');
  });
});
