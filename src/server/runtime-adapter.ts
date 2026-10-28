export type RuntimeEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'done' };

export interface RuntimeRequest {
  cwd: string;
  prompt: string;
  sandbox: 'read-only' | 'workspace-write';
  model?: string;
  signal?: AbortSignal;
}

export interface RuntimeAdapter {
  run(request: RuntimeRequest): AsyncIterable<RuntimeEvent>;
}
