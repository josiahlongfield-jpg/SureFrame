import { z } from "zod";
import { db } from "@/lib/db";
import { handle, HttpError, requireUser } from "@/lib/session";
import { accessOf, visibleVideo } from "@/lib/permissions";
import { limitByIp } from "@/lib/rateLimit";
import { viewableVideo } from "@/lib/access";

/**
 * The library still for a recording: a JPEG made and encrypted on a
 * team member's device with the video's key, so only the team and its
 * client can see it.
 * A copy sent to another client uses the original's.
 */
async function original(id: string) {
  const me = await requireUser();
  const video = await visibleVideo(accessOf(me), id);
  if (video.replyToId) throw new HttpError(404, "Video not found");
  return video.sourceId ?? video.id;
}

// The team, and the client it was sent to (their copy shares the original's key, so the original's still).
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { video } = await viewableVideo((await ctx.params).id);
  if (video.replyToId) throw new HttpError(404, "Video not found");
  const thumb = await db.videoThumb.findUnique({ where: { videoId: video.sourceId ?? video.id } });
  if (!thumb) throw new HttpError(404, "No preview yet");
  return new Response(thumb.data, { headers: { "Content-Type": "text/plain", "Cache-Control": "private, max-age=86400" } });
});

// About 960x540 at JPEG quality 0.85 is 60-250 KB (more for busy screens); base64 adds a third.
const Body = z.object({ data: z.string().min(40).max(1_000_000).regex(/^[A-Za-z0-9_-]+$/) });

export const PUT = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const videoId = await original((await ctx.params).id);
  await limitByIp("thumb", 120, 3600);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new HttpError(400, "Invalid preview");
  const video = await db.video.findUniqueOrThrow({ where: { id: videoId }, select: { status: true, encrypted: true } });
  if (!video.encrypted || video.status === "EXPIRED" || video.status === "FAILED") throw new HttpError(409, "This recording has no preview");
  await db.videoThumb.upsert({ where: { videoId }, create: { videoId, data: body.data.data }, update: { data: body.data.data } });
  return new Response(null, { status: 204 });
});
