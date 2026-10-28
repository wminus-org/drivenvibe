# Provider options

drivenvibe drives Claude via the Claude Agent SDK. The SDK spawns the `claude` CLI under the hood, which can route through three different providers. You pick one per session (or set a default in Settings).

## Comparison

| Provider | Auth | Notes |
|---|---|---|
| `subscription` | `claude login` (browser, one-time) | Uses your existing Claude Pro or Max subscription. Flat monthly cost. One reliable concurrent session; running many sessions simultaneously may hit rate limits. |
| `anthropic-api` | API key | Pay per token. Reliable concurrency — each session gets its own request budget. Better for heavy multi-session use. |
| `openrouter` | API key | Routes through OpenRouter's Anthropic-compatible endpoint. Lets you specify non-Anthropic models. Tool calls are only verified for Anthropic models (see issue #10); chat works for any model. |

## Setup

### Subscription

Run `claude login` on the machine that hosts the server. This opens a browser window and saves credentials to `~/.claude/`. No further config needed — `subscription` is the default provider.

Do not set `ANTHROPIC_API_KEY` in your environment if you want the CLI to use subscription credentials. The CLI falls back to the login token only when the env var is absent.

### Anthropic API

1. Get an API key from [console.anthropic.com](https://console.anthropic.com/).
2. Open the app on your phone, go to Settings, paste the key into the Anthropic API key field.
3. In the session's Settings tab, set Provider to `anthropic-api`. Optionally set a model (e.g. `claude-sonnet-4-5-20250929`); if left blank, the CLI picks its default.

Alternatively, set `ANTHROPIC_API_KEY` in the environment before running `npm start`.

### OpenRouter

1. Get an API key from [openrouter.ai](https://openrouter.ai/).
2. Open Settings, paste the key into the OpenRouter API key field.
3. In the session's Settings tab, set Provider to `openrouter` and set a model (e.g. `anthropic/claude-3.5-sonnet`). The model field is required for OpenRouter sessions.

## When to pick which

**Subscription** is the right default if you already pay for Claude Pro or Max and don't need more than one or two sessions running concurrently. Zero extra cost, zero extra tokens to track.

**Anthropic API** makes sense if you run several sessions in parallel — the rate limits are higher and predictable, and you pay only for what you use. It's also easier to isolate costs per project if you care about that.

**OpenRouter** is for experimenting with other models. The integration is the same Anthropic-compatible wire protocol, so the UX is identical, but tool calls from the Claude Agent SDK have only been verified against Anthropic models. Use it for chat-heavy sessions where tool use is not critical, or to compare model outputs.
