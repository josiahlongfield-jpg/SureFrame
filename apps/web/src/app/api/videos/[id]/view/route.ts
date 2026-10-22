import { db } from "@/lib/db";
import { viewableVideo } from "@/lib/access";
import { handle } from "@/lib/session";
import { limitByIp } from "@/lib/rateLimit";

/** Opening it again within this long (a reload, coming back from another tab) is the same view. */
const SAME_VIEW_SEC = 30 * 60;

/**
 * Counts the client opening the video (once each time their page unlocks it, whether or not they press
 * play), never the team's own visits. Reloads and reopening within half an hour count once, so the count
 * isn't inflated (O39). Only the team sees the count.
 */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await limitByIp("views", 120, 60);
  const { id } = await ctx.params;
  const { viewer } = await viewableVideo(id);
  if (viewer.kind === "client" && (await firstInWindow(`view:${id}:${viewer.client.id}`))) {
    await db.video.update({ where: { id }, data: { viewCount: { increment: 1 } } });
  }
  return Response.json({ ok: true });
});

/** True the first time `key` is seen in the current half-hour window (the rate-limit table, pruned daily). */
async function firstInWindow(key: string) {
  const windowMs = SAME_VIEW_SEC * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count"`;
  return (rows[0]?.count ?? 0) === 1;
}
