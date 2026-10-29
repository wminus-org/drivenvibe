import { requestWakeLock } from './wake-lock.js';
import { WsClient } from './ws-client.js';
import { Stt } from './stt.js';
import { tones } from './tones.js';
import { renderMainScreen, renderMainSkeleton } from './main-screen.js';
import { renderProjectScreen, type ProjectScreenHandle } from './project-screen.js';
import { renderSessionScreen, type SessionScreenHandle, type SessionState } from './session-screen.js';
import { renderSettingsScreen, type SettingsScreenHandle, type SettingsTab } from './settings-screen.js';
import { settingsStore } from './settings-store.js';
import { createNotificationOverlay } from './notification-overlay.js';
import { createNotificationQueue } from './notification-queue.js';
import { renderAddSessionModal, type AddSessionModalHandle } from './add-session-modal.js';
import { renderAddProjectModal, type AddProjectModalHandle } from './add-project-modal.js';
import { renderSessionActionSheet, type SessionActionSheetHandle } from './session-action-sheet.js';
import { haptic } from './haptics.js';
import { createToastManager, type ToastHandle } from './toast.js';
import { createConnectionStatus } from './connection-status.js';
import { apiFetch, configureApiFetch } from './api-fetch.js';
import { renderConnectScreen } from './connect-screen.js';
import { getMostRecentSession, markSessionOpened } from './recent-sessions.js';
import { installPrompt } from './install-prompt.js';
import './theme.js';
import type { PublicConfig, ProjectPublic, SessionPublic, ServerMessage } from '../../shared/protocol.js';
import type { SttBackend } from '../../shared/protocol.js';

// Cloud mode is a build-time switch: set VITE_CLERK_PUBLISHABLE_KEY (build:cloud)
// to get Clerk login + relay awareness. Unset ⇒ local/self-host build, and none
// of this file's cloud branches ever run.
const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const CLOUD = !!CLERK_KEY;
let cloudSignOut: () => Promise<void> = async () => {};
let cloudRefreshToken: () => Promise<void> = async () => {};
// Set once this page load came back from Polar's success_url (?checkout=success).
let checkoutReturned = false;

// #app = device-scaled column + query container (holds overlays, never cleared).
// #screen = per-view render target, wiped on every navigation.
const app = document.getElementById('app')!;
const root = document.getElementById('screen')!;
const ws = new WsClient();
const stt = new Stt();
let recordingEpoch = 0;

const notificationOverlay = createNotificationOverlay(app);
const toast: ToastHandle = createToastManager(app);
const connStatus = createConnectionStatus(app);
ws.on(handleServer);

let cfg: PublicConfig;
let currentProject: ProjectPublic | null = null;
let currentSession: SessionPublic | null = null;
let screenHandle: SessionScreenHandle | null = null;
let projectScreenHandle: ProjectScreenHandle | null = null;
let state: SessionState = 'idle';
type Screen = 'main' | 'project' | 'session' | 'settings' | 'connect';
let currentScreen: Screen = 'main';
let settingsHandle: SettingsScreenHandle | null = null;
let settingsReturnTo: 'main' | 'project' | 'session' = 'main';
let activeModal: AddSessionModalHandle | AddProjectModalHandle | SessionActionSheetHandle | null = null;
let hasResponse = false;
let connected = false;
let hasEverConnected = false;

interface SessionUiMemory {
  transcript: string;
  response: string;
  hasResponse: boolean;
}
const sessionUiMemory = new Map<string, SessionUiMemory>();

ws.onStatus((status) => {
  const wasConnected = connected;
  connected = status === 'open';
  connStatus.set(status);
  screenHandle?.setConnected(connected);

  if (connected) {
    if (state === 'queued') setState('processing');
    if (hasEverConnected && !wasConnected) toast.show('Back online', 'success');
    hasEverConnected = true;
  }
});

installPrompt.subscribe(() => {
  if (currentScreen === 'main' && cfg && !activeModal) showMain();
});
function withTransition(render: () => void) {
  root.classList.remove('screen-fade-in');
  void root.offsetWidth;
  render();
  root.classList.add('screen-fade-in');
}

/** Text committed from previous STT segments (across pause/resume). */
let accumulatedText = '';
/** Streaming response text from Claude (across cc_chunk messages). */
let responseText = '';

// ─────────────────────────────────────────────────────────────────
// Server-STT (MediaRecorder) state
// ─────────────────────────────────────────────────────────────────
let mediaRecorder: MediaRecorder | null = null;
let mediaChunks: Blob[] = [];
let mediaStream: MediaStream | null = null;

/** Tear down an in-progress server-STT recording and release the mic, sending nothing. */
function discardServerRecording(): void {
  if (!mediaRecorder) return;
  const recorder = mediaRecorder;
  mediaRecorder = null;
  recorder.onstop = null;
  recorder.ondataavailable = null;
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  mediaChunks = [];
  try { recorder.stop(); } catch { /* already stopped */ }
}

function rememberCurrentSession(): void {
  if (!currentSession) return;
  sessionUiMemory.set(currentSession.id, {
    transcript: accumulatedText,
    response: responseText,
    hasResponse,
  });
}

/** Stop recognition before replacing the session UI and ignore late callbacks. */
function stopListeningForNavigation(): void {
  // Invalidate callbacks before stop(): SpeechRecognition.onend is async and
  // may otherwise write into a newly-rendered view of the same session.
  recordingEpoch += 1;
  if (state === 'listening') {
    if (currentSttBackend() === 'server') {
      discardServerRecording();
    } else {
      accumulatedText = mergeText(accumulatedText, stt.stop());
      screenHandle?.setTranscript(accumulatedText);
    }
  }
  cancelSpeak();
  if (state === 'listening' || state === 'paused' || state === 'playing') setState('idle');
  rememberCurrentSession();
}

const notificationQueue = createNotificationQueue({
  canShowNow: () => state !== 'listening' && state !== 'playing' && activeModal === null,
  showOverlay(p, onAccept, onDismiss) {
    haptic([200, 100, 200]);
    speak(`${p.label} is ready`);
    notificationOverlay.show(p, { onAccept, onDismiss });
  },
  onAccept(p) {
    notificationQueue.remove(p.session_id);
    const project = cfg?.projects.find((pr) => pr.sessions.some((s) => s.id === p.session_id));
    const session = project?.sessions.find((s) => s.id === p.session_id);
    if (!project || !session) return;
    if (currentScreen === 'session') ws.send({ type: 'close_session' });
    showProject(project);
    enterSession(session);
    ws.send({ type: 'replay' });
  },
  onDismiss(_p) {
    // queue advances automatically; no navigation needed
  },
});

function setState(s: SessionState) {
  state = s;
  screenHandle?.setState(s);
  document.body.classList.toggle('listening-cue', s === 'listening');
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = s === 'listening' || s === 'playing' ? 'playing' : s === 'paused' ? 'paused' : 'none';
  }
  if (s !== 'listening' && s !== 'playing') {
    notificationQueue.drain();
  }
}

function mergeText(a: string, b: string): string {
  const A = a.trim();
  const B = b.trim();
  if (!A) return B;
  if (!B) return A;
  return (A + ' ' + B).replace(/\s+/g, ' ');
}

/** Speak via device synthesizer. Cancels anything currently playing. */
function speak(text: string, opts?: { onEnd?: () => void }) {
  if (!('speechSynthesis' in window)) {
    opts?.onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = currentSession?.tts_rate ?? 1.2;
  u.pitch = 1;
  u.volume = 1;
  u.onend = () => opts?.onEnd?.();
  u.onerror = () => opts?.onEnd?.();
  window.speechSynthesis.speak(u);
}

function cancelSpeak() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function showBootError(msg: string) {
  document.title = 'Connection problem · drivenvibe';
  root.innerHTML = '';
  root.setAttribute('aria-busy', 'false');
  const wrap = document.createElement('div');
  wrap.className = 'boot-error';
  wrap.setAttribute('role', 'alert');
  const copy = document.createElement('p');
  copy.textContent = msg;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => {
    retry.disabled = true;
    void boot();
  });
  wrap.append(copy, retry);
  root.appendChild(wrap);
}

/** Cloud-mode-only: Clerk sign-in gate. No-op (never called) in local mode. */
async function ensureCloudAuth(): Promise<void> {
  const cloud = await import('./cloud.js');
  await cloud.initCloud(CLERK_KEY!, root);
  configureApiFetch(cloud.getToken);
  ws.tokenProvider = cloud.getToken;
  cloudSignOut = cloud.signOut;
  cloudRefreshToken = cloud.refreshToken;
  const { takeCheckoutSuccess } = await import('./upgrade-screen.js');
  const cleaned = takeCheckoutSuccess(location.href);
  if (cleaned !== null) {
    checkoutReturned = true;
    history.replaceState(history.state, '', cleaned);
    // The webhook may already have set plan=pro; get a token that says so.
    await cloud.refreshToken().catch(() => {});
  }
}

// boot() re-runs on retry / on desktop reconnect; guard the one-time setup
// steps (ws socket, tap-anywhere listener) so re-entry doesn't double them up.
let wsConnected = false;
async function connectWsOnce(): Promise<void> {
  if (wsConnected) return;
  wsConnected = true;
  try {
    await ws.connect();
  } catch {
    // WsClient schedules reconnects itself. The config screens remain useful
    // while offline and queued actions clearly show their waiting state.
    connStatus.set('closed');
  }
}

function showConnectScreen() {
  stopListeningForNavigation();
  closeActiveModal();
  currentScreen = 'connect';
  renderConnectScreen(root, {
    onRetry: () => { boot(); },
    onSignOut: () => { cloudSignOut().then(() => location.reload()); },
  });
}

/** Cloud-mode-only: the hosted relay answered 402 plan_required. */
async function showUpgradeScreen() {
  stopListeningForNavigation();
  closeActiveModal();
  currentScreen = 'connect';
  const { renderUpgradeScreen } = await import('./upgrade-screen.js');
  renderUpgradeScreen(root, {
    checkoutPending: checkoutReturned,
    onRetry: () => { void cloudRefreshToken().catch(() => {}).then(() => boot()); },
    onSignOut: () => { cloudSignOut().then(() => location.reload()); },
  });
}

async function boot() {
  await requestWakeLock();
  try {
    if (CLOUD) await ensureCloudAuth();
  } catch {
    showBootError('Sign-in could not be loaded. Check your connection and try again.');
    return;
  }
  renderMainSkeleton(root);
  let res: Response;
  try {
    res = await apiFetch('/api/config');
  } catch {
    showBootError('Cannot reach server.\nIf protected by Cloudflare Access, open the URL in a browser tab first to authenticate, then reload.');
    return;
  }
  if (CLOUD && res.status === 402) {
    const body = await res.json().catch(() => null);
    const { isPlanRequired } = await import('./upgrade-screen.js');
    if (isPlanRequired(res.status, body)) {
      await showUpgradeScreen();
      return;
    }
  }
  if (CLOUD && res.status === 503) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === 'desktop_offline') {
      await connectWsOnce();
      showConnectScreen();
      return;
    }
  }
  if (!res.ok) {
    showBootError(`Server error ${res.status} — please reload.`);
    return;
  }
  try {
    cfg = await res.json() as PublicConfig;
    if (!cfg || !Array.isArray(cfg.projects)) throw new Error('invalid config');
  } catch {
    showBootError('The server returned an invalid configuration.');
    return;
  }
  await connectWsOnce();
  await settingsStore.loadGlobal();
  installTapAnywhereSend();
  showMain();
}

/**
 * While listening, a tap on any non-button area of the screen = SEND.
 * Massive tap target for driving: no need to find the small SEND button.
 */
let tapAnywhereInstalled = false;
function installTapAnywhereSend() {
  if (tapAnywhereInstalled) return;
  tapAnywhereInstalled = true;
  document.addEventListener('click', (e) => {
    if (state !== 'listening' || currentScreen !== 'session' || activeModal) return;
    const t = e.target instanceof HTMLElement ? e.target : null;
    if (!t) return;
    if (!t.closest('.dnv-session')) return;
    if (t.closest('button, input, textarea, select, label, a, [contenteditable="true"], [role="button"]')) return;
    handleSend();
  });
}

document.addEventListener('keydown', (event) => {
  if (currentScreen !== 'session' || activeModal || event.repeat || event.isComposing) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  const interactive = target?.closest('input, textarea, select, button, a, [contenteditable="true"]');
  if (interactive) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    if (!screenHandle?.closeComposer()) handleBack();
  } else if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    handleRecButton();
  } else if (event.key.toLowerCase() === 't' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    screenHandle?.openComposer();
  } else if (event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    handleReplay();
  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    handleSend();
  }
});

function closeActiveModal() {
  if (activeModal) {
    activeModal.close();
    activeModal = null;
    notificationQueue.drain();
  }
}

function showMain() {
  stopListeningForNavigation();
  closeActiveModal();
  currentSession = null;
  currentProject = null;
  screenHandle = null;
  projectScreenHandle = null;
  settingsHandle = null;
  hasResponse = false;
  accumulatedText = '';
  responseText = '';
  currentScreen = 'main';
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  const recent = getMostRecentSession(cfg);
  withTransition(() => renderMainScreen(
    root,
    cfg,
    (p) => showProject(p),
    () => showSettings('main'),
    () => {
      closeActiveModal();
      activeModal = renderAddProjectModal(app, {
        onSubmit: (payload) => {
          ws.send({ type: 'add_project', payload });
          if (!connected) toast.show('Project creation queued until you are back online', 'info', { durationMs: 5000 });
          closeActiveModal();
        },
        onCancel: () => closeActiveModal(),
      });
    },
    recent,
    recent ? () => {
      showProject(recent.project);
      enterSession(recent.session);
    } : null,
    installPrompt.isAvailable() ? () => {
      void installPrompt.show().then((outcome) => {
        if (outcome === 'accepted') toast.show('drivenvibe installed', 'success');
      });
    } : null,
  ));
}

function showProject(p: ProjectPublic) {
  stopListeningForNavigation();
  closeActiveModal();
  currentProject = p;
  currentSession = null;
  screenHandle = null;
  settingsHandle = null;
  currentScreen = 'project';
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  withTransition(() => { projectScreenHandle = renderProjectScreen(root, p, {
    onPickSession: (s) => { enterSession(s); },
    onBack: () => showMain(),
    onAddSession: () => {
      closeActiveModal();
      activeModal = renderAddSessionModal(app, {
        projectId: p.id,
        defaultProvider: settingsStore.getGlobal().default_provider,
        onSubmit: (payload) => {
          ws.send({ type: 'add_session', project_id: p.id, payload });
          if (!connected) toast.show('Session creation queued until you are back online', 'info', { durationMs: 5000 });
          closeActiveModal();
        },
        onCancel: () => closeActiveModal(),
      });
    },
    onLongPress: (s) => {
      closeActiveModal();
      activeModal = renderSessionActionSheet(app, s, {
        onOpen: () => {
          activeModal = null;
          enterSession(s);
        },
        onEdit: () => {
          activeModal = null;
          enterSession(s);
          showSettings('session');
        },
        onArchive: () => {
          activeModal = null;
          ws.send({ type: 'archive_session', session_id: s.id });
          toast.show(connected ? 'Session archived' : 'Archive queued until you are back online', 'info', {
            durationMs: 6000,
            actionLabel: 'Undo',
            onAction: () => ws.send({ type: 'unarchive_session', session_id: s.id }),
          });
        },
        onDismiss: () => { activeModal = null; notificationQueue.drain(); },
      });
    },
    onSettings: () => showSettings('project'),
  }); });
}

function showSettings(returnTo: 'main' | 'project' | 'session') {
  stopListeningForNavigation();
  closeActiveModal();
  settingsReturnTo = returnTo;
  currentScreen = 'settings';
  const sessionPub = returnTo === 'session' && currentSession ? currentSession : null;
  withTransition(() => { settingsHandle = renderSettingsScreen(
    root,
    {
      tab: returnTo === 'session' ? 'session' : 'global',
      global: settingsStore.getGlobal(),
      session: sessionPub,
    },
    {
      onBack: () => {
        settingsHandle = null;
        if (settingsReturnTo === 'session' && currentSession) {
          enterSession(currentSession);
        } else if (settingsReturnTo === 'project' && currentProject) {
          showProject(currentProject);
        } else {
          showMain();
        }
      },
      onGlobalPatch: (patch) => {
        ws.send({ type: 'update_settings', scope: 'global', patch });
      },
      onSessionPatch: (sessionId, patch) => {
        ws.send({ type: 'update_settings', scope: 'session', session_id: sessionId, patch });
      },
    },
  ); });
}

function enterSession(s: SessionPublic) {
  rememberCurrentSession();
  closeActiveModal();
  notificationQueue.remove(s.id);
  currentSession = s;
  const memory = sessionUiMemory.get(s.id);
  accumulatedText = memory?.transcript ?? '';
  responseText = memory?.response ?? '';
  hasResponse = memory?.hasResponse ?? false;
  markSessionOpened(s.id);
  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: s.label,
      artist: currentProject?.label ?? 'drivenvibe',
      album: 'Voice coding session',
    });
  }
  ws.send({ type: 'open_session', session_id: s.id });
  withTransition(() => { screenHandle = renderSessionScreen(root, s, {
    onRec: handleRecButton,
    onSend: handleSend,
    onReplay: handleReplay,
    onClear: handleClear,
    onTextSend: handleTypedSend,
    onBack: handleBack,
    onSettings: () => showSettings('session'),
  }); });
  currentScreen = 'session';
  screenHandle!.setConnected(connected);
  screenHandle!.setHasResponse(hasResponse);
  screenHandle!.setResponse(responseText);
  screenHandle!.setTranscript(accumulatedText);
  setState('idle');
}

// ─────────────────────────────────────────────────────────────────
// Recording / STT state machine
// ─────────────────────────────────────────────────────────────────

function currentSttBackend(): SttBackend {
  return currentSession?.stt_backend ?? 'browser';
}

/** Start MediaRecorder-based recording for server-side STT. */
async function startServerStt(): Promise<void> {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e: any) {
    speak('Microphone access denied');
    setState('paused');
    return;
  }
  mediaChunks = [];
  // The blob ships as ONE WebSocket frame, and the server caps frames at 256 KB
  // (MAX_WS_PAYLOAD_BYTES). At the browser default bitrate that is ~12 s of audio,
  // so a longer utterance would be silently dropped by the socket. 24 kbps Opus is
  // ample for speech and buys ~45 s, matching MAX_AUDIO_BLOB_CHARS.
  const recorder = new MediaRecorder(mediaStream, { audioBitsPerSecond: 24_000 });
  mediaRecorder = recorder;
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) mediaChunks.push(ev.data);
  };
  recorder.start();
  setState('listening');
}

/** Stop MediaRecorder recording and send audio_blob to server. */
function stopServerStt(): void {
  if (!mediaRecorder) return;
  const recorder = mediaRecorder;
  mediaRecorder = null;
  recorder.onstop = async () => {
    // Release mic
    mediaStream?.getTracks().forEach((t) => t.stop());
    mediaStream = null;

    if (mediaChunks.length === 0) return;
    const mime = recorder.mimeType || 'audio/webm';
    const blob = new Blob(mediaChunks, { type: mime });
    mediaChunks = [];
    const arrayBuf = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    // Convert to base64
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const audio = btoa(binary);
    if (currentSession) {
      setState('processing');
      ws.send({ type: 'audio_blob', session_id: currentSession.id, audio, mime });
    }
  };
  recorder.stop();
}

function handleRecButton() {
  switch (state) {
    case 'idle':
      startFresh();
      return;
    case 'listening':
      pauseRecording();
      return;
    case 'paused':
      resumeRecording();
      return;
    case 'playing':
      stopTts();
      return;
    case 'queued':
    case 'processing':
      handleCancel();
      return;
  }
}

function startFresh() {
  if (currentSttBackend() === 'browser' && !Stt.isSupported()) {
    toast.show('Voice recognition is unavailable here. Type your message instead.', 'error', { durationMs: 6000 });
    screenHandle?.openComposer();
    return;
  }
  haptic(20);
  accumulatedText = '';
  responseText = '';
  screenHandle?.setTranscript('');
  screenHandle?.setResponse('');
  hasResponse = false;
  screenHandle?.setHasResponse(false);
  rememberCurrentSession();
  tones.start();
  if (currentSttBackend() === 'server') {
    void startServerStt();
  } else {
    if (!Stt.isSupported()) {
      speak('Speech recognition not supported');
      return;
    }
    beginStt();
  }
}

function resumeRecording() {
  if (currentSttBackend() === 'server') {
    haptic(20);
    tones.resume();
    void startServerStt();
    return;
  }
  if (!Stt.isSupported()) return;
  haptic(20);
  tones.resume();
  beginStt();
}

function beginStt() {
  const lang = currentSession?.lang || 'en-US';
  const sessionId = currentSession?.id;
  const epoch = ++recordingEpoch;
  setState('listening');
  const baseAtStart = accumulatedText;
  stt.start(lang, {
    onUpdate: (full) => {
      if (epoch !== recordingEpoch || !sessionId || currentSession?.id !== sessionId) return;
      const merged = mergeText(baseAtStart, full);
      screenHandle?.setTranscript(merged);
    },
    onEnd: (final) => {
      if (epoch !== recordingEpoch || !sessionId || currentSession?.id !== sessionId) return;
      accumulatedText = mergeText(baseAtStart, final);
      screenHandle?.setTranscript(accumulatedText);
      rememberCurrentSession();
      if (state === 'listening') {
        haptic(20);
        tones.pause();
        setState('paused');
      }
    },
    onError: (msg) => {
      if (epoch !== recordingEpoch || !sessionId || currentSession?.id !== sessionId) return;
      console.warn('STT error', msg);
      haptic([20, 50, 20]);
      tones.error();
      const denied = msg === 'not-allowed' || msg === 'service-not-allowed';
      const friendly = denied
        ? 'Microphone access is blocked. Allow it in browser settings, or type your message.'
        : msg === 'network'
          ? 'Voice recognition lost its network connection. You can keep working by typing.'
          : `Voice recognition stopped (${msg}). You can resume or type instead.`;
      toast.show(friendly, 'error', { durationMs: 6500 });
      setState(accumulatedText ? 'paused' : 'idle');
      if (denied) screenHandle?.openComposer();
    },
  });
}

function pauseRecording() {
  if (currentSttBackend() === 'server') {
    // For server STT, stopping the recorder triggers the onstop handler which
    // sends the audio_blob. State is flipped there.
    stopServerStt();
  } else {
    stt.stop();
    // onEnd handler does the state flip + pause tone.
  }
}

function stopTts() {
  cancelSpeak();
  setState('idle');
}

// ─────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────

function handleSend() {
  if (state === 'listening') {
    recordingEpoch += 1;
    if (currentSttBackend() === 'server') {
      // stopServerStt() ships the audio_blob; the transcript arrives back over the
      // socket and re-enters handleSend() with the recognized text.
      stopServerStt();
      return;
    }
    const final = stt.stop();
    accumulatedText = mergeText(accumulatedText, final);
  }
  const text = accumulatedText.trim();
  if (!text) {
    setState('idle');
    return;
  }
  haptic(20);
  responseText = '';
  screenHandle?.setResponse('');
  hasResponse = false;
  screenHandle?.setHasResponse(false);
  rememberCurrentSession();
  tones.send();
  setState(connected ? 'processing' : 'queued');
  ws.send({ type: 'user_message', session_id: currentSession!.id, text });
}

function handleTypedSend(text: string) {
  if (!currentSession || state === 'processing' || state === 'queued') return;
  recordingEpoch += 1;
  if (state === 'listening') {
    stt.stop();
    setState('idle');
  }
  accumulatedText = text.trim();
  screenHandle?.setTranscript(accumulatedText);
  rememberCurrentSession();
  handleSend();
}

function handleCancel() {
  if (state !== 'processing' && state !== 'queued') return;
  ws.send({ type: 'cancel' });
  tones.pause();
  setState('idle');
  toast.show('Request cancelled', 'info');
}

function handleClear() {
  recordingEpoch += 1;
  if (state === 'listening') {
    if (currentSttBackend() === 'server') discardServerRecording();
    else stt.stop();
  }
  accumulatedText = '';
  responseText = '';
  hasResponse = false;
  screenHandle?.setTranscript('');
  screenHandle?.setResponse('');
  screenHandle?.setHasResponse(false);
  cancelSpeak();
  haptic(20);
  tones.clear();
  setState('idle');
  rememberCurrentSession();
}

function handleReplay() {
  if (!hasResponse) return;
  cancelSpeak();
  ws.send({ type: 'replay' });
  // server will send back a 'say' message which kicks off speak() + tones.reply
}

function handleBack() {
  stopListeningForNavigation();
  ws.send({ type: 'close_session' });
  if (currentProject) {
    showProject(currentProject);
  } else {
    showMain();
  }
}

function installMediaSessionControls() {
  if (!('mediaSession' in navigator)) return;
  const set = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
  };
  set('play', () => {
    if (currentScreen === 'session' && (state === 'idle' || state === 'paused')) handleRecButton();
  });
  set('pause', () => {
    if (currentScreen === 'session' && (state === 'listening' || state === 'playing')) handleRecButton();
  });
  set('stop', () => {
    if (currentScreen !== 'session') return;
    if (state === 'processing' || state === 'queued') handleCancel();
    else if (state === 'listening' || state === 'playing') handleRecButton();
  });
}

// ─────────────────────────────────────────────────────────────────
// Server messages
// ─────────────────────────────────────────────────────────────────

function handleServer(msg: ServerMessage) {
  switch (msg.type) {
    // Relay-only (cloud mode); never sent in local/self-host mode.
    case 'desktop_status':
      if (msg.online) {
        if (currentScreen === 'connect') {
          toast.show('Computer connected', 'success');
          boot();
        }
      } else {
        showConnectScreen();
      }
      break;
    case 'cc_chunk':
      if (msg.session_id !== currentSession?.id) break;
      responseText += msg.text;
      screenHandle?.setResponse(responseText);
      rememberCurrentSession();
      break;
    case 'cc_done':
      if (msg.session_id !== currentSession?.id) break;
      if (state === 'processing' && responseText.length === 0) setState('idle');
      break;
    case 'say':
      if (msg.session_id !== currentSession?.id) break;
      hasResponse = true;
      screenHandle?.setHasResponse(true);
      if (!responseText) {
        responseText = msg.text;
        screenHandle?.setResponse(responseText);
      }
      rememberCurrentSession();
      setState('playing');
      haptic(20);
      tones.reply();
      speak(msg.text, { onEnd: () => { if (state === 'playing') setState('idle'); } });
      break;
    case 'session_ready': {
      // cfg can still be unset in cloud mode (handler registers at module init).
      const project = cfg?.projects.find((p) => p.id === msg.project_id);
      const session = project?.sessions.find((s) => s.id === msg.session_id);
      notificationQueue.enqueue({
        session_id: msg.session_id,
        project_id: msg.project_id,
        label: msg.label,
        color: msg.color,
        emoji: session?.emoji,
      });
      break;
    }
    case 'config_changed': {
      cfg = msg.config;
      if (currentScreen === 'main') {
        showMain();
      } else if (currentScreen === 'project' && currentProject) {
        const freshProject = cfg.projects.find((p) => p.id === currentProject!.id);
        if (freshProject) {
          currentProject = freshProject;
          projectScreenHandle?.setProject(freshProject);
        } else {
          showMain();
        }
      } else if (currentScreen === 'session' && currentSession) {
        const freshProject = currentProject
          ? cfg.projects.find((p) => p.id === currentProject!.id) ?? null
          : null;
        if (freshProject) {
          currentProject = freshProject;
          const freshSession = freshProject.sessions.find((s) => s.id === currentSession!.id);
          if (freshSession) {
            currentSession = freshSession;
          } else {
            showProject(freshProject);
          }
        } else {
          showMain();
        }
      }
      break;
    }
    case 'settings_changed':
      if (msg.scope === 'global') {
        settingsStore.applyGlobalPatch(msg.patch);
        settingsHandle?.setGlobal(settingsStore.getGlobal());
        settingsHandle?.setSaveState('saved');
      } else if (msg.scope === 'session') {
        if (currentSession?.id === msg.session_id) {
          currentSession = { ...currentSession, ...msg.patch };
          settingsHandle?.setSession(currentSession);
        }
        settingsHandle?.setSaveState('saved');
      }
      break;
    case 'transcript':
      // Server-side STT result: update transcript display, then auto-send.
      if (msg.session_id !== currentSession?.id) break;
      accumulatedText = mergeText(accumulatedText, msg.text);
      screenHandle?.setTranscript(accumulatedText);
      // Auto-send like the browser path does after stop.
      if (accumulatedText.trim()) {
        haptic(20);
        responseText = '';
        screenHandle?.setResponse('');
        tones.send();
        setState('processing');
        ws.send({ type: 'user_message', session_id: currentSession!.id, text: accumulatedText.trim() });
      } else {
        setState('idle');
      }
      break;
    case 'error':
      toast.show(msg.message, 'error');
      responseText = 'Error: ' + msg.message;
      screenHandle?.setResponse(responseText);
      rememberCurrentSession();
      settingsHandle?.setSaveState('error');
      haptic([20, 50, 20]);
      tones.error();
      speak('Error: ' + msg.message.slice(0, 60));
      setState('idle');
      break;
    case 'ready':
      break;
  }
}

installMediaSessionControls();
boot();
