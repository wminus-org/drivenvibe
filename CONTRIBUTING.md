# Contributing to drivenvibe

Thanks for considering a contribution. This is a small, opinionated project — read this whole file before opening a PR.

## What I'll accept

- **Bug fixes** with a clear reproduction.
- **UX improvements** that make the driving experience safer or smoother (less reading, fewer taps, better audio cues).
- **Provider plumbing** — adding support for Anthropic direct API or OpenRouter alongside the current `claude login` subscription path.
- **Install-friction reductions** — anything that shortens the first-run setup.
- **Cross-platform fixes** — e.g. macOS or Linux path issues, iOS Safari quirks.
- **Docs**, especially screenshots and short demo clips.

## What I probably won't accept

- Native rewrites of the PWA (it's vanilla TS on purpose; pull requests adding React/Vue/etc. need a strong case).
- New required cloud dependencies (the project is local-first by design).
- Features that don't have a "while driving" use case.

## Setup

```sh
npm install
npm run dev       # server + Vite with hot reload
npm test          # vitest
```

A minimal `~/.drivenvibe/config.json` and a logged-in `claude` CLI are enough to bring it up locally.

## Code style

- TypeScript strict everywhere.
- Vanilla DOM in the PWA — no UI framework.
- Keep files focused; if a file grows past ~250 lines, consider splitting.
- One concern per WebSocket message type.
- Tests for non-trivial logic (config parsing, WS dispatch, etc.). UI and STT are validated manually.

## Commit & PR style

- Commit subject < 70 chars, imperative ("Add X", not "Added X").
- Body explains *why* if the diff doesn't make it obvious.
- One change per PR. If you're touching server + PWA + docs for one feature, that's still one PR.
- Run `npm test` and `npx tsc --noEmit` before pushing.

## Security

If you find anything that exposes sessions, leaks secrets, or weakens the local-first guarantee, please email rather than open a public issue.

## License

By submitting a PR you agree your contribution is released under the [GPL-3.0-only license](./LICENSE).
