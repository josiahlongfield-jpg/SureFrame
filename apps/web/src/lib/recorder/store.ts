/**
 * Crash-recovery buffer. Every MediaRecorder chunk lands here before it is
 * uploaded and is only removed once the server has confirmed it (or, for
 * recordings begun before pieces, the part that contains it). If the tab, browser or machine dies mid-recording, whatever
 * is left here is uploaded on the next visit.
 */

export type PendingSession = {
  videoId: string;
  title: string;
  mimeType: string;
  startedAt: number;
  /** Next multipart part number to send (parts before it are confirmed). */
  nextPart: number;
  /** Bytes at the start of the first stored chunk that already went up in a confirmed part. */
  skip?: number;
  durationMs: number;
  stopped: boolean;
  /** Guest replies upload with a one-time token instead of a session. */
  uploadToken?: string;
  /** For replies: the video being replied to. */
  replyTo?: string;
  /** "Discard this recording?" was open: if the page closes now, recovery deletes it instead of uploading it. */
  discarding?: boolean;
  /** Sent as pieces the server joins (lib/pieces.ts), not as parts cut here; nextPart and skip then go unused. */
  pieces?: boolean;
};

/** `offset`: where the chunk starts in the recording, in bytes (recordings sent as pieces). */
type ChunkRow = { videoId: string; seq: number; blob: Blob; offset?: number };

const DB_NAME = "framecast-recorder";
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("sessions", { keyPath: "videoId" });
      db.createObjectStore("chunks", { keyPath: ["videoId", "seq"] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const range = (videoId: string, fromSeq = 0, toSeq = Number.MAX_SAFE_INTEGER) =>
  IDBKeyRange.bound([videoId, fromSeq], [videoId, toSeq]);

export async function putSession(s: PendingSession) {
  const tx = (await open()).transaction("sessions", "readwrite");
  tx.objectStore("sessions").put(s);
  await done(tx);
}

export async function updateSession(videoId: string, patch: Partial<PendingSession>) {
  const tx = (await open()).transaction("sessions", "readwrite");
  const store = tx.objectStore("sessions");
  const cur = await request(store.get(videoId));
  if (cur) store.put({ ...cur, ...patch });
  await done(tx);
}

export async function listSessions(): Promise<PendingSession[]> {
  const tx = (await open()).transaction("sessions", "readonly");
  return request(tx.objectStore("sessions").getAll());
}

export async function putChunk(videoId: string, seq: number, blob: Blob, offset?: number) {
  const tx = (await open()).transaction("chunks", "readwrite");
  tx.objectStore("chunks").put({ videoId, seq, blob, offset } satisfies ChunkRow);
  await done(tx);
}

/** The server has this piece: the local copy of it can go. */
export async function confirmPiece(videoId: string, seq: number) {
  const tx = (await open()).transaction("chunks", "readwrite");
  tx.objectStore("chunks").delete([videoId, seq]);
  await done(tx);
}

export async function getChunks(videoId: string): Promise<ChunkRow[]> {
  const tx = (await open()).transaction("chunks", "readonly");
  return request(tx.objectStore("chunks").getAll(range(videoId)));
}

/**
 * Atomically drop confirmed chunks and advance the part counter. A chunk split
 * across two parts stays, with `skip` saying how much of it is already up.
 */
export async function confirmPart(videoId: string, upToSeq: number, nextPart: number, skip = 0) {
  const tx = (await open()).transaction(["chunks", "sessions"], "readwrite");
  if (upToSeq >= 0) tx.objectStore("chunks").delete(range(videoId, 0, upToSeq));
  const sessions = tx.objectStore("sessions");
  const cur = await request(sessions.get(videoId));
  if (cur) sessions.put({ ...cur, nextPart, skip });
  await done(tx);
}

export async function removeSession(videoId: string) {
  const tx = (await open()).transaction(["chunks", "sessions"], "readwrite");
  tx.objectStore("chunks").delete(range(videoId));
  tx.objectStore("sessions").delete(videoId);
  await done(tx);
}
