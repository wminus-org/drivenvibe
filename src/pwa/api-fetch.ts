/**
 * Thin wrapper around fetch() that adds `Authorization: Bearer <token>` when
 * running in cloud mode. Local/self-host mode never configures a token
 * provider, so apiFetch degenerates to a plain fetch() call — zero behavior
 * change there.
 */
export type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;

/** Cloud boot calls this once with cloud.getToken; local boot never calls it. */
export function configureApiFetch(provider: TokenProvider | null): void {
  tokenProvider = provider;
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!tokenProvider) return fetch(input, init);
  const token = await tokenProvider();
  if (!token) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
