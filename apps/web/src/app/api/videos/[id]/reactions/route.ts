import { z } from "zod";
import { db } from "@/lib/db";
import { handle, HttpError } from "@/lib/session";
import { REACTIONS, reactionsBy } from "@/lib/reactions";
import { viewableVideo } from "@/lib/access";
import { limitByIp } from "@/lib/rateLimit";

const Body = z.object({ emoji: z.enum(REACTIONS), timestampMs: z.number().int().min(0).optional() });

/**
 * The video's client reacts to it. The team doesn't: the client never sees the team's reactions. One reaction at a
 * time: picking another replaces it, and tapping it again takes it back. Returns whether it's now on.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = Body.safeParse(await req.json());
  await limitByIp("reactions", 60, 60);
  if (!body.success) throw new HttpError(400, "Unsupported reaction");
  const { video, viewer } = await viewableVideo(id);
  if (video.replyToId) throw new HttpError(404, "Video not found");
  if (viewer.kind !== "client") throw new HttpError(403, "Only the client can react to a video.");
  const person = { videoId: id, ...reactionsBy(viewer) };
  const mine = { ...person, emoji: body.data.emoji };
  // One change at a time per person, so quick taps can't leave two.
  const on = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reaction:${id}:${mine.authorUserId ?? "client"}`}))`;
    const { count } = await tx.reaction.deleteMany({ where: mine });
    if (count) return false;
    await tx.reaction.deleteMany({ where: person });
    await tx.reaction.create({ data: { ...mine, timestampMs: body.data.timestampMs } });
    return true;
  });
  return Response.json({ on }, { status: on ? 201 : 200 });
});
