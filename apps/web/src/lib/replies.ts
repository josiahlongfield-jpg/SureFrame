import type { Prisma, Reply, Video } from "@prisma/client";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import type { Viewer } from "@/lib/access";

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
  createdAt: string;
  media: { id: string; url: string; mimeType: string; durationMs: number | null; parentKeyWrap: string | null; expired: boolean } | null;
};

/** Whose replies count as the viewer's own: a team member's are theirs; a client's are every reply not from the team. */
export type ReplyViewer = { userId: string | null };
export const replyViewer = (v: Viewer): ReplyViewer => ({ userId: v.kind === "member" ? v.userId : null });

export function replyDTO(r: Reply & { media: Video | null }, ownerId: string, viewer: ReplyViewer): ReplyDTO {
  return {
    id: r.id,
    kind: r.kind,
    body: r.body,
    encrypted: r.encrypted,
    timestampMs: r.timestampMs,
    authorName: r.authorName,
    fromOwner: !!r.authorUserId && r.authorUserId === ownerId,
    fromTeam: !!r.authorUserId,
    mine: viewer.userId ? r.authorUserId === viewer.userId : r.byClient,
    held: !!r.heldAt,
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
