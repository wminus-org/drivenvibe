# Security

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use the
repository's **Security → Report a vulnerability** flow so maintainers can
investigate before details are disclosed. Include the affected mode (local,
named tunnel, or cloud relay), reproduction steps, impact, and any suggested
mitigation.

## Connection modes and trust boundaries

- **Cloud relay (coming soon):** the phone and desktop authenticate to the hosted relay. The
  relay forwards live messages and does not persist conversation history or
  project files.
- **Named Cloudflare tunnel:** configure Cloudflare Access. A tunnel without an
  Access policy exposes the local server to the internet.
- **LAN or ZeroTier:** treat every device on that network as trusted. The local
  server does not currently implement its own user login.
- **Quick tunnel:** intentionally disabled unless
  `ALLOW_INSECURE_TUNNEL=1` is set. Do not use it for sensitive work.

API keys and relay credentials belong only in `~/.drivenvibe/settings.json` or
environment variables. Never commit them to this repository. Review agent-made
changes before shipping them, and use a restrictive session permission mode
when fully autonomous tool access is not appropriate.
