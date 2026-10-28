import { describe, expect, it } from 'vitest';
import { SessionManager } from '../src/server/session-manager.js';
import type { Config } from '../src/server/config.js';
import type { RuntimeAdapter, RuntimeRequest } from '../src/server/runtime-adapter.js';

const config: Config = {
  projects: [{
    id: 'project', label: 'Project', color: '#3b82f6', sessions: [{
      id: 'codex', label: 'Codex', color: '#6366f1', project_dir: '/workspace',
      provider: 'codex', voice_mode: false, tts_rate: 1.2, stt_backend: 'browser',
    }],
  }],
};

class FakeCodexRuntime implements RuntimeAdapter {
  request: RuntimeRequest | undefined;

  async *run(request: RuntimeRequest) {
    this.request = request;
    yield { type: 'session' as const, sessionId: 'codex-thread' };
    yield { type: 'text' as const, text: 'Done.' };
    yield { type: 'done' as const };
  }
}

const settings = { get: () => undefined } as any;
const state = {
  getCcSessionId: () => undefined,
  setCcSessionId: async () => {},
  setLastResponse: async () => {},
  patchSession: async () => {},
} as any;

describe('SessionManager Codex provider', () => {
  it('uses the Codex runtime and maps its events to the existing chunk contract', async () => {
    const runtime = new FakeCodexRuntime();
    const manager = new SessionManager(config, settings, state, { codex: runtime });
    const chunks = [];
    for await (const chunk of manager.send('codex', 'Fix the test')) chunks.push(chunk);

    expect(chunks).toEqual([{ text: 'Done.', final: false }, { text: '', final: true }]);
    expect(runtime.request).toMatchObject({
      cwd: '/workspace', prompt: 'Fix the test', sandbox: 'workspace-write',
    });
  });

  it('uses read-only Codex sandbox for plan sessions', async () => {
    const runtime = new FakeCodexRuntime();
    const planConfig: Config = structuredClone(config);
    planConfig.projects[0].sessions[0].permission_mode = 'plan';
    const manager = new SessionManager(planConfig, settings, state, { codex: runtime });
    for await (const _chunk of manager.send('codex', 'Review this repo')) { /* drain */ }

    expect(runtime.request?.sandbox).toBe('read-only');
  });
});
