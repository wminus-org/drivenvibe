/**
 * Minimal client for a running whisper.cpp HTTP server.
 *
 * The user is expected to launch the server binary themselves (sidecar
 * auto-spawn is tracked separately). Default endpoint:
 *   POST http://localhost:9000/inference
 *
 * The server accepts multipart/form-data with an "audio_file" field and
 * returns JSON like { text: "recognized text" }.
 *
 * Configuration (via server environment or explicit constructor options):
 *   WHISPER_CPP_URL   — base URL of the whisper.cpp server (default: http://localhost:9000)
 *   WHISPER_CPP_MODEL — model name passed in the form data (optional, default: "whisper-1")
 */

export interface WhisperCppOptions {
  /** Base URL of the whisper.cpp server, e.g. "http://localhost:9000". */
  baseUrl?: string;
  /** Model identifier forwarded in the multipart "model" field. */
  model?: string;
}

export class WhisperCppStt {
  private readonly inferenceUrl: string;
  private readonly model: string;

  constructor(opts: WhisperCppOptions = {}) {
    const base = (opts.baseUrl ?? process.env['WHISPER_CPP_URL'] ?? 'http://localhost:9000').replace(/\/$/, '');
    this.inferenceUrl = `${base}/inference`;
    this.model = opts.model ?? process.env['WHISPER_CPP_MODEL'] ?? 'whisper-1';
  }

  /**
   * POST audio to whisper.cpp and return the recognized transcript.
   *
   * @param audio - Raw audio bytes (e.g. from base64 decode of an audio_blob message).
   * @param mime  - MIME type of the audio, e.g. "audio/webm" or "audio/wav".
   * @returns The recognized text (trimmed). Empty string if whisper returned nothing.
   * @throws Error if the HTTP request fails or the response is not valid JSON with a `text` field.
   */
  async transcribe(audio: Buffer, mime: string): Promise<string> {
    const formData = new FormData();

    // Copy bytes into a plain Uint8Array backed by a guaranteed ArrayBuffer so
    // TypeScript doesn't complain about Buffer's ArrayBufferLike (SharedArrayBuffer
    // is also assignable there, which Blob doesn't accept).
    const blob = new Blob([new Uint8Array(audio)], { type: mime });
    formData.append('audio_file', blob, 'audio');
    formData.append('model', this.model);
    // Ask for a plain-text response body format so there is no extra JSON nesting.
    formData.append('response_format', 'json');

    let response: Response;
    try {
      response = await fetch(this.inferenceUrl, {
        method: 'POST',
        body: formData,
      });
    } catch (cause) {
      throw new Error(
        `whisper.cpp server unreachable at ${this.inferenceUrl}: ${(cause as Error).message}`,
        { cause },
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `whisper.cpp server returned HTTP ${response.status}: ${body.slice(0, 200)}`,
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (cause) {
      throw new Error('whisper.cpp server returned non-JSON response', { cause });
    }

    if (
      json === null ||
      typeof json !== 'object' ||
      !('text' in json) ||
      typeof (json as Record<string, unknown>)['text'] !== 'string'
    ) {
      throw new Error(
        `whisper.cpp server response missing "text" field: ${JSON.stringify(json).slice(0, 200)}`,
      );
    }

    return ((json as Record<string, string>)['text']).trim();
  }
}
