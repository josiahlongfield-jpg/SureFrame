import { reportClientError } from "@/lib/clientError";
import * as store from "./store";

/**
 * Bytes per upload part. 5 MiB is S3's minimum; deployments that send parts
 * through a serverless function with a smaller request limit (Vercel: 4.5 MB)
 * set a lower value at build time (see next.config.ts).
 */
export const PART_BYTES = Number(process.env.NEXT_PUBLIC_UPLOAD_PART_BYTES) || 5 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `unsaved`: this browser couldn't keep a local copy (storage full), so a crash now would lose what isn't uploaded yet. */
export type UploadState = { uploadedBytes: number; bufferedBytes: number; retrying: boolean; error?: string; unsaved?: boolean };

async function withRetry<T>(fn: () => Promise<T>, onRetry: (retrying: boolean) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await fn();
      if (attempt > 0) onRetry(false);
      return out;
    } catch (err) {
      if (err instanceof FatalUploadError) throw err;
      onRetry(true);
      // 1s, 2s, 4s ... capped at 30s. Keeps going while offline; chunks are safe in IndexedDB.
      await sleep(Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
    }
  }
}

/** The server refused the upload. `status` is the HTTP status, when there was one. */
export class FatalUploadError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/**
 * Refusals that can clear up on their own: signed out (401), access paused or
 * suspended, or another account signed in (403/404). The local copy is kept
 * and tried again. After KEEP_FOR_MS it's dropped once the server says the
 * upload is gone (404): the server keeps one waiting while access is refused
 * (see retention.ts), however long that takes.
 */
const KEEP_FOR_MS = 8 * 86_400_000;
export const mayRecover = (err: unknown) => err instanceof FatalUploadError && [401, 403, 404].includes(err.status ?? 0);

/** Set at build time when videos go straight to object storage (see next.config.ts). */
const DIRECT = process.env.NEXT_PUBLIC_DIRECT_UPLOADS === "1";

async function rejectOrRetry(res: Response, what: string): Promise<never> {
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    throw new FatalUploadError((await res.json().catch(() => null))?.error ?? `${what} rejected (${res.status})`, res.status);
  }
  throw new Error(`${what} failed (${res.status})`);
}

async function sendPart(videoId: string, partNumber: number, body: Blob, headers: Record<string, string>) {
  const api = `/api/videos/${videoId}/parts/${partNumber}`;
  if (DIRECT) {
    // Ask for a one-off URL, then upload the (already encrypted) bytes straight to storage.
    const res = await fetch(api, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ size: body.size }) });
    if (!res.ok) await rejectOrRetry(res, "Upload");
    const { url } = (await res.json()) as { url: string | null };
    if (url) {
      // A storage error (expired URL, network) is always retried with a fresh URL.
      const put = await fetch(url, { method: "PUT", body });
      if (!put.ok) throw new Error(`Storage upload failed (${put.status})`);
      return;
    }
  }
  const res = await fetch(api, { method: "PUT", body, headers });
  if (!res.ok) await rejectOrRetry(res, "Upload");
}

async function sendComplete(videoId: string, partCount: number, durationMs: number, headers: Record<string, string>) {
  const res = await fetch(`/api/videos/${videoId}/complete`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ partCount, durationMs }),
  });
  if (!res.ok) await rejectOrRetry(res, "Finishing the upload");
}

/** A stored chunk, or what's left of one: `offset` bytes of it went into earlier parts. */
type Piece = { seq: number; blob: Blob; offset: number };

/**
 * Streams a recording to the server while it is being made.
 * Chunks are persisted locally first, cut into parts of exactly PART_BYTES
 * (object storage such as R2 refuses an upload whose parts, bar the last,
 * differ in size; a chunk can straddle two parts), and sent strictly in order
 * with retries. A part is only forgotten locally once the server confirms it,
 * so a crash at any point loses nothing.
 */
export class ChunkedUploader {
  private seq = 0;
  private pending: Piece[] = [];
  private pendingBytes = 0;
  private nextPart: number;
  private queue: Promise<void> = Promise.resolve();
  private intake: Promise<void> = Promise.resolve();
  private uploadedBytes = 0;
  private fatal?: Error;
  private unsaved = false;
  private headers: Record<string, string>;

  constructor(
    private videoId: string,
    opts: { nextPart?: number; startSeq?: number; uploadToken?: string } = {},
    private onState: (s: UploadState) => void = () => {},
  ) {
    this.nextPart = opts.nextPart ?? 1;
    this.seq = opts.startSeq ?? 0;
    this.headers = opts.uploadToken ? { "x-upload-token": opts.uploadToken } : {};
  }

  /** Add a recorded chunk. Resolves once it is safely in IndexedDB. Chunks are kept in arrival order. */
  push(blob: Blob) {
    if (blob.size === 0) return this.intake;
    const seq = this.seq++;
    this.intake = this.intake.then(async () => {
      // If the local copy can't be written (storage full), keep going from memory:
      // the upload still has the chunk, only the crash safety net is gone.
      await store.putChunk(this.videoId, seq, blob).catch(this.lostLocalCopy);
      this.pending.push({ seq, blob, offset: 0 });
      this.pendingBytes += blob.size;
      this.emit(false);
      if (this.pendingBytes >= PART_BYTES) this.flush(false);
    });
    return this.intake;
  }

  /** Re-queue chunks already in IndexedDB (used by crash recovery), less the `skip` bytes of the first already sent. */
  restore(chunks: { seq: number; blob: Blob }[], skip = 0) {
    chunks.forEach((c, i) => {
      const offset = i === 0 ? Math.min(skip, c.blob.size) : 0;
      this.pending.push({ seq: c.seq, blob: offset ? c.blob.slice(offset) : c.blob, offset });
      this.pendingBytes += c.blob.size - offset;
      this.flush(false);
    });
  }

  /** Upload everything left and finalize. */
  async finish(durationMs: number) {
    await this.intake;
    this.flush(true);
    await this.queue;
    if (this.fatal) throw this.fatal;
    const partCount = this.nextPart - 1;
    if (partCount === 0) throw new FatalUploadError("Nothing was recorded");
    await withRetry(() => sendComplete(this.videoId, partCount, durationMs, this.headers), (r) => this.emit(r));
    await store.removeSession(this.videoId).catch(this.lostLocalCopy);
  }

  private lostLocalCopy = (err: unknown) => {
    console.warn("Couldn't update the local copy of the recording", err);
    this.unsaved = true;
  };

  /** Cuts off the next part: exactly PART_BYTES, or everything left when finishing. */
  private take(size: number) {
    const parts: Blob[] = [];
    let need = size;
    // Once this part is confirmed, the chunks it used up can go; a chunk split across
    // two parts stays, with how much of it is already up.
    let doneUpTo = -1;
    let skip = 0;
    while (need > 0) {
      const head = this.pending[0];
      if (head.blob.size <= need) {
        parts.push(head.blob);
        need -= head.blob.size;
        doneUpTo = head.seq;
        this.pending.shift();
      } else {
        parts.push(head.blob.slice(0, need));
        skip = head.offset + need;
        this.pending[0] = { seq: head.seq, blob: head.blob.slice(need), offset: skip };
        doneUpTo = head.seq - 1;
        need = 0;
      }
    }
    this.pendingBytes -= size;
    return { body: new Blob(parts), doneUpTo, skip };
  }

  private flush(final: boolean) {
    while (this.pendingBytes >= PART_BYTES || (final && this.pendingBytes > 0)) {
      this.send(this.take(Math.min(PART_BYTES, this.pendingBytes)));
    }
  }

  private send({ body, doneUpTo, skip }: { body: Blob; doneUpTo: number; skip: number }) {
    const partNumber = this.nextPart++;
    this.queue = this.queue.then(async () => {
      if (this.fatal) return;
      try {
        await withRetry(() => sendPart(this.videoId, partNumber, body, this.headers), (r) => this.emit(r));
        await store.confirmPart(this.videoId, doneUpTo, partNumber + 1, skip).catch(this.lostLocalCopy);
        this.uploadedBytes += body.size;
        this.emit(false);
      } catch (err) {
        this.fatal = err as Error;
        // Upload failures otherwise only show in the customer's browser.
        reportClientError("upload", err);
        this.onState({ uploadedBytes: this.uploadedBytes, bufferedBytes: this.pendingBytes, retrying: false, error: this.fatal.message, unsaved: this.unsaved });
      }
    });
  }

  private emit(retrying: boolean) {
    this.onState({ uploadedBytes: this.uploadedBytes, bufferedBytes: this.pendingBytes, retrying, unsaved: this.unsaved });
  }
}

/**
 * Finish any recordings interrupted by a crash or closed tab.
 * Leftover chunks are re-sent starting at the first unconfirmed part number,
 * which the server treats idempotently.
 */
export async function recoverInterrupted(onRecovered: (videoId: string, s: store.PendingSession) => void) {
  const sessions = await store.listSessions();
  for (const s of sessions) {
    // A recording still running in another tab holds this lock; leave it alone.
    await navigator.locks.request(lockName(s.videoId), { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      if (s.discarding && !s.stopped) {
        // They were about to discard it when the page closed: finish the discard, don't upload it (or use up a free video).
        const res = await fetch(`/api/videos/${s.videoId}`, { method: "DELETE" }).catch(() => null);
        if (res && (res.ok || res.status === 404)) await store.removeSession(s.videoId);
        return;
      }
      const chunks = await store.getChunks(s.videoId);
      try {
        const up = new ChunkedUploader(s.videoId, {
          nextPart: s.nextPart,
          startSeq: (chunks.at(-1)?.seq ?? -1) + 1,
          uploadToken: s.uploadToken,
        });
        up.restore(chunks, s.skip ?? 0);
        await up.finish(s.durationMs);
        onRecovered(s.videoId, s);
      } catch (err) {
        const stale = Date.now() - s.startedAt > KEEP_FOR_MS;
        if (err instanceof FatalUploadError && (!mayRecover(err) || (stale && err.status === 404))) await store.removeSession(s.videoId);
        else console.warn("Recovery deferred", s.videoId, err);
      }
    });
  }
}

export const lockName = (videoId: string) => `framecast-recording-${videoId}`;
