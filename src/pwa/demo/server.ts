/**
 * In-memory stand-in for the desktop server, used only by the /demo build.
 * Speaks the server side of shared/protocol.ts with scripted replies; nothing
 * leaves the page. Pure TS (no DOM) so tests/demo-server.test.ts can drive it.
 */
import type {
  ClientMessage, ServerMessage, PublicConfig, PublicSettings, PublicGlobalPatch,
} from '../../../shared/protocol.js';

export const DEMO_CONFIG: PublicConfig = {
  projects: [
    {
      id: 'demo-shop', label: 'Demo Shop', color: '#3b82f6', emoji: '🛒',
      sessions: [
        { id: 'checkout', label: 'Checkout flow', color: '#3b82f6', emoji: '💳', lang: 'en-US', provider: 'subscription' },
        { id: 'bug-bash', label: 'Bug bash', color: '#ef4444', emoji: '🐛', lang: 'en-US', provider: 'subscription' },
        { id: 'tests', label: 'Test coverage', color: '#10b981', emoji: '🧪', lang: 'en-US', provider: 'anthropic-api' },
      ],
    },
    {
      id: 'demo-weather', label: 'Weather API', color: '#8b5cf6', emoji: '⛅',
      sessions: [
        { id: 'rate-limit', label: 'Rate limiter', color: '#f59e0b', emoji: '🚦', lang: 'en-US', provider: 'subscription' },
        { id: 'api-docs', label: 'API docs', color: '#6366f1', emoji: '📚', lang: 'en-US', provider: 'codex' },
      ],
    },
    {
      id: 'demo-side-quest', label: 'Side quest', color: '#14b8a6', emoji: '🎮',
      sessions: [
        { id: 'snake', label: 'Terminal snake', color: '#22c55e', emoji: '🐍', lang: 'en-US', provider: 'subscription' },
      ],
    },
  ],
};

export const DEMO_SETTINGS: PublicSettings = {
  default_provider: 'subscription',
  theme: 'auto',
  haptics: true,
  has_anthropic_key: false,
  has_openrouter_key: false,
};

interface Turn { body: string; say: string }

const SCRIPTS: Record<string, Turn[]> = {
  checkout: [
    {
      body: 'Reading src/checkout/cart.ts and src/checkout/coupons.ts…\n'
        + 'Found it: the 10% is taken off the net price, but tax is still charged on the full price, so the total only drops by about 9%.\n'
        + 'Editing src/checkout/cart.ts (+7 −3): apply discounts first, then tax.\n'
        + 'Running npm test -- cart…\n'
        + '✓ 18 tests passed in 2.1s\n'
        + 'Done. Coupons now reduce the price before tax is added.',
      say: 'Fixed. Coupons now apply before tax, and all 18 cart tests pass.',
    },
    {
      body: 'Writing the pull request summary…\n'
        + 'Title: Apply coupon discounts before tax\n'
        + '• cart.ts: reorder total calculation\n'
        + '• cart.test.ts: two new cases for stacked coupons\n'
        + 'Branch fix/coupon-tax pushed. Ready for review.',
      say: 'The pull request is ready for review on branch fix coupon tax.',
    },
  ],
  'bug-bash': [
    {
      body: 'Searching for "Cannot read properties of undefined"…\n'
        + '3 hits. The crash is in src/orders/history.tsx: orders without a shipping address.\n'
        + 'Adding a guard and an empty state (+12 −1).\n'
        + 'Running npm test -- orders…\n'
        + '✓ 9 tests passed\n'
        + 'Done. The order history page no longer crashes for digital orders.',
      say: 'Order history no longer crashes for orders without an address. Tests are green.',
    },
  ],
  tests: [
    {
      body: 'Running npm run coverage…\n'
        + 'Lowest file: src/pricing/vat.ts at 41%.\n'
        + 'Writing tests/pricing/vat.test.ts: 11 cases (zero rate, reverse charge, rounding).\n'
        + '✓ 11 new tests pass. vat.ts coverage 41% → 96%.',
      say: 'I added eleven VAT tests. Coverage for that file went from 41 to 96 percent.',
    },
  ],
  'rate-limit': [
    {
      body: 'Reading src/fetchers/forecast.ts…\n'
        + 'The upstream returns 429 under load and we retry immediately, which makes it worse.\n'
        + 'Adding retry with exponential backoff and jitter (max 4 attempts).\n'
        + 'Running npm test…\n'
        + '✓ 27 tests passed\n'
        + 'Done. Forecast fetches now back off on 429.',
      say: 'Forecast requests now back off with jitter on rate limits. All 27 tests pass.',
    },
  ],
  'api-docs': [
    {
      body: 'Scanning route handlers in src/routes/…\n'
        + 'Found 6 endpoints, 2 without docs: /v1/alerts and /v1/history.\n'
        + 'Updating docs/api.md with request and response examples.\n'
        + 'Done. All 6 endpoints are documented.',
      say: 'The API docs now cover all six endpoints, including alerts and history.',
    },
  ],
  snake: [
    {
      body: 'Creating snake.ts with a 20×12 grid and arrow-key input…\n'
        + 'Adding wall and self collision, score in the corner.\n'
        + 'Running npx tsx snake.ts --selftest…\n'
        + '✓ game loop runs at 8 ticks per second\n'
        + 'Done. Run npx tsx snake.ts to play.',
      say: 'Terminal snake is ready. Run it with npx tsx snake dot ts.',
    },
  ],
};

const FALLBACK: Turn = {
  body: 'Reading the project structure…\n'
    + 'Looking at the files related to your request.\n'
    + 'Making a small, focused change (+4 −1).\n'
    + 'Running npm test…\n'
    + '✓ all tests passed\n'
    + 'Done. This is the demo, so the code is make-believe, but the flow is the real app.',
  say: 'Done, and the tests pass. This is a demo, so try a different session too.',
};

/** Pre-written result for a session that "finishes in the background". */
const BACKGROUND_SAY = 'The background task finished: 3 files changed and every test passed.';

const TRANSCRIPTS = [
  'Fix the coupon bug in checkout and run the cart tests',
  'Now write a short summary for the pull request',
  'Add a retry with backoff and run the tests again',
];
let transcriptIndex = 0;
/** Next scripted "you said…" phrase (shared by the fake mic and audio_blob). */
export function nextTranscript(): string {
  return TRANSCRIPTS[transcriptIndex++ % TRANSCRIPTS.length];
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

export interface DemoServerOptions {
  /** ms before the first chunk ("thinking"). */
  thinkMs?: number;
  /** ms between streamed chunks. */
  chunkMs?: number;
  /** ms after the first reply before another session reports ready. */
  readyMs?: number;
}

export class DemoServer {
  config: PublicConfig = structuredClone(DEMO_CONFIG);
  settings: PublicSettings = { ...DEMO_SETTINGS };
  emit: (msg: ServerMessage) => void = () => {};

  private openSession: string | null = null;
  private turns = new Map<string, number>();
  private lastSay = new Map<string, string>();
  private stream: ReturnType<typeof setTimeout> | null = null;
  private readyScheduled = false;
  private readonly thinkMs: number;
  private readonly chunkMs: number;
  private readonly readyMs: number;

  constructor(opts: DemoServerOptions = {}) {
    this.thinkMs = opts.thinkMs ?? 700;
    this.chunkMs = opts.chunkMs ?? 90;
    this.readyMs = opts.readyMs ?? 7000;
  }

  handle(msg: ClientMessage): void {
    switch (msg.type) {
      case 'open_session': this.openSession = msg.session_id; break;
      case 'close_session': this.openSession = null; break;
      case 'user_message': this.reply(msg.session_id); break;
      case 'audio_blob': this.emit({ type: 'transcript', session_id: msg.session_id, text: nextTranscript() }); break;
      case 'cancel': this.stopStream(); break;
      case 'replay': {
        const id = this.openSession;
        const text = id ? this.lastSay.get(id) : undefined;
        if (id && text) this.emit({ type: 'say', session_id: id, text });
        break;
      }
      case 'update_settings':
        if (msg.scope === 'global') {
          const { anthropic_api_key, openrouter_api_key, ...rest } = msg.patch;
          const patch: PublicGlobalPatch = { ...rest };
          if (anthropic_api_key !== undefined) patch.has_anthropic_key = !!anthropic_api_key;
          if (openrouter_api_key !== undefined) patch.has_openrouter_key = !!openrouter_api_key;
          this.settings = { ...this.settings, ...patch };
          this.emit({ type: 'settings_changed', scope: 'global', patch });
        } else {
          const s = this.findSession(msg.session_id);
          if (s) Object.assign(s, msg.patch);
          this.emit({ type: 'settings_changed', scope: 'session', session_id: msg.session_id, patch: msg.patch });
        }
        break;
      case 'add_project': {
        const { label, color, emoji } = msg.payload;
        this.config.projects.push({ id: this.uniqueId(slug(label)), label, color, emoji, sessions: [] });
        this.configChanged();
        break;
      }
      case 'add_session': {
        const project = this.config.projects.find((p) => p.id === msg.project_id);
        if (!project) { this.emit({ type: 'error', message: 'Unknown project' }); break; }
        const { label, color, emoji, provider, model } = msg.payload;
        project.sessions.push({ id: this.uniqueId(slug(label)), label, color, emoji, provider, model, lang: 'en-US' });
        this.configChanged();
        break;
      }
      case 'archive_session':
      case 'unarchive_session': {
        const s = this.findSession(msg.session_id);
        if (s) s.archived = msg.type === 'archive_session';
        this.configChanged();
        break;
      }
    }
  }

  dispose(): void {
    this.stopStream();
  }

  private reply(sessionId: string): void {
    this.stopStream();
    const n = this.turns.get(sessionId) ?? 0;
    this.turns.set(sessionId, n + 1);
    const turn = SCRIPTS[sessionId]?.[n] ?? FALLBACK;
    // Word-sized pieces keep the stream looking like real token output.
    const pieces = turn.body.match(/\S+\s*/g) ?? [turn.body];
    let i = 0;
    const next = () => {
      if (i < pieces.length) {
        this.emit({ type: 'cc_chunk', session_id: sessionId, text: pieces[i++] });
        this.stream = setTimeout(next, this.chunkMs);
        return;
      }
      this.stream = null;
      this.emit({ type: 'cc_done', session_id: sessionId });
      this.lastSay.set(sessionId, turn.say);
      this.emit({ type: 'say', session_id: sessionId, text: turn.say });
      this.scheduleReady(sessionId);
    };
    this.stream = setTimeout(next, this.thinkMs);
  }

  private stopStream(): void {
    if (this.stream) clearTimeout(this.stream);
    this.stream = null;
  }

  /** Once per page: another session "finishes" so the ready overlay shows up. */
  private scheduleReady(fromSession: string): void {
    if (this.readyScheduled) return;
    const project = this.config.projects.find((p) =>
      p.sessions.some((s) => s.id !== fromSession && !s.archived)
      && !p.sessions.some((s) => s.id === fromSession));
    const session = project?.sessions.find((s) => !s.archived);
    if (!project || !session) return;
    this.readyScheduled = true;
    this.lastSay.set(session.id, BACKGROUND_SAY);
    setTimeout(() => {
      this.emit({ type: 'session_ready', session_id: session.id, project_id: project.id, label: session.label, color: session.color });
    }, this.readyMs);
  }

  private findSession(id: string) {
    for (const p of this.config.projects) {
      const s = p.sessions.find((x) => x.id === id);
      if (s) return s;
    }
    return undefined;
  }

  private uniqueId(base: string): string {
    const taken = new Set(this.config.projects.flatMap((p) => [p.id, ...p.sessions.map((s) => s.id)]));
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  private configChanged(): void {
    this.emit({ type: 'config_changed', config: structuredClone(this.config) });
  }
}
