# Release checklist: green path (issue #46)

Run before every npm release. A box is checked only when it passed on a real phone.
Pass means: a stranger gets from `npx drivenvibe` to hearing Claude answer
without reading troubleshooting, and every failure is visible on the phone and spoken.

**Before anything else, on every desktop:** run `npx drivenvibe doctor` and fix every ✗.
Paste its output into the release notes or PR.

Use the packed tarball, not the repo: `npm pack`, then `npx ./drivenvibe-<version>.tgz`
in an empty project folder. Use a fresh user account (or `HOME`/`USERPROFILE`
pointing at an empty folder) so no old `~/.drivenvibe` exists.

## 1. Green path on a fresh Windows machine

- [ ] Node 20+ installed and `claude auth login` done (no `ANTHROPIC_API_KEY` in the environment).
- [ ] `npx drivenvibe doctor` shows no ✗ (missing config is the only expected ✗ before the first run).
- [ ] `npx drivenvibe` in the project folder prints "First run: created ...config.json", one "Open on your phone" URL, a QR code and the 3 next steps.
- [ ] The URL is the Wi-Fi/LAN (or ZeroTier) address, not a `vEthernet`/WSL/169.254 address.
- [ ] Windows Firewall prompt appears on first start: click **Allow** (private networks).
- [ ] Phone (Android Chrome) scans the QR code and opens the URL.
- [ ] Accept the certificate warning once (Advanced > Proceed).
- [ ] Pick the "Coding" session, tap the mic, allow microphone, say "What files are in this folder?".
- [ ] Claude's answer is spoken aloud within 30 s.
- [ ] `npx drivenvibe | more` (piped) prints no QR code; `NO_QR=1 npx drivenvibe` prints none either.

## 2. Green path on a fresh macOS machine

- [ ] Same steps as section 1, with an iPhone (Safari).
- [ ] Doctor shows `! Claude login` "could not verify" (Keychain) and no ✗.
- [ ] macOS "accept incoming connections" prompt for node: **Allow**.
- [ ] Spoken answer received.

## 3. Network switch mid-turn

- [ ] Ask a question that takes >20 s ("Read every file and summarise the project").
- [ ] While it runs, switch the phone from Wi-Fi to mobile data and back (or toggle airplane mode 5 s).
- [ ] The phone shows that it is reconnecting, reconnects without a page reload and either receives the answer or plays the last response (Replay).
- [ ] No duplicate answer is spoken.

## 4. Phone sleeps 5 minutes

- [ ] With a session open, lock the phone for 5 minutes.
- [ ] Unlock: the app reconnects by itself; the next mic tap works without reloading.
- [ ] Ask a question during the lock (from another tab or before locking a long turn): the answer is available after unlock.

## 5. Desktop restart mid-turn

- [ ] Start a long turn, then press Ctrl+C on the desktop and run `npx drivenvibe` again.
- [ ] The phone shows the turn failed or was interrupted (visible and spoken), not an endless spinner.
- [ ] After the desktop is back, the phone reconnects and the next question works and resumes the same Claude session.
- [ ] Starting a second `npx drivenvibe` while one runs prints "Port 8787 is busy..." (one line, no stack trace).

## 6. Runtime not logged in

- [ ] Log Claude out (`claude auth logout`, or point `CLAUDE_CONFIG_DIR` at an empty folder), restart drivenvibe.
- [ ] `npx drivenvibe doctor` shows `✗ Claude is not logged in` with the `claude auth login` fix.
- [ ] Ask a question: the phone shows and speaks "Claude is not logged in on your computer. Run claude login there, then try again."; it does NOT speak "Not logged in · Please run /login" as if it were an answer.
- [ ] Set the session to `anthropic-api` with no key saved: the phone says that no Anthropic API key is saved.
- [ ] Save an invalid API key: the phone says the API key was rejected.
- [ ] A codex session on a machine without Codex: the phone says Codex is not installed.

## 7. Every failure is visible and spoken

For each failure above, and also for: wrong project folder (delete it), desktop offline, Wi-Fi off on the desktop:

- [ ] An error is shown on screen.
- [ ] The same error is read aloud (no silent stop, no spinner that never ends).
- [ ] The message says what to do on the computer.
- [ ] No API key, token or stack trace appears on the phone.

## 8. Startup failures on the desktop

- [ ] Node 18: `npx drivenvibe` prints "drivenvibe needs Node.js 20 or newer" (no stack trace).
- [ ] Broken `config.json` (delete a brace): one clear error naming the file + the doctor hint.
- [ ] `TUNNEL=named` without cloudflared: one line with the install command.
- [ ] `DEBUG=1` with any startup failure prints the full stack.
