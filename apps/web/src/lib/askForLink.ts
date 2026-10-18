import { brandOf } from "@/lib/branding";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { rateLimit } from "@/lib/rateLimit";
import { appUrl } from "@/lib/stripe";
import { teamEmail } from "@/lib/teamEmail";
import { teamPath } from "@/lib/teamLink";
import { activeMember } from "@/lib/team";

/**
 * A client asks for their personal link again ("Ask for my link again" on a page that can't open). Only the
 * team's devices can make that link, so the person looking after them (or the owners and admins) is
 * emailed. A client who never opened it is still waiting for their first one, and the email says so.
 * Once every few hours per client is plenty; further presses just say it's been asked. Returns whether
 * anyone was asked.
 */
export async function askForLink(clientId: string) {
  if (!(await rateLimit(`lost-key:${clientId}`, 1, 6 * 3600).then(() => true, () => false))) return true;

  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { workspace: true } });
  const ws = client.workspace;
  const members = await db.membership.findMany({ where: { workspaceId: ws.id, ...activeMember }, include: { user: { select: { email: true } } }, orderBy: { id: "asc" } });
  const assigned = members.find((m) => m.userId === client.assignedToId);
  const to = assigned ? [assigned] : members.filter((m) => m.role === "OWNER" || m.role === "ADMIN");
  const brand = brandOf(ws, appUrl(""));
  const page = appUrl(teamPath(`/clients/${client.id}`, ws.id));
  // A client who never opened their personal link didn't lose it: they're waiting for their first one.
  const mail = client.linkOpenedAt
    ? teamEmail({
        business: ws.name,
        subject: `${client.name} needs their personal link again`,
        lead: `${client.name} tried to open a video, but this phone or computer doesn't have the key their personal link gave it, so they can't watch it.`,
        lines: [
          { text: `What to do: open ${client.name}'s page, press Copy personal link, and send it to them yourself, for example by text or message. Once they open it, they can watch everything again. Nothing has been lost.` },
          { text: "This happens when a browser clears saved site data (Safari does after a week or so without a visit) or they use a new device." },
        ],
        button: { label: `Open ${client.name}'s page`, link: page },
        logoUrl: brand.logoUrl,
        color: brand.color,
      })
    : teamEmail({
        business: ws.name,
        subject: `${client.name} is waiting for their personal link`,
        lead: `${client.name} tried to open a video, but they haven't opened their personal link yet, so they can't watch it.`,
        lines: [
          { text: `What to do: open ${client.name}'s page, press Copy personal link, and send it to them yourself, for example by text or message. Once they open it, they can watch their videos, and emailed videos open for them too.` },
          { text: "Their personal link holds the key to their videos, so only your team can send it. We can't email it for you." },
        ],
        button: { label: `Open ${client.name}'s page`, link: page },
        logoUrl: brand.logoUrl,
        color: brand.color,
      });
  let sent = 0;
  for (const m of to) {
    try {
      await sendMail({ to: m.user.email, ...mail, fromName: ws.name });
      sent++;
    } catch (err) {
      console.error("[clients] lost-key email", client.id, err);
    }
  }
  return sent > 0;
}
