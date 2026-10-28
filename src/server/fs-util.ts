import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export interface WriteJsonOpts {
  /** Create the parent directory (recursively) before writing. */
  mkdir?: boolean;
  /** Best-effort permission bits applied after write (no-op on Windows). */
  mode?: number;
}

/**
 * Atomically write `data` as pretty JSON: write to a sibling temp file, then
 * rename over the target so a crash mid-write can never leave a partial file.
 */
export async function writeJsonAtomic(p: string, data: unknown, opts: WriteJsonOpts = {}): Promise<void> {
  const dir = path.dirname(p);
  if (opts.mkdir) await fs.mkdir(dir, { recursive: true });

  const json = JSON.stringify(data, null, 2);
  if (json === undefined) {
    throw new TypeError(`Cannot serialize undefined as JSON for ${p}`);
  }

  // A fixed `${p}.tmp` name makes simultaneous writers race: one rename can
  // steal the other writer's temporary file, or an older write can land last.
  // A unique sibling also makes cleanup safe after a failed write.
  const tmp = path.join(dir, `.${path.basename(p)}.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(tmp, 'wx', opts.mode ?? 0o666);
    await handle.writeFile(json, 'utf8');
    // Flush file contents before publishing the rename. This is intentionally
    // stronger than fs.writeFile: state/config corruption after a power loss is
    // much more expensive than these infrequent writes.
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tmp, p);

    if (opts.mode !== undefined) {
      // The create mode is subject to umask; chmod gives sensitive stores the
      // exact requested permissions on POSIX (and is harmless on Windows).
      try { await fs.chmod(p, opts.mode); } catch { /* best-effort */ }
    }

    // Best-effort directory fsync makes the rename durable on POSIX. Some
    // platforms (notably Windows) do not allow syncing directory handles.
    try {
      const dirHandle = await fs.open(dir, 'r');
      try { await dirHandle.sync(); } finally { await dirHandle.close(); }
    } catch { /* best-effort */ }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(tmp).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
}

/**
 * Read and parse a JSON file. Returns `fallback` when the file does not exist;
 * throws a descriptive error (naming the file) when it exists but is malformed.
 */
export async function readJsonOrDefault<T>(p: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(p, 'utf-8');
  } catch (e: any) {
    if (e?.code === 'ENOENT') return fallback;
    throw e;
  }
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as T;
  } catch (e: any) {
    throw new Error(`Malformed JSON in ${p}: ${e?.message ?? e}`);
  }
}
