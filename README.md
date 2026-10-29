# drivenvibe

Voice-first companion for Claude Code and Codex. Talk to your projects, hear answers back, or type when voice is not practical. Your laptop stays the agent runtime while your phone becomes the remote.

## What it does

A phone PWA connects to a server you run on your machine. Choose a project and session, then speak or type. The selected runtime — Claude Code or Codex — runs the task in that project's folder and the phone reads the response aloud.

Speech-to-text and text-to-speech run in the phone browser. The coding runtime runs on your machine, so its login credentials never leave the laptop. You can connect directly on a trusted network, through your own protected tunnel, or (coming soon) through the hosted relay. The hosted relay will forward live traffic but does not store project files or conversation history.

## Requirements

- Node.js 20 or newer.
- At least one local coding runtime, signed in:
  - Claude Code: `claude login`, or an Anthropic API key.
  - Codex: install the Codex CLI and run `codex login`.
- Chrome or Safari on the phone for browser speech recognition.

## Desktop setup

In your project directory, run:

```sh
npx drivenvibe
```

Or install it once with `npm i -g drivenvibe` and run `drivenvibe`. The first run creates `~/.drivenvibe/config.json` with one Claude Code session pointing at the current directory; edit that file to add more projects and sessions (see `config.example.json`). `drivenvibe --help` lists the environment variables (`RELAY_TOKEN`, `PORT`, `HTTP_ONLY`, `TUNNEL`, ...).

### From source

1. `git clone https://github.com/wminus-org/drivenvibe && cd drivenvibe`
2. `npm install`
3. Create `~/.drivenvibe/config.json` from `config.example.json` and point a session at your project directory.
4. Run `npm start`.

API keys can be entered later in the in-app Settings screen and are never sent to the phone.

## Connect your phone

### Hosted relay (coming soon)

The hosted app at app.drivenvibe.com is not live yet. Once it is:

1. Open app.drivenvibe.com on the phone and sign in.
2. Choose **Generate link token**.
3. Put that token in `~/.drivenvibe/settings.json` as `"relay_token"`, or start the desktop with the `RELAY_TOKEN` environment variable.
4. Restart `npx drivenvibe` (or `npm start` from source), then retry on the phone.

The desktop makes the outbound connection, so this mode needs no open inbound port or changing tunnel URL. Treat the link token as a secret.

### Trusted local network

Run `npx drivenvibe` and open one of the printed HTTPS URLs on a phone on the same LAN or ZeroTier network. Accept the self-signed certificate once, then add the PWA to the home screen. Local mode has no user login, so only use it on a network whose devices you trust.

For a stable named tunnel (same URL every time), see [`docs/named-tunnel-setup.md`](./docs/named-tunnel-setup.md).
Install `cloudflared` only if you choose a Cloudflare tunnel:

- Windows: `winget install Cloudflare.cloudflared`
- macOS: `brew install cloudflared`

For a temporary unauthenticated quick tunnel, explicitly opt in with
`ALLOW_INSECURE_TUNNEL=1 TUNNEL=cloudflare npx drivenvibe`. The quick-tunnel URL is
publicly reachable and must not be used for normal or sensitive access. The
recommended remote setup is a named tunnel protected by Cloudflare Access; see
the [Cloudflare Tunnel documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
and [Access application configuration](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/).

## How to use

- Main screen: project tiles. Tap one to see its sessions.
- Resume the most recently used session directly from the main screen.
- In a session, use the microphone or the typed-message fallback. The selected runtime responds and the phone reads the reply aloud.
- + button on the main screen: add a project. + button inside a project: add a session.
- Use a session's visible more-actions button (or long-press) to edit or archive it. Archive offers Undo.
- Settings (gear icon, top-right): API keys, provider choice, theme, haptics. Reachable from the main screen and from any open session.
- Keyboard and headset/media controls are available where the browser supports them.

Audio cues (beeps, chimes) confirm each action so you don't need to look at the screen.

## Providers

Three providers are selectable in the app: **Codex** (your `codex login` credentials), **subscription** (your `claude login` credentials), and **anthropic-api** (an API key). OpenRouter is deferred post-MVP — its server-side support is still in the code but hidden from the UI (see issue #10).

See [`docs/providers.md`](./docs/providers.md) for a comparison and setup instructions for each.

## Architecture

One Node.js process on your machine hosts a Fastify server and WebSocket endpoint, optionally connects outward to the hosted relay or a Cloudflare tunnel, and runs the selected coding runtime per session. Claude sessions use the Claude Agent SDK; Codex sessions use the local Codex CLI. The PWA uses browser-native speech recognition and speech synthesis.

```
Phone PWA ── authenticated WSS ──► hosted relay ◄── outbound WSS ── Desktop
    │                                                               │
    └──────────── trusted LAN HTTPS/WSS (alternative) ──────────────┤
                                                                    └─ Claude Agent SDK / Codex CLI + project files
```

Config lives at `~/.drivenvibe/config.json`. Session state (Claude session UUIDs, last responses) is cached at `~/.drivenvibe/state.json`.

## Dev

```sh
npm run dev    # Vite + server with hot reload → http://localhost:5173
npm test       # vitest
npm run build  # production PWA
npm run build:site # production landing-page bundle
```

`npm run dev` launches both halves (API/WS server on :8787, Vite PWA on :5173 with a proxy) via [`scripts/dev.mjs`](./scripts/dev.mjs). To run them separately: `npm run dev:pwa` and `HTTP_ONLY=1 npm run dev:server`.

Other flags: `HTTP_ONLY=1 npm start` skips TLS (mic only works on localhost in that mode). `PORT=9999 npm start` changes the port.

## Troubleshooting

- **`claude` asks for an API key** — make sure `ANTHROPIC_API_KEY` is not set in your environment if you're using the subscription provider. The CLI falls back to your `claude login` credentials when the env var is absent.
- **Codex session fails** — verify `codex login status` on the laptop. Codex credentials stay on the laptop and are never sent to the phone.
- **"Untrusted certificate" on phone (LAN mode)** — expected with self-signed certs. Accept once. Use a Cloudflare tunnel to avoid this entirely.
- **`ERR_NETWORK_CHANGED` or `ERR_CONNECTION_REFUSED`** — use the LAN/ZeroTier URL, or configure a named tunnel with Cloudflare Access. A quick tunnel requires the explicit opt-in: `ALLOW_INSECURE_TUNNEL=1 TUNNEL=cloudflare npx drivenvibe`.
- **"Speech recognition not supported"** — open in Chrome or Safari. In-app browsers don't expose the Web Speech API.
- **No audio playback on phone** — the first tap on the page unlocks mobile audio. If it's still silent after a tap, use the Replay button.
- **`cloudflared` not found** — it is only required for tunnel mode; install it using the command above or use the hosted relay/LAN mode.

## Safety and security

Keep the phone mounted and use short voice interactions when moving. Review every generated change when stopped before shipping it. Connection-mode trust boundaries and private vulnerability reporting are documented in [`SECURITY.md`](./SECURITY.md).

## Security

`~/.drivenvibe/settings.json` stores API keys in plain text. Keep that file private — never share it, commit it, or back it up to a shared location.

On Unix, the server sets `chmod 0600` on the file after each write (owner-read/write only). This is best-effort: the call is silently swallowed if it fails, and on Windows it is a no-op — Windows inherits your user-account ACLs instead of enforcing explicit mode bits. **Do not run drivenvibe on a multi-user or shared Windows machine** unless you are comfortable with those ACLs.

Cloudflare Access (if you configure it) gates the public tunnel URL — it does not protect the file on disk.

A possible future hardening: move keys into the OS keyring via `keytar`. That is out of scope for the current release.

## Roadmap

- Package the desktop companion for simpler updates and onboarding.
- Add explicit local-device pairing instead of relying on a trusted LAN.
- Verify OpenRouter tool-call compatibility before exposing it in the UI.
- Expand voice options and hands-free session management.

## License

[GPL-3.0-only](./LICENSE)

Icons: [Font Awesome Free](https://fontawesome.com) by Fonticons, Inc. — icons [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), code [MIT](https://opensource.org/licenses/MIT).
