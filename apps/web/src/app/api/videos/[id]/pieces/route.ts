import { db } from "@/lib/db";
import { handle, HttpError } from "@/lib/session";
import { limitByIp } from "@/lib/rateLimit";
import { uploadableVideo } from "@/lib/videos";

/**
 * "Still here" from a recorder that is paused. Nothing is sent while paused, and a recording that goes quiet looks
 * left behind, which the server then finishes from its own copy (lib/pieces.ts salvage). This keeps its last-heard
 * time fresh, for the person recording it only: the same check, and the same brake on flooding, as sending a piece
 * ([seq]/route.ts). It never starts that clock: a recording with no piece yet has nothing to finish.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  // Counted with the pieces themselves: a paused recorder sends one of these every 30 seconds in place of them.
  await limitByIp("pieces", 3000, 60);
  const video = await uploadableVideo(req, id);
  if (video.status !== "RECORDING") throw new HttpError(409, "Upload already completed");
  await db.video.updateMany({ where: { id, status: "RECORDING", piecesAt: { not: null } }, data: { piecesAt: new Date() } });
  return new Response(null, { status: 204 });
});
