import { z } from "zod";
import { db } from "@/lib/db";
import { handle, HttpError, requireUser } from "@/lib/session";
import { accessOf, visibleVideo } from "@/lib/permissions";
import { limitByIp } from "@/lib/rateLimit";

/**
 * The library still for a recording: a small JPEG made and encrypted on a
 * team member's device with the video's key, so only the team can see it.
 * A copy sent to another client uses the original's.
 */
async function original(id: string) {
  const me = await requireUser();
  const video = await visibleVideo(accessOf(me), id);
  if (video.replyToId) throw new HttpError(404, "Video not found");
  return video.sourceId ?? video.id;
}

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const thumb = await db.videoThumb.findUnique({ where: { videoId: await original((await ctx.params).id) } });
  if (!thumb) throw new HttpError(404, "No preview yet");
  return new Response(thumb.data, { headers: { "Content-Type": "text/plain", "Cache-Control": "private, max-age=86400" } });
});

// About 480x270 at JPEG quality 0.7 is 20-40 KB; base64 adds a third.
const Body = z.object({ data: z.string().min(40).max(300_000).regex(/^[A-Za-z0-9_-]+$/) });

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
