import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Config, SessionConfig } from './config.js';
import { findSession } from './config.js';
import type { State } from './state.js';
import type { Settings } from './settings.js';
import { CodexRuntimeAdapter } from './codex-runtime-adapter.js';
import type { RuntimeAdapter } from './runtime-adapter.js';

export interface CcChunk { text: string; final: boolean; cancelled?: boolean }

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const VOICE_MODE_INSTRUCTIONS = `
You are speaking to a user who is driving. Your replies are spoken aloud by
the phone — optimize for being heard, not read.

- Default to 1–2 short conversational sentences. Be terse, not curt.
- NO code blocks, backticks, markdown headers, or bullet lists unless the user
  explicitly asks "show me the code" or similar.
- NO file paths, no function_name_with_underscores, no symbol-heavy strings
  read aloud. Describe what something is in plain English.
- For long answers: give a one-sentence summary, then ask "Want the details?"
  Wait for the user before dumping.
- After running tools, report the OUTCOME ("found three files matching X"),
  not the action ("I ran ls -la").
- Plain words. "Runs" not "executes". "Saved" not "persisted to disk".
- If reporting a code change, describe the change in one sentence; don't
  recite the diff.
`.trim();

/**
 * Build the subprocess environment for a session's provider. Returned as an
 * explicit env object (passed to `query` options) instead of mutating the
 * shared `process.env`, so concurrent sessions can never clobber each other's
 * credentials. Throws if a required API key is missing.
 */
export function providerEnv(session: SessionConfig, settings: Settings): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  // Relay credentials authenticate the desktop itself and are never required
  // by Claude Code. Do not leak them into a tool-enabled child process.
  delete env.RELAY_TOKEN;
  delete env.DEVICE_TOKEN_SECRET;
  const provider = session.provider ?? 'subscription';
  if (provider === 'subscription') {
    // Subscription path uses ~/.claude credentials. Strip any API-key env so it
    // doesn't override the subscription auth.
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_BASE_URL;
  } else if (provider === 'anthropic-api') {
    const key = settings.get('anthropic_api_key');
    if (!key) throw new Error(`Session '${session.id}' uses anthropic-api but no anthropic_api_key in settings`);
    env.ANTHROPIC_API_KEY = key;
    delete env.ANTHROPIC_BASE_URL;
  } else if (provider === 'openrouter') {
    const key = settings.get('openrouter_api_key');
    if (!key) throw new Error(`Session '${session.id}' uses openrouter but no openrouter_api_key in settings`);
    env.ANTHROPIC_API_KEY = key;
    env.ANTHROPIC_BASE_URL = OPENROUTER_BASE_URL;
  }
  return env;
}

export class SessionManager {
  /** AbortControllers for in-flight turns, keyed by session id, so `cancel()` works. */
  private inflight = new Map<string, AbortController>();

  private readonly codex: RuntimeAdapter;

  constructor(
    private cfg: Config,
    private settings: Settings,
    private state: State,
    adapters: { codex?: RuntimeAdapter } = {},
  ) {
    this.codex = adapters.codex ?? new CodexRuntimeAdapter();
  }

  /** Last durable response, used when a socket reconnects before replay. */
  getLastResponse(sessionId: string): string | undefined {
    return this.state.getLastResponse(sessionId);
  }

  async *send(sessionId: string, userText: string): AsyncIterable<CcChunk> {
    const found = findSession(this.cfg, sessionId);
    if (!found) throw new Error(`Unknown session: ${sessionId}`);
    const session = found.session;

    let collected = '';
    let capturedUuid: string | undefined;
    let resume: string | undefined;
    const abortController = new AbortController();

    // Barge-in: a new turn preempts the session's in-flight turn and takes
    // ownership immediately. Deliberately NOT serialized behind the preempted
    // turn: a stale generator that ignores its abort signal (a wedged runtime
    // call) would otherwise hold the replacement off indefinitely, hanging the
    // one interaction a driver cannot work around. Ordering is not needed for
    // correctness either — the `isCurrentTurn` guard in `finally` already stops
    // the preempted turn from persisting anything, and providerEnv() returns an
    // explicit env object rather than mutating process.env, so concurrent turns
    // share no global to clobber.
    this.inflight.get(sessionId)?.abort();
    this.inflight.set(sessionId, abortController);

    try {
      if (session.provider === 'codex') {
        const prompt = session.voice_mode
          ? `${VOICE_MODE_INSTRUCTIONS}\n\nUser request:\n${userText}`
          : userText;
        const sandbox = session.permission_mode === 'plan' ? 'read-only' : 'workspace-write';
        for await (const event of this.codex.run({
          cwd: session.project_dir,
          prompt,
          sandbox,
          model: session.model,
          signal: abortController.signal,
        })) {
          if (event.type === 'text') {
            collected += event.text;
            yield { text: event.text, final: false };
          } else if (event.type === 'done') {
            yield { text: '', final: true };
          }
        }
      } else {
        resume = this.state.getCcSessionId(sessionId);
        const permissionMode = session.permission_mode ?? 'bypassPermissions';
        const opts: Parameters<typeof query>[0]['options'] = {
          cwd: session.project_dir,
          env: providerEnv(session, this.settings),
          permissionMode,
          abortController,
          // The SDK loads user/project/local settings when this is omitted (0.1.x
          // loaded none). A settings.json `env` block or hooks would then run on
          // every phone turn and can override the provider env above.
          settingSources: [],
        };
        if (permissionMode === 'bypassPermissions') opts.allowDangerouslySkipPermissions = true;
        if (resume) opts.resume = resume;
        if (session.voice_mode) {
          opts.systemPrompt = {
            type: 'preset',
            preset: 'claude_code',
            append: VOICE_MODE_INSTRUCTIONS,
            // Render per request: the default records the prompt on the first
            // request, so toggling voice_mode on a resumed session would be ignored.
            snapshot: false,
          };
        }
        if (session.model) {
          opts.model = session.model;
        }

        for await (const msg of query({ prompt: userText, options: opts })) {
          if ('session_id' in msg && msg.session_id && !capturedUuid) {
            capturedUuid = msg.session_id;
          }
          if (msg.type === 'assistant') {
            for (const block of msg.message.content) {
              if (block.type === 'text') {
                collected += block.text;
                yield { text: block.text, final: false };
              }
            }
          } else if (msg.type === 'result') {
            // An abort during a hook ends the turn with a normal result instead of
            // throwing; it is still a cancel, not a finished answer.
            if (abortController.signal.aborted) {
              yield { text: '', final: true, cancelled: true };
              return;
            }
            yield { text: '', final: true };
          }
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        // Cancellation is an expected control-flow event, not a client-facing
        // server failure. The dispatcher uses this marker to finish the UI
        // stream without speaking a stale partial answer.
        yield { text: '', final: true, cancelled: true };
        return;
      }
      throw error;
    } finally {
      const isCurrentTurn = this.inflight.get(sessionId) === abortController;
      if (isCurrentTurn) {
        this.inflight.delete(sessionId);
      }

      // A replacement turn aborts the old generator. Never let that stale
      // generator land its partial response/session id after the newer turn.
      // Explicit cancel keeps this controller current, so useful partial state
      // is still retained for replay/resume.
      if (isCurrentTurn && ((capturedUuid && capturedUuid !== resume) || collected)) {
        await this.state.patchSession(sessionId, {
          ccSessionId: capturedUuid && capturedUuid !== resume ? capturedUuid : undefined,
          lastResponse: collected || undefined,
        });
      }
    }
  }

  /** Abort the in-flight turn for a session, if one is running. */
  cancel(sessionId: string): void {
    this.inflight.get(sessionId)?.abort();
  }
}
