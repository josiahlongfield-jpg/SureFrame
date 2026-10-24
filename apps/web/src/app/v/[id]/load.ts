import { cache } from "react";
import { db } from "@/lib/db";
import { viewerFor } from "@/lib/access";

/** The video at /v/[id] and who's looking, once per request (the layout, the page and its title all need it). */
export const loadVideo = cache(async (id: string) => {
  const video = await db.video.findUnique({ where: { id }, include: { owner: { select: { name: true, email: true } }, workspace: { select: { name: true } }, client: { select: { removedAt: true } } } });
  if (!video || video.replyToId) return null;
  // A deleted client leaves no trace (Josiah, 24 October 2026): their conversation goes with them, so its page is
  // gone from the moment they're deleted. A recording also sent to other clients (or kept for the team) stays.
  if (video.client?.removedAt && (video.sourceId || !(await db.video.count({ where: { sourceId: video.id, OR: [{ clientId: null }, { client: { removedAt: null } }] } })))) return null;
  return { video, viewer: await viewerFor(video) };
});
