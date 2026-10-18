import { db } from "@/lib/db";
import { clientBlock, clientGate } from "@/lib/access";
import { askForLink } from "@/lib/askForLink";
import { limitByIp } from "@/lib/rateLimit";
import { handle, HttpError } from "@/lib/session";

/**
 * "Ask for my link again" on a page that can't open a video, from a device that isn't (or is no longer)
 * remembered as the client's: only the address, or a link a key reset replaced. The video's own client is
 * the one asked about, and their business sends the link to them through its own channels, so whoever
 * presses this learns nothing and gets nothing. Asking is limited per client (lib/askForLink.ts) and per
 * network.
 */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await limitByIp("ask-link", 10, 3600);
  const { id } = await ctx.params;
  const video = await db.video.findUnique({ where: { id }, select: { clientId: true, replyToId: true } });
  const client = video?.clientId && !video.replyToId ? await db.client.findUnique({ where: { id: video.clientId }, include: { workspace: { select: clientGate } } }) : null;
  // Nobody to ask about, or a client whose access has ended: their page says so instead.
  if (!client || clientBlock(client)) throw new HttpError(404, "Not found");
  return Response.json({ asked: await askForLink(client.id) });
});
