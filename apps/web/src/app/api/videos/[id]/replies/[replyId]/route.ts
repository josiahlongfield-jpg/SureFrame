import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { deleteReply, replyDTO, replyViewer } from "@/lib/replies";
import { handle, HttpError } from "@/lib/session";
import { viewableVideo } from "@/lib/access";
import { limitByIp } from "@/lib/rateLimit";
import { notifyClientReply } from "@/lib/teamNotify";

type Ctx = { params: Promise<{ id: string; replyId: string }> };

/** A reply in this conversation written by whoever is asking (the client's are marked byClient). */
async function ownReply(ctx: Ctx) {
  const { id, replyId } = await ctx.params;
  const { video: root, viewer } = await viewableVideo(id);
  if (root.replyToId) throw new HttpError(404, "Video not found");
  const who = replyViewer(viewer);
  const reply = await db.reply.findFirst({ where: { id: replyId, videoId: id }, include: { media: true } });
  // Someone else's reply looks the same as no reply, so ids don't leak.
  if (!reply || (who.userId ? reply.authorUserId !== who.userId : !reply.byClient)) throw new HttpError(404, "Reply not found");
  return { root, viewer, who, reply };
}

const Patch = z.object({ send: z.literal(true) });

/** Sends a video or voice reply its author has reviewed: it appears in the conversation now, and the team hears about a client's. */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await limitByIp("reply-changes", 60, 300);
  if (!Patch.safeParse(await req.json().catch(() => null)).success) throw new HttpError(400, "Invalid request");
  const { root, viewer, who, reply } = await ownReply(ctx);
  if (!reply.heldAt) return Response.json({ reply: replyDTO(reply, root.ownerId, who) });
  if (!reply.media || reply.media.status === "RECORDING") throw new HttpError(409, "This reply is still uploading. Try again in a moment.");
  if (reply.media.status === "EXPIRED" || reply.media.status === "FAILED") throw new HttpError(410, "This recording didn't upload properly. Please record it again.");
  if (root.expiresAt && root.expiresAt < new Date()) throw new HttpError(410, "This link has expired");
  // Sent now, so it sits after anything said while it was being reviewed.
  const sent = await db.reply.update({ where: { id: reply.id }, data: { heldAt: null, createdAt: new Date() }, include: { media: true } });
  if (viewer.kind === "client") after(() => notifyClientReply(root.id));
  return Response.json({ reply: replyDTO(sent, root.ownerId, who) });
});

/** Deletes the asker's own reply (sent or not) for everyone, with its recording. */
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  await limitByIp("reply-changes", 60, 300);
  const { reply } = await ownReply(ctx);
  await deleteReply(reply);
  return new Response(null, { status: 204 });
});
