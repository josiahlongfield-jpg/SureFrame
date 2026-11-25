import { cookies } from "next/headers";
import type { Prisma, Video } from "@prisma/client";
import { db } from "@/lib/db";
import { storage, MIN_PART_BYTES } from "@/lib/storage";
import { HttpError } from "@/lib/session";
import { uploadBudget } from "@/lib/videos";
import { completeUpload } from "@/lib/uploadComplete";
import { clientCookie } from "@/lib/access";

/**
 * Server backup while recording. The recorder sends each few seconds of a recording (a "piece", already encrypted
 * on the device) as soon as it's made, so the server holds nearly all of it at any moment, not just the parts
 * finished so far. The server joins pieces into upload parts of exactly JOIN_BYTES (object storage refuses
 * parts of other sizes, bar the last) and deletes them once joined. Nothing is sent twice.
 *
 * If the recorder never finishes (the page closed, the phone died, a different browser opens the link later),
 * the server finishes the recording from what it has (salvage): when its author next opens SureFrame anywhere,
 * or from the daily clean-up. The browser that made it still finishes it first when it can, from its own copy.
 */

/** Part size the pieces are joined into. Smaller only in tests, to exercise joining mid-recording. */
export const JOIN_BYTES = Number(process.env.UPLOAD_JOIN_BYTES) || MIN_PART_BYTES;
/** Far more than a few seconds at the highest quality (4K is about 4 MB per 2 seconds). */
export const MAX_PIECE_BYTES = 32 * 1024 * 1024;
/** How long a recording must have been silent before someone else's browser may finish it. */
export const SALVAGE_AFTER_MS = 90_000;
/** Said with a 503 when a recording can't be finished this moment; the recorder tries again by itself (it retries every 5xx). */
const STILL_JOINING = "This recording is still being put together. Trying again shortly.";

export const pieceKey = (videoId: string, seq: number) => `pieces/${videoId}/${seq}`;

/**
 * Notes a piece the recorder is about to store (or has stored), and keeps the recording's last-heard time. False
 * when it's already joined into a part (sent again after a crash): then it isn't stored again.
 */
export async function registerPiece(video: Video, seq: number, offset: number, size: number, durationMs: number) {
  if (video.status !== "RECORDING") throw new HttpError(409, "Upload already completed");
  if (!Number.isInteger(seq) || seq < 0 || seq > 1_000_000) throw new HttpError(400, "Bad piece number");
  if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, "Bad offset");
  if (!Number.isInteger(size) || size < 1) throw new HttpError(400, "Empty piece");
  if (size > MAX_PIECE_BYTES) throw new HttpError(413, "Piece too large");
  const budget = await uploadBudget(video);
  if (offset + size > budget) throw new HttpError(413, "This recording is larger than your plan allows.");
  // Only pieces not yet joined can be (re)sent; an earlier one is already safely in a part.
  if (offset + size <= video.partsJoined * JOIN_BYTES) return false;
  // Where a piece says it sits doesn't bound what is stored (any number of pieces could claim the same place), so
  // what the recording already holds counts too: the joined parts, plus every other piece still waiting, each for
  // what lies past the joined parts (one running across a join is partly in a part already). For a recording sent
  // in order this adds up to the same figure as the check above. This piece, when sent again, is left out.
  const joined = video.partsJoined * JOIN_BYTES;
  const [waiting] = await db.$queryRaw<{ bytes: number }[]>`
    SELECT COALESCE(SUM(LEAST("sizeBytes", GREATEST(0, "offset" + "sizeBytes" - ${BigInt(joined)}))), 0)::float8 AS "bytes"
    FROM "UploadPiece" WHERE "videoId" = ${video.id} AND "seq" <> ${seq}`;
  if (joined + (waiting?.bytes ?? 0) + Math.min(size, offset + size - joined) > budget)
    throw new HttpError(413, "This recording is larger than your plan allows.");
  await db.uploadPiece.upsert({
    where: { videoId_seq: { videoId: video.id, seq } },
    create: { videoId: video.id, seq, offset: BigInt(offset), sizeBytes: size },
    update: { offset: BigInt(offset), sizeBytes: size },
  });
  await db.video.update({
    where: { id: video.id },
    data: {
      piecesAt: new Date(),
      ...(Number.isFinite(durationMs) && durationMs > (video.recordedMs ?? 0)
        ? { recordedMs: Math.round(durationMs) }
        : {}),
    },
  });
  return true;
}

/** Whether a piece ending here completes a part not yet joined (pieces arrive in order), so joining is worth a try. */
export const partReady = (video: Pick<Video, "partsJoined">, offset: number, size: number) =>
  offset + size - video.partsJoined * JOIN_BYTES >= JOIN_BYTES;

type Row = { seq: number; offset: bigint; sizeBytes: number };

/**
 * Joins stored pieces into upload parts: every whole part that's ready, and with `final` the rest as the last part.
 * One joiner at a time per recording; with `final` it waits its turn, otherwise it leaves the work to the one
 * running. A piece that isn't stored yet ends the run (it's being uploaded). When finishing, a piece that never
 * arrived ends the recording there: what came before it plays.
 */
export async function joinParts(videoId: string, final = false) {
  const lockFor = 120_000;
  for (let waited = 0; ; waited += 500) {
    const now = new Date();
    const { count } = await db.video.updateMany({
      where: {
        id: videoId,
        status: "RECORDING",
        OR: [{ joinLockUntil: null }, { joinLockUntil: { lt: now } }],
      },
      data: { joinLockUntil: new Date(now.getTime() + lockFor) },
    });
    if (count) break;
    if (!final) return;
    const v = await db.video.findUnique({
      where: { id: videoId },
      select: { status: true },
    });
    if (v?.status !== "RECORDING") return;
    // The joiner before this one never let go (its server function was cut off mid-join): the recording must not be
    // finished without the pieces it was joining. Whoever asked tries again, by when the lock has run out.
    if (waited >= 60_000) throw new HttpError(503, STILL_JOINING);
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    await joinLocked(videoId, final);
  } finally {
    await db.video.updateMany({
      where: { id: videoId },
      data: { joinLockUntil: null },
    });
  }
}

async function joinLocked(videoId: string, final: boolean) {
  const driver = storage();
  for (;;) {
    const video = await db.video.findUnique({ where: { id: videoId } });
    if (!video || video.status !== "RECORDING") return;
    const part = video.partsJoined + 1;
    const start = BigInt(video.partsJoined) * BigInt(JOIN_BYTES);
    const rows: Row[] = await db.uploadPiece.findMany({
      where: { videoId },
      orderBy: { seq: "asc" },
      select: { seq: true, offset: true, sizeBytes: true },
    });
    // The unbroken run of pieces from where the next part starts.
    const run: Row[] = [];
    let end = start;
    for (const r of rows) {
      const rEnd = r.offset + BigInt(r.sizeBytes);
      if (rEnd <= start) continue;
      if (r.offset > end) break;
      run.push(r);
      end = rEnd;
    }
    const ready = end - start;
    if (ready <= BigInt(0) || (!final && ready < BigInt(JOIN_BYTES))) return;
    const take = ready < BigInt(JOIN_BYTES) ? Number(ready) : JOIN_BYTES;
    const stop = start + BigInt(take);

    const bytes: Buffer[] = [];
    let lost: Row | null = null;
    for (const r of run) {
      if (r.offset >= stop) break;
      const body = await driver.getObject(pieceKey(videoId, r.seq));
      if (!body || body.length !== r.sizeBytes) {
        lost = r;
        break;
      }
      const from = Number(start > r.offset ? start - r.offset : BigInt(0));
      const to = Math.min(r.sizeBytes, Number(stop - r.offset));
      bytes.push(body.subarray(from, to));
    }
    if (lost) {
      // Still on its way up while recording: try again later.
      if (!final) return;
      // Finishing, and it never arrived: the recording ends where it would have started.
      console.error(
        JSON.stringify({
          level: "error",
          where: "joinParts",
          videoId,
          lostPiece: lost.seq,
        }),
      );
      await dropFrom(videoId, rows.filter((r) => r.seq >= lost!.seq));
      continue;
    }
    const body = Buffer.concat(bytes);
    const etag = await driver.putPart(video.storageKey, video.uploadId, part, new Uint8Array(body));
    await db.uploadPart.upsert({
      where: { videoId_partNumber: { videoId, partNumber: part } },
      create: { videoId, partNumber: part, etag, sizeBytes: body.length },
      update: { etag, sizeBytes: body.length },
    });
    await db.video.updateMany({ where: { id: videoId, partsJoined: part - 1 }, data: { partsJoined: part } });
    // Pieces wholly inside joined parts go; one running on into the next part stays for it.
    await dropFrom(videoId, rows.filter((r) => r.offset + BigInt(r.sizeBytes) <= stop));
    if (take < JOIN_BYTES) return;
  }
}

/** Deletes pieces, stored file first, then the note of it. */
async function dropFrom(videoId: string, rows: { seq: number }[]) {
  const driver = storage();
  await Promise.all(rows.map((r) => driver.delete(pieceKey(videoId, r.seq)).catch(() => {})));
  if (rows.length)
    await db.uploadPiece.deleteMany({
      where: { videoId, seq: { in: rows.map((r) => r.seq) } },
    });
}

/** Deletes what is still stored of a recording that is being removed (lib/retention.ts). The daily sweep below takes any rest. */
export async function dropPieces(videoId: string, max = 2000) {
  await dropFrom(videoId, await db.uploadPiece.findMany({ where: { videoId }, select: { seq: true }, take: max }));
}

/**
 * Whether a stored piece carries straight on from the joined parts, so that a join would take it (the same test as
 * joinLocked's). Never once a short last part has been written: nothing can follow that.
 */
async function pieceWaiting(video: Pick<Video, "id" | "partsJoined">) {
  const end = BigInt(video.partsJoined) * BigInt(JOIN_BYTES);
  if (video.partsJoined > 0) {
    const last = await db.uploadPart.findUnique({
      where: { videoId_partNumber: { videoId: video.id, partNumber: video.partsJoined } },
      select: { sizeBytes: true },
    });
    if (last?.sizeBytes !== JOIN_BYTES) return false;
  }
  // The first piece, in order, that isn't wholly inside the joined parts (none of those can start further back than this).
  const rows = await db.uploadPiece.findMany({
    where: { videoId: video.id, offset: { gt: end - BigInt(MAX_PIECE_BYTES) } },
    orderBy: { seq: "asc" },
    select: { offset: true, sizeBytes: true },
    take: 50,
  });
  const next = rows.find((r) => r.offset + BigInt(r.sizeBytes) > end);
  return !!next && next.offset <= end;
}

/**
 * Joins whatever is left and finishes the recording from the server's copy. 409 when there is nothing to finish it
 * from; 503 when it can't be finished this moment (the recorder then tries again by itself).
 */
export async function finishFromPieces(video: Video, durationMs?: number) {
  // Nothing to finish from (nothing joined, and no piece a join would take): said without taking the join lock.
  // Taking it touches the recording, and one that the daily clean-up below touches every day would never be a week
  // untouched, which is when it's removed (lib/retention.ts abortStaleUploads). The pieces are looked at first: a
  // join under way counts its part before it deletes that part's pieces.
  if (!(await pieceWaiting({ id: video.id, partsJoined: 0 }))) {
    const fresh = await db.video.findUnique({ where: { id: video.id }, select: { status: true, partsJoined: true } });
    if (fresh?.status === "RECORDING" && fresh.partsJoined === 0) throw new HttpError(409, "Nothing was recorded");
  }
  await joinParts(video.id, true);
  const now = await db.video.findUniqueOrThrow({ where: { id: video.id } });
  if (now.status !== "RECORDING") return now;
  // A piece arrived while the last join ran: finishing now would leave it out.
  if (await pieceWaiting(now)) throw new HttpError(503, STILL_JOINING);
  if (now.partsJoined === 0) throw new HttpError(409, "Nothing was recorded");
  // A length of 0 means the recorder couldn't tell (it had stopped by itself): the length noted with its last piece is better.
  return completeUpload(now, now.partsJoined, Math.round(durationMs || now.recordedMs || 0));
}

/**
 * Recordings that stopped sending pieces at least `silentMs` ago: the ones the server may finish. Not while uploads
 * are refused (lib/videos.ts uploadableVideo, lib/retention.ts abortStaleUploads): the recording waits until access
 * comes back, and nobody is told about it meanwhile.
 */
const abandoned = (silentMs: number): Prisma.VideoWhereInput => ({
  status: "RECORDING",
  piecesAt: { lt: new Date(Date.now() - silentMs) },
  workspace: { suspendedAt: null, closedAt: null, deleteAt: null },
  owner: { suspendedAt: null },
  NOT: [
    { asReply: { authorUser: { suspendedAt: { not: null } } } },
    {
      asReply: {
        video: {
          client: {
            OR: [{ linkDisabledAt: { not: null } }, { removedAt: { not: null } }, { pausedAt: { not: null } }],
          },
        },
      },
    },
  ],
});

/**
 * Finishes the recordings this person left unfinished in another browser (or this one, before its copy was lost):
 * their own videos and replies when signed in, and their replies as a client on this device. `local` are the
 * ones this browser still has a copy of; it finishes those itself, more completely.
 */
export async function salvageFor(userId: string | null, local: string[]) {
  const who: Prisma.VideoWhereInput[] = [];
  if (userId) who.push({ replyToId: null, ownerId: userId }, { asReply: { authorUserId: userId } });
  const jar = await cookies();
  const tokens = jar
    .getAll()
    .filter((c) => c.name.startsWith(clientCookie("")))
    .map((c) => c.value);
  if (tokens.length) {
    const clients = await db.client.findMany({
      where: { token: { in: tokens } },
      select: { id: true },
    });
    if (clients.length)
      who.push({
        asReply: {
          byClient: true,
          video: { clientId: { in: clients.map((c) => c.id) } },
        },
      });
  }
  if (!who.length) return { recovered: [], retryInMs: null };
  const theirs = { id: { notIn: local }, OR: who };
  const found = await db.video.findMany({ where: { AND: [abandoned(SALVAGE_AFTER_MS), theirs] }, take: 10 });
  const done: { videoId: string; replyTo: string | null }[] = [];
  for (const v of found) {
    try {
      const out = await finishFromPieces(v);
      if (out.status !== "RECORDING") done.push({ videoId: v.id, replyTo: v.replyToId });
    } catch (err) {
      if (!(err instanceof HttpError))
        console.error(
          JSON.stringify({
            level: "error",
            where: "salvageFor",
            videoId: v.id,
            message: String((err as Error)?.message ?? err),
          }),
        );
    }
  }
  // One that stopped only moments ago: the page asks again once it may be finished (or carries on, if it's still going).
  const recent = await db.video.findFirst({
    where: { AND: [abandoned(0), theirs, { piecesAt: { gte: new Date(Date.now() - SALVAGE_AFTER_MS) } }] },
    orderBy: { piecesAt: "asc" },
    select: { piecesAt: true },
  });
  const quietMs = recent?.piecesAt ? Date.now() - recent.piecesAt.getTime() : null;
  const retryInMs = quietMs !== null ? Math.max(0, SALVAGE_AFTER_MS - quietMs) + 2000 : null;
  return { recovered: done, retryInMs, quietMs };
}

/**
 * Daily: finishes recordings left silent for hours (nobody came back to them), so a phone that died mid-recording
 * still leaves the recording in the library, or the reply waiting for its author to send. Then sweeps pieces
 * whose recording is gone or done.
 */
export async function salvageAbandoned(budgetMs = 60_000) {
  const until = Date.now() + budgetMs;
  const found = await db.video.findMany({
    where: abandoned(6 * 3600_000),
    take: 100,
    orderBy: { piecesAt: "asc" },
  });
  let finished = 0;
  for (const v of found) {
    if (Date.now() > until) break;
    const out = await finishFromPieces(v).catch(() => null);
    if (out && out.status !== "RECORDING") finished++;
  }
  // Pieces outliving their recording: deleted, abandoned for good, or finished while one was still arriving. Only
  // those are picked, oldest first, so the pieces of recordings still open can't fill the batch and leave it nothing to do.
  const stale = await db.$queryRaw<{ videoId: string; seq: number }[]>`
    SELECT p."videoId", p."seq" FROM "UploadPiece" p LEFT JOIN "Video" v ON v."id" = p."videoId"
    WHERE p."createdAt" < ${new Date(Date.now() - 86_400_000)} AND (v."id" IS NULL OR v."status" <> 'RECORDING')
    ORDER BY p."createdAt" LIMIT 2000`;
  const byVideo = new Map<string, { seq: number }[]>();
  for (const p of stale) byVideo.set(p.videoId, [...(byVideo.get(p.videoId) ?? []), p]);
  for (const [videoId, rows] of byVideo) await dropFrom(videoId, rows);
  return {
    finished,
    swept: [...byVideo.values()].reduce((n, r) => n + r.length, 0),
  };
}
