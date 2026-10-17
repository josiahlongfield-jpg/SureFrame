import { db } from "@/lib/db";
import { viewableVideo } from "@/lib/access";
import { handle } from "@/lib/session";
import { limitByIp } from "@/lib/rateLimit";

/**
 * Counts the client opening the video (once each time their page unlocks it, whether or not they press
 * play), never the team's own visits. Only the team sees the count.
 */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await limitByIp("views", 120, 60);
  const { id } = await ctx.params;
  const { viewer } = await viewableVideo(id);
  if (viewer.kind === "client") await db.video.update({ where: { id }, data: { viewCount: { increment: 1 } } });
  return Response.json({ ok: true });
});
