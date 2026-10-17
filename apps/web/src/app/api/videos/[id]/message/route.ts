import { z } from "zod";
import { db } from "@/lib/db";
import { handle, HttpError, requireUser } from "@/lib/session";
import { accessOf, visibleVideo } from "@/lib/permissions";
import { limitByIp } from "@/lib/rateLimit";

/** Ciphertext only: base64url sealed with the video's key on the team's device. Plain text is refused. */
const Body = z.object({ message: z.string().min(24).max(5600).regex(/^[A-Za-z0-9_-]+$/).nullable() });

/** The team's short message to this conversation's client, shown above the video (null removes it). */
export const PUT = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await limitByIp("video-message", 60, 600);
  const me = await requireUser();
  const video = await visibleVideo(accessOf(me), id);
  if (video.replyToId) throw new HttpError(404, "Video not found");
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new HttpError(400, "Messages must be encrypted before saving, and short");
  await db.video.update({ where: { id }, data: { message: body.data.message } });
  return Response.json({ ok: true });
});
