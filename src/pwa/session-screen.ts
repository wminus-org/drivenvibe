import type { SessionPublic } from '../../shared/protocol.js';
import { renderHeader } from './header.js';

export type SessionState = 'idle' | 'listening' | 'paused' | 'queued' | 'processing' | 'playing';

export interface SessionScreenHandle {
  setState: (st: SessionState) => void;
  setTranscript: (text: string) => void;
  setResponse: (text: string) => void;
  setHasResponse: (has: boolean) => void;
  setConnected: (connected: boolean) => void;
  openComposer: () => void;
  closeComposer: () => boolean;
}

const MIC_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>';
const SPIN_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>';
const STOP_SVG =
  '<svg viewBox="0 0 24 24" fill="#fff" stroke="none"><rect x="6" y="6" width="12" height="12" rx="3"/></svg>';
const SEND_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
const REPLAY_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
const CLEAR_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
const TYPE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>';

export function renderSessionScreen(
  root: HTMLElement,
  session: SessionPublic,
  handlers: {
    onRec: () => void;     // contextual: START / PAUSE / RESUME / STOP-TTS
    onSend: () => void;    // explicit send (always available when text)
    onReplay: () => void;
    onClear: () => void;
    onTextSend: (text: string) => void;
    onBack: () => void;
    onSettings: () => void;
  },
): SessionScreenHandle {
  root.innerHTML = '';

  root.appendChild(renderHeader({
    title: (session.emoji ? session.emoji + ' ' : '') + session.label,
    onBack: handlers.onBack,
    onGear: handlers.onSettings,
  }).el);

  const screen = document.createElement('div');
  screen.className = 'dnv-session';

  // ── Transcript ────────────────────────────────────────────────────────────
  const transcript = document.createElement('div');
  transcript.className = 'dnv-transcript';
  transcript.setAttribute('role', 'log');
  transcript.setAttribute('aria-label', 'Conversation');
  transcript.setAttribute('aria-live', 'off');

  // Empty state
  const empty = document.createElement('div');
  empty.className = 'dnv-empty';
  empty.innerHTML =
    '<div class="dnv-empty-icon">' + MIC_SVG.replace('stroke="#fff"', 'stroke="currentColor"') + '</div>' +
    '<div class="dnv-empty-text">Tap the mic and describe what you want to build.</div>' +
    '<div class="dnv-empty-subtext">While listening, tap anywhere to send. You can also type.</div>';

  // YOU bubble
  const youWrap = document.createElement('div');
  youWrap.className = 'dnv-you-wrap';
  const youLabel = document.createElement('div');
  youLabel.className = 'dnv-bubble-label';
  youLabel.textContent = 'YOU';
  const youBubble = document.createElement('div');
  youBubble.className = 'dnv-you';
  const youText = document.createElement('span');
  const youCaret = document.createElement('span');
  youCaret.className = 'dnv-caret';
  youCaret.textContent = '▋';
  youBubble.append(youText, youCaret);
  youWrap.append(youLabel, youBubble);

  // CLAUDE bubble
  const claudeWrap = document.createElement('div');
  claudeWrap.className = 'dnv-claude-wrap';
  const claudeLabel = document.createElement('div');
  claudeLabel.className = 'dnv-bubble-label';
  const claudeLabelText = document.createElement('span');
  claudeLabelText.textContent = 'CLAUDE';
  const wave = document.createElement('span');
  wave.className = 'dnv-wave';
  wave.innerHTML = '<span></span><span></span><span></span>';
  claudeLabel.append(claudeLabelText, wave);
  const thinking = document.createElement('div');
  thinking.className = 'dnv-thinking';
  thinking.innerHTML = '<span></span><span></span><span></span>';
  const claudeBubble = document.createElement('div');
  claudeBubble.className = 'dnv-claude';
  claudeWrap.append(claudeLabel, thinking, claudeBubble);

  transcript.append(empty, youWrap, claudeWrap);
  screen.appendChild(transcript);

  // Typed fallback keeps the app usable in noisy environments and browsers
  // without Web Speech support. It stays collapsed during the voice-first flow.
  const composer = document.createElement('div');
  composer.className = 'dnv-composer';
  composer.hidden = true;
  composer.setAttribute('role', 'region');
  composer.setAttribute('aria-label', 'Type a message');
  const textarea = document.createElement('textarea');
  textarea.className = 'dnv-composer-input';
  textarea.rows = 3;
  textarea.maxLength = 12000;
  textarea.placeholder = 'Describe what you want Claude to build…';
  textarea.setAttribute('aria-label', 'Message');
  const composerHint = document.createElement('div');
  composerHint.className = 'dnv-composer-hint';
  composerHint.textContent = 'Ctrl/⌘ + Enter to send';
  const composerActions = document.createElement('div');
  composerActions.className = 'dnv-composer-actions';
  const composerCancel = document.createElement('button');
  composerCancel.type = 'button';
  composerCancel.className = 'dnv-composer-cancel';
  composerCancel.textContent = 'Cancel';
  const composerSend = document.createElement('button');
  composerSend.type = 'button';
  composerSend.className = 'dnv-composer-send';
  composerSend.textContent = 'Send message';
  composerSend.disabled = true;
  composerActions.append(composerCancel, composerSend);
  composer.append(textarea, composerHint, composerActions);
  screen.appendChild(composer);

  // ── Dock ──────────────────────────────────────────────────────────────────
  const dock = document.createElement('div');
  dock.className = 'dnv-dock';

  const status = document.createElement('div');
  status.className = 'dnv-status';
  status.id = `session-status-${session.id}`;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');

  const micWrap = document.createElement('div');
  micWrap.className = 'dnv-mic-wrap';
  const ringA = document.createElement('span');
  ringA.className = 'dnv-mic-ring';
  const ringB = document.createElement('span');
  ringB.className = 'dnv-mic-ring b';
  const mic = document.createElement('button');
  mic.className = 'dnv-mic';
  mic.setAttribute('aria-label', 'Record');
  mic.setAttribute('aria-keyshortcuts', 'Space');
  mic.setAttribute('aria-describedby', status.id);
  mic.addEventListener('click', () => handlers.onRec());
  micWrap.append(ringA, ringB, mic);

  const pills = document.createElement('div');
  pills.className = 'dnv-pills';
  const send = makePill('send', SEND_SVG, 'Send', handlers.onSend);
  const replay = makePill('replay', REPLAY_SVG, 'Replay', handlers.onReplay);
  const clear = makePill('clear', CLEAR_SVG, 'Clear', handlers.onClear);
  const type = makePill('type', TYPE_SVG, 'Type', () => openComposer());
  send.el.setAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
  replay.el.setAttribute('aria-keyshortcuts', 'R');
  type.el.setAttribute('aria-keyshortcuts', 'T');
  pills.append(send.el, replay.el, clear.el, type.el);

  const shortcutHint = document.createElement('div');
  shortcutHint.className = 'dnv-shortcut-hint';
  shortcutHint.textContent = 'Space: talk · T: type · R: replay · Esc: back';

  dock.append(status, micWrap, pills, shortcutHint);
  screen.appendChild(dock);
  root.appendChild(screen);

  // ── State ──────────────────────────────────────────────────────────────────
  let state: SessionState = 'idle';
  let youStr = '';
  let claudeStr = '';
  let hasResponse = false;
  let connected = true;

  function closeComposer(): boolean {
    if (composer.hidden) return false;
    composer.hidden = true;
    type.setPressed(false);
    mic.focus();
    return true;
  }

  function openComposer() {
    if (state === 'listening' || state === 'processing' || state === 'queued' || state === 'playing') return;
    composer.hidden = false;
    type.setPressed(true);
    requestAnimationFrame(() => textarea.focus());
  }

  function submitTypedMessage() {
    const text = textarea.value.trim();
    if (!text) return;
    handlers.onTextSend(text);
    textarea.value = '';
    composerSend.disabled = true;
    closeComposer();
  }

  textarea.addEventListener('input', () => {
    composerSend.disabled = textarea.value.trim().length === 0;
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeComposer();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submitTypedMessage();
    }
  });
  composerCancel.addEventListener('click', closeComposer);
  composerSend.addEventListener('click', submitTypedMessage);

  function render() {
    const isIdle = state === 'idle';
    const isListening = state === 'listening';
    const isPaused = state === 'paused';
    const isQueued = state === 'queued';
    const isProcessing = state === 'processing';
    const isPlaying = state === 'playing';

    // mic appearance
    mic.classList.remove('idle', 'listening', 'paused', 'queued', 'processing', 'playing');
    mic.classList.add(state);
    mic.innerHTML = isProcessing ? SPIN_SVG : (isListening || isQueued || isPlaying) ? STOP_SVG : MIC_SVG;
    const micLabel =
      isListening ? 'Pause recording' :
      isPaused ? 'Resume recording' :
      isQueued ? 'Cancel queued message' :
      isProcessing ? 'Cancel request' :
      isPlaying ? 'Stop speaking' : 'Start recording';
    mic.setAttribute('aria-label', micLabel);
    mic.title = micLabel;
    mic.setAttribute('aria-pressed', String(isListening));
    transcript.setAttribute('aria-busy', String(isProcessing || isQueued));
    const showRings = isListening;
    ringA.style.display = showRings ? 'block' : 'none';
    ringB.style.display = showRings ? 'block' : 'none';

    // status label
    status.textContent =
      isListening ? 'Listening — tap anywhere to send' :
      isPaused ? 'Paused — tap mic to resume' :
      isQueued ? 'Offline — message queued. Tap stop to cancel.' :
      isProcessing ? 'Thinking…' :
      isPlaying ? 'Speaking…' :
      !connected ? 'Offline — you can draft while reconnecting' :
      (youStr || claudeStr) ? 'Tap to talk again' : 'Tap the mic to talk';

    // empty state vs bubbles
    const showEmpty = isIdle && !youStr && !claudeStr;
    empty.style.display = showEmpty ? 'flex' : 'none';

    const showYou = !!youStr || isListening;
    youWrap.style.display = showYou ? 'block' : 'none';
    youText.textContent = youStr;
    youCaret.style.display = isListening ? 'inline' : 'none';

    const showClaude = isProcessing || isPlaying || !!claudeStr;
    claudeWrap.style.display = showClaude ? 'block' : 'none';
    wave.style.display = isPlaying ? 'inline-flex' : 'none';
    const showThinking = isProcessing && !claudeStr;
    thinking.style.display = showThinking ? 'inline-flex' : 'none';
    claudeBubble.style.display = claudeStr ? 'block' : 'none';
    claudeBubble.textContent = claudeStr;

    // auto-scroll to newest content
    transcript.scrollTop = transcript.scrollHeight;

    // pills
    const sendOn = isListening || ((isIdle || isPaused) && !!youStr);
    const replayOn = hasResponse && !isProcessing && !isQueued && connected;
    const clearOn = (!!youStr || !!claudeStr) && !isListening && !isProcessing && !isQueued;
    const typeOn = isIdle || isPaused;
    send.setOn(sendOn);
    replay.setOn(replayOn);
    clear.setOn(clearOn);
    type.setOn(typeOn);
    if (!typeOn) closeComposer();
  }

  render();

  return {
    setState(st) { state = st; render(); },
    setTranscript(text) { youStr = text; render(); },
    setResponse(text) { claudeStr = text; render(); },
    setHasResponse(has) { hasResponse = has; render(); },
    setConnected(value) { connected = value; render(); },
    openComposer,
    closeComposer,
  };
}

function makePill(kind: 'send' | 'replay' | 'clear' | 'type', svg: string, label: string, onClick: () => void) {
  const el = document.createElement('button');
  el.className = 'dnv-pill ' + kind;
  el.innerHTML = svg;
  el.appendChild(document.createTextNode(label));
  el.setAttribute('aria-label', label);
  let on = false;
  el.addEventListener('click', () => { if (on) onClick(); });
  return {
    el,
    setOn(v: boolean) { on = v; el.classList.toggle('on', v); el.disabled = !v; },
    setPressed(v: boolean) { el.classList.toggle('pressed', v); el.setAttribute('aria-pressed', String(v)); },
  };
}
