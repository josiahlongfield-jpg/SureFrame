import { after } from "next/server";
import { z } from "zod";
import type { Video } from "@prisma/client";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { handle, HttpError } from "@/lib/session";
import { purgeDate } from "@/lib/retention";
import { notifyClientReply } from "@/lib/teamNotify";
import { publicVideo, uploadableVideo, uploadBudget } from "@/lib/videos";
import { PLANS, replyMaxMinutes } from "@/lib/plans";
import { emailClientVideo } from "@/lib/emailClientVideo";

const Body = z.object({ partCount: z.number().int().min(1).max(10_000), durationMs: z.number().int().min(0) });

/** Finish the upload. Every part 1..partCount must be present. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = Body.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, "Invalid request");

  const video = await uploadableVideo(req, id);
  if (video.status !== "RECORDING") return Response.json({ video: publicVideo(video) }); // already done, idempotent

  // Parts uploaded straight to the bucket are only known to the bucket.
  const driver = storage();
  let parts: { partNumber: number; etag: string | null; sizeBytes: number | bigint }[];
  try {
    parts = driver.listParts
      ? (await driver.listParts(video.storageKey, video.uploadId)).sort((a, b) => a.partNumber - b.partNumber)
      : await db.uploadPart.findMany({ where: { videoId: id }, orderBy: { partNumber: "asc" } });
  } catch (err) {
    // An earlier try finished the upload in the bucket but its answer was lost: finish it here too.
    const size = (err as { name?: string })?.name === "NoSuchUpload" ? await driver.storedSize?.(video.storageKey) : null;
    if (size == null) throw err;
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: video.workspaceId } });
    return Response.json({ video: publicVideo(await finish(video, workspace.cloudBackup, body.data.durationMs, BigInt(size))) });
  }
  const have = new Set(parts.map((p) => p.partNumber));
  const missing: number[] = [];
  for (let n = 1; n <= body.data.partCount; n++) if (!have.has(n)) missing.push(n);
  if (missing.length) return Response.json({ error: "Missing parts", missing }, { status: 409 });

  const used = parts.filter((p) => p.partNumber <= body.data.partCount);
  // The browser stops at the plan's limits; this holds for anything that doesn't.
  const total = used.reduce((sum, p) => sum + Number(p.sizeBytes), 0);
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: video.workspaceId } });
  const maxMinutes = video.replyToId ? replyMaxMinutes(workspace.plan, await byTeam(id)) : PLANS[workspace.plan].maxDurationMin;
  const refusal =
    total > (await uploadBudget(video)) ? "This recording is larger than your plan allows."
    : body.data.durationMs > (maxMinutes * 60 + 30) * 1000 ? "This recording is longer than your plan allows."
    : null;
  if (refusal) {
    await driver.abort(video.storageKey, video.uploadId).catch(() => {});
    // Refused uploads are kept as EXPIRED and never use one of the Free plan's videos.
    await db.video.updateMany({ where: { id, status: "RECORDING" }, data: { status: "EXPIRED", uploadId: null, uploadTokenHash: null } });
    throw new HttpError(413, refusal);
  }
  await driver.complete(video.storageKey, video.uploadId, used);
  const updated = await finish(video, workspace.cloudBackup, body.data.durationMs, used.reduce((sum, p) => sum + BigInt(p.sizeBytes), BigInt(0)));
  return Response.json({ video: publicVideo(updated) });
});

/** Whether a reply's media was recorded by someone on the team (not the client). */
async function byTeam(mediaId: string) {
  const reply = await db.reply.findUnique({ where: { mediaId }, select: { authorUserId: true } });
  return !!reply?.authorUserId;
}

/** Marks the upload done and tells whoever is waiting for it. */
async function finish(video: Video, cloudBackup: boolean, durationMs: number, sizeBytes: bigint) {
  const id = video.id;
  const finished = await db.$transaction(async (tx) => {
    const { count } = await tx.video.updateMany({
      where: { id, status: "RECORDING" },
      data: {
        status: "UPLOADED",
        durationMs,
        sizeBytes,
        uploadId: null,
        uploadTokenHash: null, // a guest's token is single-use
        purgeAt: purgeDate(cloudBackup),
        emailClientWhenReady: false,
      },
    });
    // A finished original uses one of the Free plan's videos, on any plan, for good (lib/videoAllowance.ts).
    if (count && !video.replyToId && !video.sourceId) {
      await tx.workspace.update({ where: { id: video.workspaceId }, data: { videosRecorded: { increment: 1 } } });
    }
    return count > 0;
  });
  const updated = await db.video.findUniqueOrThrow({ where: { id } });
  // Another request finished it at the same time: it counted the video and tells whoever is waiting.
  if (!finished) return updated;
  await db.uploadPart.deleteMany({ where: { videoId: id } });
  // It was sent to a client while still uploading: tell them now it's ready.
  if (video.emailClientWhenReady && updated.clientId) after(() => emailClientVideo(id));
  // A client's video or voice reply has arrived: tell the person looking after them.
  if (updated.replyToId) {
    const reply = await db.reply.findUnique({ where: { mediaId: id }, select: { authorUserId: true, heldAt: true } });
    // One held for review is told about when its author sends it (api/videos/[id]/replies/[replyId]).
    if (reply && !reply.authorUserId && !reply.heldAt) after(() => notifyClientReply(updated.replyToId!));
  }
  return updated;
}
