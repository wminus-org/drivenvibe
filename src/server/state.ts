import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { writeJsonAtomic, readJsonOrDefault } from './fs-util.js';
import { createSerialQueue } from './serial-queue.js';

const StateSchema = z.object({
  cc_session_ids: z.record(z.string(), z.string()).default({}),
  last_responses: z.record(z.string(), z.string()).default({}),
});

type StateData = z.infer<typeof StateSchema>;

export interface SessionStatePatch {
  ccSessionId?: string;
  lastResponse?: string;
}

export class State {
  /** Serializes snapshots so concurrent completed turns cannot reorder writes. */
  private writeQueue = createSerialQueue();

  private constructor(private path: string, private data: StateData) {}

  static async load(p: string): Promise<State> {
    const raw = await readJsonOrDefault<unknown>(p, {});
    const data = StateSchema.parse(raw);
    // Responses can contain private user/project content; repair permissions on
    // stores created by older versions as well as securing future writes.
    await fs.chmod(p, 0o600).catch(() => {});
    return new State(p, data);
  }

  getCcSessionId(sid: string): string | undefined {
    return this.data.cc_session_ids[sid];
  }

  async setCcSessionId(sid: string, uuid: string): Promise<void> {
    await this.patchSession(sid, { ccSessionId: uuid });
  }

  getLastResponse(sid: string): string | undefined {
    return this.data.last_responses[sid];
  }

  async setLastResponse(sid: string, text: string): Promise<void> {
    await this.patchSession(sid, { lastResponse: text });
  }

  /** Persist resume id and response in one atomic snapshot when both changed. */
  async patchSession(sid: string, patch: SessionStatePatch): Promise<void> {
    const next: StateData = {
      cc_session_ids: patch.ccSessionId === undefined
        ? this.data.cc_session_ids
        : { ...this.data.cc_session_ids, [sid]: patch.ccSessionId },
      last_responses: patch.lastResponse === undefined
        ? this.data.last_responses
        : { ...this.data.last_responses, [sid]: patch.lastResponse },
    };
    this.data = next;
    await this.flush(next);
  }

  private flush(snapshot: StateData): Promise<void> {
    return this.writeQueue(() => writeJsonAtomic(this.path, snapshot, { mkdir: true, mode: 0o600 }));
  }
}
