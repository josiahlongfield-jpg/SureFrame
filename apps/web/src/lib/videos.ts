import crypto from "node:crypto";
import { customAlphabet } from "nanoid";
import { db } from "@/lib/db";
import { ACCOUNT_SUSPENDED, HttpError, requireUser } from "@/lib/session";
import { clientBlock, clientGate } from "@/lib/access";
import { accessOf, visibleVideo } from "@/lib/permissions";

export const newVideoId = customAlphabet("23456789abcdefghijkmnpqrstuvwxyz", 12);

export const ALLOWED_MIME = /^(video\/(webm|mp4|quicktime)|audio\/(webm|mp4|ogg))(;.*)?$/;

export function extensionFor(mimeType: string) {
  if (mimeType.startsWith("video/mp4")) return "mp4";
  if (mimeType.startsWith("audio/mp4")) return "m4a";
  if (mimeType.startsWith("audio/ogg")) return "ogg";
  if (mimeType.startsWith("video/quicktime")) return "mov";
  return "webm";
}

export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export function newUploadToken() {
  const token = crypto.randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}

/**
 * Who may upload parts to a video: the team member recording it, or whoever
 * holds the one-time upload token issued when a reply was started (replies
 * always use one, a team member's too). Seeing a video isn't enough: a
 * colleague could otherwise overwrite or cut short someone else's recording.
 */
export async function uploadableVideo(req: Request, id: string) {
  const token = req.headers.get("x-upload-token");
  if (token) {
    const video = await db.video.findUnique({ where: { id } });
    const expected = video?.uploadTokenHash;
    const given = hashToken(token);
    if (!video || !expected || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) {
      throw new HttpError(404, "Video not found");
    }
    await requireReplyerAllowed(video.id);
    return video;
  }
  // A recording already under way finishes even if the terms changed meanwhile (lib/terms.ts).
  const me = await requireUser({ allowTermsPending: true });
  const video = await visibleVideo(accessOf(me), id);
  if (video.replyToId || video.ownerId !== me.user.id) throw new HttpError(403, "Only the person recording this can upload it");
  return video;
}

/**
 * A reply upload goes by its token alone, so the conversation is checked here:
 * nothing more arrives while support has the business's workspace suspended,
 * the replying client's link is off (or they're removed or paused), or the
 * replying team member's login is suspended (lib/support/admin.ts). 403, so the
 * recording stays on their device and carries on if access comes back.
 */
async function requireReplyerAllowed(mediaId: string) {
  const reply = await db.reply.findUnique({
    where: { mediaId },
    select: {
      authorUserId: true,
      authorUser: { select: { suspendedAt: true } },
      video: { select: { client: { select: { removedAt: true, pausedAt: true, linkDisabledAt: true, workspace: { select: clientGate } } }, workspace: { select: { name: true, ...clientGate } } } },
    },
  });
  if (!reply) return;
  const ws = reply.video.workspace;
  if (reply.authorUserId) {
    if (reply.authorUser?.suspendedAt || ws.suspendedAt || ws.closedAt) throw new HttpError(403, ACCOUNT_SUSPENDED, "ACCOUNT_SUSPENDED");
    return;
  }
  const c = reply.video.client;
  const block = c ? clientBlock(c) : "removed";
  if (block === "unavailable") throw new HttpError(403, `Videos from ${ws.name} are unavailable right now.`);
  if (block === "off") throw new HttpError(403, "This link has been turned off.");
  if (block) throw new HttpError(403, "You can't reply to this video right now.");
}

/** Public projection used by the watch page and API (BigInt is not JSON-safe). */
export function publicVideo(v: {
  id: string;
  title: string;
  status: string;
  mimeType: string;
  durationMs: number | null;
  sizeBytes: bigint;
  playbackUrl: string | null;
  thumbnailUrl: string | null;
  viewCount: number;
  createdAt: Date;
  encrypted: boolean;
  teamKeyWrap: string | null;
  clientKeyWrap: string | null;
  purgeAt: Date | null;
}) {
  return {
    id: v.id,
    title: v.title,
    status: v.status,
    mimeType: v.mimeType,
    durationMs: v.durationMs,
    sizeBytes: Number(v.sizeBytes),
    hlsUrl: v.playbackUrl,
    rawUrl: `/api/videos/${v.id}/stream`,
    thumbnailUrl: v.thumbnailUrl,
    viewCount: v.viewCount,
    createdAt: v.createdAt.toISOString(),
    encrypted: v.encrypted,
    teamKeyWrap: v.teamKeyWrap,
    clientKeyWrap: v.clientKeyWrap,
    purgeAt: v.purgeAt?.toISOString() ?? null,
  };
}

const GB = 1024 ** 3;
const REPLY_BUDGET = 0.7 * GB;
const FREE_BUDGET = 0.3 * GB;

/**
 * Most bytes of video and voice replies one conversation may take in a day.
 * Plenty for a real back-and-forth, but a ceiling on storage someone with a
 * link could fill.
 */
export async function replyBytesToday(conversationId: string) {
  const since = new Date(Date.now() - 86_400_000);
  // Replies still recording hold bytes too: in parts already joined, and in pieces waiting to be joined (lib/pieces.ts;
  // a piece running across a join is counted on both sides, which only errs towards the ceiling by one piece).
  const recording = (await db.video.findMany({ where: { replyToId: conversationId, status: "RECORDING", createdAt: { gt: since } }, select: { id: true } })).map((v) => v.id);
  const [done, open, pieces] = await Promise.all([
    db.video.aggregate({ where: { replyToId: conversationId, createdAt: { gt: since }, status: { not: "RECORDING" } }, _sum: { sizeBytes: true } }),
    db.uploadPart.aggregate({ where: { videoId: { in: recording } }, _sum: { sizeBytes: true } }),
    db.uploadPiece.aggregate({ where: { videoId: { in: recording } }, _sum: { sizeBytes: true } }),
  ]);
  return Number(done._sum.sizeBytes ?? 0) + Number(open._sum.sizeBytes ?? 0) + Number(pieces._sum.sizeBytes ?? 0);
}
export const REPLY_DAILY_BYTES = 3 * GB;

/**
 * Most bytes one upload may hold: generous for real recordings at the plan's
 * longest length and best quality, but a ceiling against filling storage.
 */
export async function uploadBudget(video: { id: string; replyToId: string | null; workspaceId: string }) {
  const w = await db.workspace.findUnique({ where: { id: video.workspaceId }, select: { plan: true } });
  const free = w?.plan === "FREE";
  if (video.replyToId) {
    // Replies are capped at 15 minutes: about 560 MB at the reply recorder's 1080p rate.
    if (!free) return REPLY_BUDGET;
    // The team's own replies on Free keep to 5 minutes (about 190 MB), like its videos.
    const reply = await db.reply.findUnique({ where: { mediaId: video.id }, select: { authorUserId: true } });
    return reply?.authorUserId ? FREE_BUDGET : REPLY_BUDGET;
  }
  // Free records 5 minutes at 720p (about 100 MB), so 300 MB leaves plenty of room.
  return free ? FREE_BUDGET : 40 * GB;
}

/** Refuse a part that would take the upload past its budget. Parts are recorded as they're accepted. */
export async function checkUploadBudget(video: { id: string; replyToId: string | null; workspaceId: string }, partNumber: number, size: number) {
  const others = await db.uploadPart.aggregate({ where: { videoId: video.id, partNumber: { not: partNumber } }, _sum: { sizeBytes: true } });
  if ((others._sum.sizeBytes ?? 0) + size > (await uploadBudget(video))) {
    throw new HttpError(413, "This recording is larger than your plan allows.");
  }
}
