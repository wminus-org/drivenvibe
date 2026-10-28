import { describe, it, expect, vi, afterEach } from 'vitest';
import { WhisperCppStt } from '../src/server/stt-whisper.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkFetch(text: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ text }),
    text: async () => JSON.stringify({ text }),
  } as unknown as Response);
}

function makeErrorFetch(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => { throw new Error('not json'); },
    text: async () => body,
  } as unknown as Response);
}

function makeBadJsonFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ wrong_field: 'oops' }),
    text: async () => '{"wrong_field":"oops"}',
  } as unknown as Response);
}

function makeNetworkErrorFetch(msg: string) {
  return vi.fn().mockRejectedValue(new Error(msg));
}

// ---------------------------------------------------------------------------
// Tests — WhisperCppStt.transcribe()
// ---------------------------------------------------------------------------

describe('WhisperCppStt.transcribe', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs audio to /inference and returns trimmed transcript', async () => {
    const mockFetch = makeOkFetch('  hello world  ');
    vi.stubGlobal('fetch', mockFetch);

    const client = new WhisperCppStt({ baseUrl: 'http://localhost:9000' });
    const audio = Buffer.from('fake-audio-bytes');
    const result = await client.transcribe(audio, 'audio/webm');

    expect(result).toBe('hello world');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:9000/inference');
    expect(init.method).toBe('POST');
  });

  it('includes model field in form data', async () => {
    let capturedFormData: FormData | undefined;
    const mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedFormData = init.body as FormData;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ text: 'test' }),
        text: async () => '{"text":"test"}',
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new WhisperCppStt({ baseUrl: 'http://localhost:9000', model: 'large-v3' });
    await client.transcribe(Buffer.from('x'), 'audio/wav');

    expect(capturedFormData).toBeDefined();
    // FormData.get is available in Node 20+
    expect((capturedFormData as any).get('model')).toBe('large-v3');
  });

  it('trims trailing whitespace from response text', async () => {
    vi.stubGlobal('fetch', makeOkFetch('\n Zdravo svet \n'));
    const client = new WhisperCppStt({ baseUrl: 'http://localhost:9000' });
    const result = await client.transcribe(Buffer.from('x'), 'audio/webm');
    expect(result).toBe('Zdravo svet');
  });

  it('uses default localhost:9000 when no baseUrl given', async () => {
    const mockFetch = makeOkFetch('hi');
    vi.stubGlobal('fetch', mockFetch);
    // Ensure env var not set
    delete process.env['WHISPER_CPP_URL'];

    const client = new WhisperCppStt();
    await client.transcribe(Buffer.from('x'), 'audio/webm');
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:9000/inference');
  });

  it('uses WHISPER_CPP_URL env variable when set', async () => {
    process.env['WHISPER_CPP_URL'] = 'http://192.168.1.5:9001';
    const mockFetch = makeOkFetch('hi');
    vi.stubGlobal('fetch', mockFetch);

    const client = new WhisperCppStt();
    await client.transcribe(Buffer.from('x'), 'audio/webm');
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://192.168.1.5:9001/inference');

    delete process.env['WHISPER_CPP_URL'];
  });

  it('throws a descriptive error when the server returns non-2xx', async () => {
    vi.stubGlobal('fetch', makeErrorFetch(500, 'Internal Server Error'));
    const client = new WhisperCppStt({ baseUrl: 'http://localhost:9000' });
    await expect(client.transcribe(Buffer.from('x'), 'audio/webm')).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it('throws when the server is unreachable', async () => {
    vi.stubGlobal('fetch', makeNetworkErrorFetch('ECONNREFUSED'));
    const client = new WhisperCppStt({ baseUrl: 'http://localhost:9000' });
    await expect(client.transcribe(Buffer.from('x'), 'audio/webm')).rejects.toThrow(
      /unreachable/,
    );
  });

  it('throws when response JSON is missing "text" field', async () => {
    vi.stubGlobal('fetch', makeBadJsonFetch());
    const client = new WhisperCppStt({ baseUrl: 'http://localhost:9000' });
    await expect(client.transcribe(Buffer.from('x'), 'audio/webm')).rejects.toThrow(
      /"text"/,
    );
  });

  it('returns an empty string when whisper returns empty text', async () => {
    vi.stubGlobal('fetch', makeOkFetch('   '));
    const client = new WhisperCppStt({ baseUrl: 'http://localhost:9000' });
    const result = await client.transcribe(Buffer.from('x'), 'audio/webm');
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Tests — audio_blob dispatch branch in ws handler
// ---------------------------------------------------------------------------

describe('handleClientMessage audio_blob', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  // Inline a minimal version of makeCtx from ws-dispatcher.test.ts so we
  // don't have to cross-import the full test helpers.
  async function dispatchAudioBlob(opts: {
    stt_backend: 'browser' | 'server';
    transcribeResult?: string;
    transcribeError?: string;
  }) {
    const { handleClientMessage } = await import('../src/server/ws.js');

    const sent: any[] = [];
    const fakeWhisper = {
      transcribe: opts.transcribeError
        ? vi.fn().mockRejectedValue(new Error(opts.transcribeError))
        : vi.fn().mockResolvedValue(opts.transcribeResult ?? 'transcribed text'),
    };

    const ctx: any = {
      send: (m: any) => sent.push(m),
      broadcast: () => {},
      sessions: {},
      getCfg: () => ({
        projects: [{
          id: 'proj-1',
          label: 'Project One',
          color: '#000000',
          sessions: [{
            id: 'sess-1',
            label: 'Session One',
            color: '#ff0000',
            project_dir: '/tmp',
            provider: 'subscription',
            stt_backend: opts.stt_backend,
          }],
        }],
      }),
      configPath: '',
      settings: {},
      updateSessionConfig: async () => {},
      peers: () => [],
      whisper: fakeWhisper,
    };

    await handleClientMessage(
      ctx,
      {
        type: 'audio_blob',
        session_id: 'sess-1',
        audio: Buffer.from('fake-audio').toString('base64'),
        mime: 'audio/webm',
      } as any,
    );

    return { sent, fakeWhisper };
  }

  it('calls whisper.transcribe and emits transcript message when stt_backend=server', async () => {
    const { sent, fakeWhisper } = await dispatchAudioBlob({
      stt_backend: 'server',
      transcribeResult: 'Dober dan',
    });
    expect(fakeWhisper.transcribe).toHaveBeenCalledOnce();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ type: 'transcript', session_id: 'sess-1', text: 'Dober dan' });
  });

  it('sends error when stt_backend is not server', async () => {
    const { sent, fakeWhisper } = await dispatchAudioBlob({ stt_backend: 'browser' });
    expect(fakeWhisper.transcribe).not.toHaveBeenCalled();
    expect(sent[0].type).toBe('error');
  });

  it('sends error when whisper.transcribe throws', async () => {
    const { sent } = await dispatchAudioBlob({
      stt_backend: 'server',
      transcribeError: 'ECONNREFUSED',
    });
    expect(sent[0].type).toBe('error');
    expect(sent[0].message).toContain('STT failed');
  });
});
