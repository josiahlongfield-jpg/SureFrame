import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { heldRepliesOf, replyDTO, replyViewer, visibleReplies } from "@/lib/replies";
import { handle, HttpError } from "@/lib/session";
import { viewableVideo } from "@/lib/access";
import { ALLOWED_MIME, extensionFor, newUploadToken, newVideoId, REPLY_DAILY_BYTES, replyBytesToday } from "@/lib/videos";
import { limitByIp } from "@/lib/rateLimit";
import { notifyClientReply } from "@/lib/teamNotify";
import { replyMaxMinutes } from "@/lib/plans";

const Body = z.discriminatedUnion("kind", [
  // Text arrives already sealed with the conversation's video key.
  z.object({ kind: z.literal("TEXT"), body: z.string().min(1).max(8000), encrypted: z.literal(true), timestampMs: z.number().int().min(0).optional() }),
  // Media key wrapped with the conversation's video key.
  // `review`: held back once uploaded until its author sends it (api/videos/[id]/replies/[replyId]).
  z.object({ kind: z.enum(["VIDEO", "AUDIO"]), mimeType: z.string().max(120).regex(ALLOWED_MIME), parentKeyWrap: z.string().min(40).max(200), review: z.boolean().optional() }),
]);

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { video: root, viewer } = await viewableVideo(id);
  const who = replyViewer(viewer);
  const [replies, held] = await Promise.all([
    db.reply.findMany({ where: { videoId: id, ...visibleReplies }, orderBy: { createdAt: "asc" }, include: { media: true } }),
    // The viewer's own unsent video and voice replies (e.g. recorded before the browser closed): only they see these.
    db.reply.findMany({ where: { videoId: id, ...heldRepliesOf(who) }, orderBy: { createdAt: "asc" }, include: { media: true } }),
  ]);
  return Response.json({ replies: replies.map((r) => replyDTO(r, root.ownerId, who)), held: held.map((r) => replyDTO(r, root.ownerId, who)) });
});

/**
 * Reply to a video with text, or start a video/voice reply. Workspace members
 * and the client the video was sent to can reply; clients don't need an
 * account. Media replies return a one-time upload token and use the same
 * crash-safe part upload as normal recordings.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json());
  await limitByIp("replies", 30, 300);
  if (!parsed.success) throw new HttpError(400, "Invalid reply");
  const body = parsed.data;

  const { video: root, viewer } = await viewableVideo(id);
  if (root.replyToId) throw new HttpError(404, "Video not found");
  if (root.expiresAt && root.expiresAt < new Date()) throw new HttpError(410, "This link has expired");
  const authorName = viewer.name;
  const me = viewer.kind === "member" ? { user: { id: viewer.userId } } : null;

  if (body.kind === "TEXT") {
    const reply = await db.reply.create({
      data: { kind: "TEXT", body: body.body, encrypted: true, timestampMs: body.timestampMs, authorName, videoId: id, authorUserId: me?.user.id, byClient: !me },
      include: { media: true },
    });
    if (viewer.kind === "client") after(() => notifyClientReply(root.id));
    return Response.json({ reply: replyDTO(reply, root.ownerId, replyViewer(viewer)) }, { status: 201 });
  }

  // A conversation can't hold endless unfinished uploads.
  const open = await db.video.count({ where: { replyToId: id, status: "RECORDING", createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
  if (open >= 5) throw new HttpError(429, "Finish or cancel your other replies first.");
  if ((await replyBytesToday(id)) >= REPLY_DAILY_BYTES) {
    throw new HttpError(429, "This conversation has reached today's limit for video and voice replies. Send a text reply, or try again tomorrow.");
  }

  // The team's own replies keep to the plan's video length, so they can't stand in for videos on Free.
  const { plan } = await db.workspace.findUniqueOrThrow({ where: { id: root.workspaceId }, select: { plan: true } });
  const maxDurationMin = replyMaxMinutes(plan, !!me);

  const mediaId = newVideoId();
  const storageKey = `videos/${root.workspaceId}/${root.id}/replies/${mediaId}.${extensionFor(body.mimeType)}`;
  const uploadId = await storage().begin(storageKey, body.mimeType);
  const upload = newUploadToken();
  const reply = await db.reply.create({
    data: {
      kind: body.kind,
      authorName,
      heldAt: body.review ? new Date() : null,
      byClient: !me,
      video: { connect: { id } },
      ...(me ? { authorUser: { connect: { id: me.user.id } } } : {}),
      media: {
        create: {
          id: mediaId,
          title: `Reply from ${authorName}`,
          mimeType: body.mimeType,
          storageKey,
          uploadId,
          uploadTokenHash: upload.hash,
          encrypted: true,
          parentKeyWrap: body.parentKeyWrap,
          replyToId: id,
          ownerId: root.ownerId,
          workspaceId: root.workspaceId,
        },
      },
    },
    include: { media: true },
  });
  return Response.json(
    { reply: replyDTO(reply, root.ownerId, replyViewer(viewer)), mediaId, uploadToken: upload.token, maxDurationMin },
    { status: 201 },
  );
});
