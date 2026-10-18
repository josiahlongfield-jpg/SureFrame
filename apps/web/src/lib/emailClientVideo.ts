import { db } from "@/lib/db";
import { clientBlock } from "@/lib/access";
import { brandOf } from "@/lib/branding";
import { clientLink } from "@/lib/clients";
import { type Mail, sendMail, sendMails } from "@/lib/mail";
import { newVideoEmail } from "@/lib/newVideoEmail";
import { appUrl } from "@/lib/stripe";
import { clientMailSettings, unsubscribeUrl } from "@/lib/reminders";
import { rateLimit } from "@/lib/rateLimit";

/**
 * Emails a client that a video is waiting, if they have an address, want
 * emails and have opened their personal link. The email carries no key: it
 * opens on devices where the client has already used their personal link, so
 * a client who never has can't open it. Returns whether an email went out.
 */
export async function emailClientVideo(videoId: string) {
  return (await emailClientVideoResult(videoId)) === "sent";
}

type NotSent = "unavailable" | "no-email" | "off" | "first-link" | "limited";

/** The same, saying why nothing went out when nothing did. */
export async function emailClientVideoResult(videoId: string): Promise<"sent" | NotSent | "failed"> {
  const r = await clientVideoEmail(videoId);
  if (typeof r === "string") return r;
  try {
    await sendMail(r);
    return "sent";
  } catch (err) {
    console.error("new video email failed", err);
    return "failed";
  }
}

/** Many at once (sending a video to many clients), as batches. Returns how many went out. */
export async function emailClientVideos(videoIds: string[]) {
  const mails: Mail[] = [];
  for (const id of videoIds) {
    const r = await clientVideoEmail(id);
    if (typeof r !== "string") mails.push(r);
  }
  return sendMails(mails);
}

async function clientVideoEmail(videoId: string): Promise<Mail | NotSent> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    include: { client: true, workspace: true, owner: { select: { name: true } } },
  });
  const c = video?.client;
  // Nothing goes to a client whose link doesn't work: removed, paused, turned off, or the business's account suspended or closed.
  if (!video || !c || clientBlock({ ...c, workspace: video.workspace })) return "unavailable";
  if (!c.email) return "no-email";
  if (c.remindersOff) return "off";
  // Copying their link doesn't count: only opening it puts their key on a device.
  if (!c.linkOpenedAt) return "first-link";
  // At most a handful of these an hour per client, however often a video is re-sent.
  if (!(await rateLimit(`client-mail:${c.id}`, 10, 3600).then(() => true, () => false))) return "limited";
  const ws = video.workspace;
  const brand = brandOf(ws, appUrl(""));
  const assigned = c.assignedToId ? await db.membership.findUnique({ where: { userId_workspaceId: { userId: c.assignedToId, workspaceId: ws.id } } }) : null;
  const { replyTo } = clientMailSettings(ws, assigned);
  // A former team member's recording comes from the business itself (lib/team.ts senderName).
  return {
    to: c.email,
    ...newVideoEmail({ business: ws.name, sender: video.formerStaffAt ? null : video.owner?.name, clientName: c.name, link: clientLink(c.token, video.id), title: video.title, logoUrl: brand.logoUrl, color: brand.color, unsubscribe: unsubscribeUrl(c.id), noReply: !replyTo }),
    fromName: ws.name,
    replyTo,
  };
}
