import type { Prisma, Reply, Video } from "@prisma/client";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import type { Viewer } from "@/lib/access";
import { HELD_REPLY_DAYS } from "@/lib/heldReplies";
import { FORMER_MEMBER } from "@/lib/team";

export type ReplyDTO = {
  id: string;
  kind: "TEXT" | "VIDEO" | "AUDIO";
  /** Ciphertext when `encrypted`, sealed with the conversation's video key. */
  body: string | null;
  encrypted: boolean;
  timestampMs: number | null;
  authorName: string;
  /** Written by the person who sent the video (as opposed to the viewer replying). */
  fromOwner: boolean;
  /** Written by someone on the business's team (anyone signed in), rather than the client. */
  fromTeam: boolean;
  /** Written by whoever is looking: shown on their side of the chat, never counted as unread, and theirs to delete. */
  mine: boolean;
  /** A video or voice reply its author hasn't sent yet (only ever shown to them). */
  held: boolean;
  /** When an unsent reply is deleted if its author still hasn't sent it (purgeHeldReplies). */
  heldUntil: string | null;
  createdAt: string;
  media: { id: string; url: string; mimeType: string; durationMs: number | null; parentKeyWrap: string | null; expired: boolean } | null;
};

/** Whose replies count as the viewer's own: a team member's are theirs; a client's are every reply not from the team. */
export type ReplyViewer = { userId: string | null };
export const replyViewer = (v: Viewer): ReplyViewer => ({ userId: v.kind === "member" ? v.userId : null });

export function replyDTO(r: Reply & { media: Video | null }, ownerId: string, viewer: ReplyViewer): ReplyDTO {
  // Written by someone who has left the team: it moved to the owner, but it's neither theirs nor named.
  const former = !!r.formerStaffAt;
  return {
    id: r.id,
    kind: r.kind,
    body: r.body,
    encrypted: r.encrypted,
    timestampMs: r.timestampMs,
    authorName: former ? FORMER_MEMBER : r.authorName,
    fromOwner: !former && !!r.authorUserId && r.authorUserId === ownerId,
    fromTeam: !!r.authorUserId,
    mine: viewer.userId ? !former && r.authorUserId === viewer.userId : r.byClient,
    held: !!r.heldAt,
    heldUntil: r.heldAt ? new Date(r.heldAt.getTime() + HELD_REPLY_DAYS * 86_400_000).toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    media: r.media
      ? {
          id: r.media.id,
          url: `/api/videos/${r.media.id}/stream`,
          mimeType: r.media.mimeType,
          durationMs: r.media.durationMs,
          parentKeyWrap: r.media.parentKeyWrap,
          expired: r.media.status === "EXPIRED",
        }
      : null,
  };
}

/** A media reply only appears in the conversation once its upload has finished and its author has sent it. */
export const visibleReplies = {
  heldAt: null,
  OR: [{ kind: "TEXT" as const }, { media: { status: { not: "RECORDING" as const } } }],
} satisfies Prisma.ReplyWhereInput;

/** The viewer's own video and voice replies, uploaded but not sent yet: they choose to send or delete each one. */
export const heldRepliesOf = (viewer: ReplyViewer) =>
  ({
    heldAt: { not: null },
    authorUserId: viewer.userId,
    // A former team member's unsent replies moved to the owner with the rest; they were never theirs to send.
    formerStaffAt: null,
    media: { status: { notIn: ["RECORDING" as const, "EXPIRED" as const] } },
  }) satisfies Prisma.ReplyWhereInput;

/**
 * Deletes a reply and, for a video or voice reply, its recording. The rows go first so a storage hiccup
 * can't leave a reply that looks deleted but isn't; a file left behind is logged, and it can't be read
 * without the key that went with the row (the same order as deleting a video, api/videos/[id]).
 */
export async function deleteReply(reply: Reply & { media: Video | null }) {
  await db.reply.delete({ where: { id: reply.id } });
  const media = reply.media;
  if (!media) return;
  await db.video.deleteMany({ where: { id: media.id } });
  try {
    if (media.status === "RECORDING") await storage().abort(media.storageKey, media.uploadId);
    else if (media.status !== "EXPIRED") await storage().delete(media.storageKey);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: "[replies] file left after delete", reply: reply.id, error: (err as Error)?.message }));
  }
}

/**
 * Deletes video and voice replies their authors never sent, {@link HELD_REPLY_DAYS} days after they were
 * recorded, with their recordings. Nobody else ever saw them. Kept while the workspace is on legal hold
 * (lib/support/admin.ts). Works through the backlog until done or out of time; one that fails is retried next run.
 */
export async function purgeHeldReplies(now = new Date(), budgetMs = 40_000) {
  const until = Date.now() + budgetMs;
  const cutoff = new Date(now.getTime() - HELD_REPLY_DAYS * 86_400_000);
  const failed: string[] = [];
  let purged = 0;
  while (Date.now() < until) {
    const due = await db.reply.findMany({
      where: { heldAt: { lte: cutoff }, video: { workspace: { legalHoldAt: null } }, id: { notIn: failed } },
      include: { media: true },
      take: 100,
    });
    if (!due.length) break;
    for (const reply of due) {
      try {
        await deleteReply(reply);
        purged++;
      } catch (err) {
        failed.push(reply.id);
        console.error(JSON.stringify({ level: "error", message: "[replies] couldn't delete an unsent reply", reply: reply.id, error: (err as Error)?.message }));
      }
    }
  }
  return purged;
}
