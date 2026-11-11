/**
 * Maps known Claude/Codex runtime failures to one short sentence the phone can
 * speak, naming the fix on the laptop. Unknown errors return undefined so the
 * caller keeps its generic (redacted) message.
 *
 * Shapes come from @anthropic-ai/claude-agent-sdk 0.3.311 (sdk.d.ts
 * SDKAssistantMessageError / SDKResultError, probed against an empty config
 * dir): "Not logged in · Please run /login", "Invalid API key · Fix external
 * API key" (401), thrown as "Claude Code returned an error result: <text>"
 * or, via session-manager, "Claude runtime error (<code>): <text>".
 * Order matters: the first match wins.
 */
const RULES: Array<[RegExp, string]> = [
  [/uses anthropic-api but no anthropic_api_key/i,
    'This session uses an Anthropic API key, but no Anthropic API key is saved. Add it in Settings, then try again.'],
  [/uses openrouter but no openrouter_api_key/i,
    'This session uses OpenRouter, but no OpenRouter key is saved. Add it in Settings, then try again.'],
  [/not logged in|login expired|oauth token (?:has )?expired|run \/login|oauth_org_not_allowed/i,
    'Claude is not logged in on your computer. Run claude login there, then try again.'],
  [/invalid api key|invalid x-api-key|\b401\b/i,
    'Your Anthropic API key was rejected. Check the key in Settings or on your computer, then try again.'],
  [/authentication_failed|cloud_credential_error/i,
    'Claude is not logged in on your computer. Run claude login there, then try again.'],
  [/codex runtime is unavailable|spawn codex ENOENT/i,
    'Codex is not installed on your computer. Install the Codex CLI and run codex login there, then try again.'],
  [/codex runtime failed/i,
    'Codex failed on your computer. Run codex login status there, then try again.'],
  [/billing_error|credit balance/i,
    'Your Claude account has a billing problem. Check your plan or credits, then try again.'],
  [/rate_limit|rate limit|usage limit|\b429\b/i,
    'Claude hit a rate or usage limit. Wait a few minutes, then try again.'],
  [/overloaded|\b529\b/i,
    'Claude is overloaded right now. Try again in a minute.'],
  [/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|network/i,
    'Your computer could not reach the AI service. Check its internet connection, then try again.'],
];

export function friendlyRuntimeError(e: unknown): string | undefined {
  if (e === undefined || e === null) return undefined;
  const text = e instanceof Error
    ? `${e.message} ${(e as NodeJS.ErrnoException).code ?? ''}`
    : String(e);
  for (const [pattern, sentence] of RULES) {
    if (pattern.test(text)) return sentence;
  }
  return undefined;
}
