import { db } from "@/lib/db";
import { limitByIp } from "@/lib/rateLimit";
import { handle, HttpError, requireUser } from "@/lib/session";
import { accessOf, visibleVideo } from "@/lib/permissions";
import { emailClientVideoResult } from "@/lib/emailClientVideo";

/**
 * "Send": email the client this video was sent to that it's waiting, now or
 * as soon as the upload finishes. The email carries no key (see emailClientVideo).
 */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const me = await requireUser();
  await limitByIp("notify", 60, 600);
  const video = await visibleVideo(accessOf(me), id);
  if (!video.clientId || video.replyToId) throw new HttpError(400, "Choose a client to send it to first");
  if (video.status === "EXPIRED" || video.status === "FAILED") throw new HttpError(409, "This recording has been deleted from our servers, so it can't be sent");
  if (video.status === "RECORDING") {
    await db.video.update({ where: { id }, data: { emailClientWhenReady: true } });
    return Response.json({ emailed: "when-ready" });
  }
  const result = await emailClientVideoResult(id);
  if (result !== "sent") {
    throw new HttpError(409, {
      unavailable: "This client's access is paused or they've been removed",
      "no-email": "This client has no email address saved, so send them the link yourself",
      off: "This client has turned off emails from you, so send them the link yourself",
      "first-link": "This client hasn't opened their personal link yet, so an email wouldn't open for them. Send them their personal link with the buttons in the box above",
      limited: "This client has had several emails from you in the last hour. Try again later, or send them the link yourself",
      failed: "The email couldn't be sent just now. Try again in a minute",
    }[result]);
  }
  return Response.json({ emailed: "sent" });
});
