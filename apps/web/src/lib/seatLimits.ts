import { db } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { notify as addToBell } from "@/lib/notifications";
import { clientSeatLimit, PLANS, RECEIPTS_NOTE, staffSeatLimit } from "@/lib/plans";
import { appUrl } from "@/lib/stripe";
import { teamEmail } from "@/lib/teamEmail";
import { teamPath } from "@/lib/teamLink";
import { activeMember } from "@/lib/team";

/**
 * Keeps a workspace's clients and staff within what its plan pays for.
 *
 * Owners can't move to a smaller plan or fewer seats until they fit (see
 * planChange.ts and the seats routes). When a plan drops on its own (a
 * subscription is cancelled or lapses, or a free plan we gave ends), the
 * clients and staff over the new limits are paused: they can't open anything
 * or be sent anything until the owner removes others or upgrades. The longest
 * standing clients and staff keep access; the owner always does. Nothing is
 * deleted, and pauses lift by themselves when seats free up.
 *
 * Telling staff and clients about the change is the owner's job (Terms §5);
 * we email the owner when someone is paused.
 */
export async function enforceSeatLimits(workspaceId: string, { notify = true } = {}) {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  // A closed account keeps every client paused until it's kept (lib/accountDeletion.ts), whatever the plan does meanwhile.
  if (!workspace || workspace.deleteAt) return { pausedClients: 0, pausedStaff: 0 };
  const now = new Date();

  const clients = await db.client.findMany({
    where: { workspaceId, removedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, pausedAt: true },
  });
  const clientLimit = clientSeatLimit(workspace);
  const keepClients = clients.slice(0, clientLimit);
  const overClients = clients.slice(clientLimit);

  // The owner first, then admins, then everyone else, longest standing first.
  const members = await db.membership.findMany({ where: { workspaceId }, orderBy: { id: "asc" }, select: { id: true, role: true, pausedAt: true } });
  const rank = { OWNER: 0, ADMIN: 1, MEMBER: 2 } as const;
  members.sort((a, b) => rank[a.role] - rank[b.role]);
  const staffLimit = Math.max(1, staffSeatLimit(workspace));
  const keepStaff = members.slice(0, staffLimit);
  const overStaff = members.slice(staffLimit).filter((m) => m.role !== "OWNER");

  const newlyPausedClients = overClients.filter((c) => !c.pausedAt).map((c) => c.id);
  const newlyPausedStaff = overStaff.filter((m) => !m.pausedAt).map((m) => m.id);
  await db.$transaction([
    db.client.updateMany({ where: { id: { in: keepClients.filter((c) => c.pausedAt).map((c) => c.id) } }, data: { pausedAt: null } }),
    db.client.updateMany({ where: { id: { in: newlyPausedClients } }, data: { pausedAt: now } }),
    db.membership.updateMany({ where: { id: { in: keepStaff.filter((m) => m.pausedAt).map((m) => m.id) } }, data: { pausedAt: null } }),
    db.membership.updateMany({ where: { id: { in: newlyPausedStaff } }, data: { pausedAt: now } }),
  ]);

  // Nothing is emailed in a suspended workspace's name (lib/support/admin.ts); the pauses still apply.
  if (notify && !workspace.suspendedAt && !workspace.closedAt && (newlyPausedClients.length || newlyPausedStaff.length)) {
    await emailOwner(workspace.id, workspace.name, PLANS[workspace.plan].name, newlyPausedClients.length, newlyPausedStaff.length).catch((e) =>
      console.error("seat pause email", e),
    );
  }
  return { pausedClients: overClients.length, pausedStaff: overStaff.length };
}

async function emailOwner(workspaceId: string, business: string, planName: string, clients: number, staff: number) {
  const owner = await db.membership.findFirst({ where: { workspaceId, role: "OWNER", ...activeMember }, include: { user: { select: { email: true } } } });
  if (!owner) return;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const lines = [
    ...(clients ? [{ text: `${plural(clients, "client is", "clients are")} paused and can't open their videos or be sent new ones.`, link: appUrl(teamPath("/clients", workspaceId)) }] : []),
    ...(staff ? [{ text: `${plural(staff, "staff login is", "staff logins are")} paused and can't sign in to your team.`, link: appUrl(teamPath("/settings/team", workspaceId)) }] : []),
  ];
  const mail = teamEmail({
    business,
    subject: "Some of your clients or staff are paused",
    lead: `Your SureFrame plan is now ${planName}, which covers fewer clients or staff than you have.`,
    lines,
    button: { label: "Choose a plan", link: appUrl(teamPath("/settings/billing", workspaceId)) },
    footer:
      "Pausing doesn't delete anything, though recordings still expire on the usual schedule. Upgrade, or delete clients or remove staff you no longer need, and the others are restored straight away. Please let anyone affected know about the change. " +
      RECEIPTS_NOTE,
  });
  await addToBell([{ userId: owner.userId, workspaceId, kind: "PAUSED", text: mail.subject, href: "/settings/billing" }]);
  await sendMail({ to: owner.user.email, ...mail });
}
