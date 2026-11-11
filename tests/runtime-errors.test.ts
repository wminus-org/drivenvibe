import { describe, expect, it } from 'vitest';
import { friendlyRuntimeError } from '../src/server/runtime-errors.js';

describe('friendlyRuntimeError', () => {
  const cases: Array<[string, unknown, RegExp]> = [
    // Real SDK 0.3.311 throw after an is_error result (probed with an empty config dir).
    ['SDK not-logged-in throw', new Error('Claude Code returned an error result: Not logged in · Please run /login'), /Claude is not logged in on your computer\. Run claude login there/],
    ['expired login', new Error('Login expired · Please run /login'), /not logged in/i],
    ['bad API key (probed, 401)', new Error('Claude Code returned an error result: Invalid API key · Fix external API key'), /API key was rejected/],
    ['bare 401', new Error('API Error: 401 {"type":"error"}'), /API key was rejected/],
    ['missing key from providerEnv', new Error("Session 's1' uses anthropic-api but no anthropic_api_key in settings"), /no Anthropic API key is saved/i],
    ['missing openrouter key', new Error("Session 's1' uses openrouter but no openrouter_api_key in settings"), /OpenRouter/],
    ['codex ENOENT (adapter)', new Error('Codex runtime is unavailable on this laptop'), /Codex is not installed/],
    ['codex ENOENT (raw)', Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }), /Codex is not installed/],
    ['codex nonzero exit', new Error('Codex runtime failed'), /codex login status/],
    ['rate limit', new Error('Claude runtime error (rate_limit): API Error: 429'), /limit/],
    ['network', Object.assign(new Error('getaddrinfo ENOTFOUND api.anthropic.com'), { code: 'ENOTFOUND' }), /internet/],
  ];

  for (const [name, input, expected] of cases) {
    it(`maps ${name}`, () => {
      expect(friendlyRuntimeError(input)).toMatch(expected);
    });
  }

  it('returns undefined for unknown errors so the caller keeps its generic text', () => {
    expect(friendlyRuntimeError(new Error('Unknown session: x'))).toBeUndefined();
    expect(friendlyRuntimeError(undefined)).toBeUndefined();
  });

  it('produces short speakable sentences without slashes or symbols', () => {
    for (const [, input] of cases) {
      const out = friendlyRuntimeError(input)!;
      expect(out.length).toBeLessThan(160);
      expect(out).not.toMatch(/[\/·`]/);
    }
  });
});
