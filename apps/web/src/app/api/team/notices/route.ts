import { z } from "zod";
import { db } from "@/lib/db";
import { brandOf } from "@/lib/branding";
import { sendMail } from "@/lib/mail";
import { notify } from "@/lib/notifications";
import { canSeeClient, canSeeVideo, permsOf, type Access } from "@/lib/permissions";
import { rateLimit } from "@/lib/rateLimit";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";
import { appUrl } from "@/lib/stripe";
import { teamEmail } from "@/lib/teamEmail";
import { teamPath } from "@/lib/teamLink";
import { activeMember } from "@/lib/team";

const Body = z.object({
  /** Staff user ids, or "all" for everyone else on the team. */
  to: z.union([z.literal("all"), z.array(z.string().min(1).max(40)).min(1).max(200)]),
  message: z.string().trim().min(1).max(500),
  /** Optionally point them at a client or a video. */
  link: z.object({ kind: z.enum(["client", "video"]), id: z.string().min(1).max(40) }).optional(),
});

/**
 * Owners and admins: remind one, several or all staff. Each gets an email and
 * a notice in the app until they dismiss it. Kept as history.
 */
export const POST = handle(async (req: Request) => {
  const me = await requireUser();
  requireRole(me, "OWNER", "ADMIN");
  const body = Body.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, "Write a short message and choose who it's for");
  const { workspace } = me;
  await rateLimit(`staff-notice:${workspace.id}`, 100, 86_400);
  // Paused or suspended staff can't sign in, so they aren't sent reminders.
  const members = await db.membership.findMany({ where: { workspaceId: workspace.id, ...activeMember }, include: { user: { select: { id: true, email: true, name: true } } } });
  const wanted = body.data.to === "all" ? members.filter((m) => m.userId !== me.user.id) : members.filter((m) => (body.data.to as string[]).includes(m.userId));
  if (!wanted.length || (body.data.to !== "all" && wanted.length !== new Set(body.data.to).size)) throw new HttpError(400, "Choose people on your team");

  // A link must open for everyone it's sent to.
  // `label` is shown in the app; `mailLabel` goes in the email, which never carries a video title.
  let link: { path: string; label: string; mailLabel: string } | null = null;
  if (body.data.link) {
    const { kind, id } = body.data.link;
    const accessOf = (m: (typeof members)[number]): Access => ({ userId: m.userId, workspaceId: workspace.id, role: m.role, perms: permsOf(m) });
    if (kind === "client") {
      const c = await db.client.findFirst({ where: { id, workspaceId: workspace.id, removedAt: null } });
      if (!c) throw new HttpError(400, "Unknown client");
      const blind = wanted.filter((m) => !canSeeClient(accessOf(m), c));
      if (blind.length) throw new HttpError(400, `${blind.map((m) => m.user.name ?? m.user.email.split("@")[0]).join(", ")} can't see ${c.name}. Assign the client first, or leave out the link.`);
      link = { path: `/clients/${c.id}`, label: c.name, mailLabel: `Open ${c.name}` };
    } else {
      const v = await db.video.findFirst({ where: { id, workspaceId: workspace.id, replyToId: null } });
      if (!v) throw new HttpError(400, "Unknown video");
      const blind: string[] = [];
      for (const m of wanted) if (!(await canSeeVideo(accessOf(m), v))) blind.push(m.user.name ?? m.user.email.split("@")[0]);
      if (blind.length) throw new HttpError(400, `${blind.join(", ")} can't open that video. Leave out the link, or send it to them first.`);
      link = { path: `/v/${v.id}`, label: v.title, mailLabel: "Open the video" };
    }
  }

  const fromName = me.user.name ?? me.user.email.split("@")[0];
  const brand = brandOf(workspace, appUrl(""));
  let emailed = 0;
  const notices = [];
  for (const m of wanted) {
    const n = await db.staffNotice.create({ data: { workspaceId: workspace.id, fromUserId: me.user.id, toUserId: m.userId, message: body.data.message, link: link?.path, linkLabel: link?.label } });
    await notify([{ userId: m.userId, workspaceId: workspace.id, kind: "STAFF_REMINDER", text: `Reminder from ${fromName}: ${body.data.message}`, href: link?.path ?? "/library" }]);
    try {
      const mail = teamEmail({
        business: workspace.name,
        subject: `Reminder from ${fromName}`,
        lead: `${fromName} sent you a reminder:`,
        note: body.data.message,
        button: { label: link ? link.mailLabel : `Open ${workspace.name}`, link: appUrl(link ? (link.path.startsWith("/v/") ? `${link.path}?team=1` : teamPath(link.path, workspace.id)) : teamPath("/library", workspace.id)) },
        logoUrl: brand.logoUrl,
        color: brand.color,
      });
      await sendMail({ to: m.user.email, ...mail });
      await db.staffNotice.update({ where: { id: n.id }, data: { emailedAt: new Date() } });
      emailed++;
    } catch (err) {
      console.error("staff reminder email failed", err);
    }
    notices.push(n.id);
  }
  return Response.json({ sent: notices.length, emailed }, { status: 201 });
});
