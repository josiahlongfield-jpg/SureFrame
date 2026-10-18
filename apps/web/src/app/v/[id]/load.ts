import { cache } from "react";
import { db } from "@/lib/db";
import { viewerFor } from "@/lib/access";

/** The video at /v/[id] and who's looking, once per request (the layout, the page and its title all need it). */
export const loadVideo = cache(async (id: string) => {
  const video = await db.video.findUnique({ where: { id }, include: { owner: { select: { name: true, email: true } }, workspace: { select: { name: true } } } });
  if (!video || video.replyToId) return null;
  return { video, viewer: await viewerFor(video) };
});
