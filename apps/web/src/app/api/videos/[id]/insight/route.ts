import { z } from "zod";
import { db } from "@/lib/db";
import { aiAssistActive } from "@/lib/plans";
import { viewableVideo } from "@/lib/access";
import { handle, HttpError, requireUser } from "@/lib/session";
import { accessOf, visibleVideo } from "@/lib/permissions";
import { limitByIp } from "@/lib/rateLimit";

/** Ciphertext only: base64url sealed with the video's key. Plain text (spaces, quotes, braces) is refused. */
const Sealed = z.string().min(24).max(2_000_000).regex(/^[A-Za-z0-9_-]+$/);
const Body = z.object({ transcript: Sealed, summary: Sealed.nullable() });

/** Copies sent to other clients share the original recording's transcript. */
const recordingId = (v: { id: string; sourceId: string | null }) => v.sourceId ?? v.id;

/** The encrypted transcript and summary, for the team and the client the video was sent to. */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { video } = await viewableVideo(id);
  if (video.replyToId) throw new HttpError(404, "Video not found");
  const insight = await db.videoInsight.findUnique({ where: { videoId: recordingId(video) } });
  return Response.json({ insight: insight && { transcript: insight.transcript, summary: insight.summary, updatedAt: insight.updatedAt } });
});

/** Save the transcript and summary, encrypted on the team member's device. */
export const PUT = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await limitByIp("ai-insight", 60, 600);
  const me = await requireUser();
  const video = await visibleVideo(accessOf(me), id);
  if (video.replyToId) throw new HttpError(404, "Video not found");
  if (!aiAssistActive(me.workspace)) throw new HttpError(403, "AI summaries aren't switched on for this business");
  const body = Body.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, "Transcripts must be encrypted before saving");
  const videoId = recordingId(video);
  const saved = await db.videoInsight.upsert({
    where: { videoId },
    create: { videoId, transcript: body.data.transcript, summary: body.data.summary },
    update: { transcript: body.data.transcript, summary: body.data.summary },
  });
  return Response.json({ insight: { transcript: saved.transcript, summary: saved.summary, updatedAt: saved.updatedAt } });
});

/** Remove the transcript and summary (team only). Allowed even after the add-on is switched off. */
export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const me = await requireUser();
  const video = await visibleVideo(accessOf(me), id);
  await db.videoInsight.deleteMany({ where: { videoId: recordingId(video) } });
  return Response.json({ ok: true });
});
