# Changelog

All notable changes to the `drivenvibe` npm package. Versions follow [semver](https://semver.org/).

## 0.2.0

### New
<!-- NEXT-ITEMS -->
- **New app design.** Apple-style UI: system font, large titles, grouped settings, frosted bars and sheets, iMessage-style bubbles, a real light mode next to dark, 44 px tap targets, safe-area aware. Icons are bundled Font Awesome Free (no CDN, no Google Fonts, no external requests).
- **Live demo** at [drivenvibe.com/demo](https://drivenvibe.com/demo/): the real app running against a scripted in-browser mock. No account, no microphone, no server. The demo code is not part of the npm package.

### Changed
- Errors in the reply bubble read "Error: …" instead of a warning emoji. Claude's replies keep their line breaks.
- The hosted relay (app.drivenvibe.com) is marked as coming soon in the CLI and the docs.
- Landing page: one-command setup (`npx drivenvibe`), requirements, and a "Try the live demo" button.

## 0.1.0

- First public release: phone PWA + desktop companion for Claude Code and Codex, browser speech recognition and speech synthesis, projects and sessions, settings, LAN/ZeroTier, Cloudflare tunnels.
