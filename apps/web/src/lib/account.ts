import { db, type Workspace } from "@/lib/db";
import { storage } from "@/lib/storage";
import { stripe } from "@/lib/stripe";
import { isMissing } from "@/lib/subscription";
import { clientScopeWhere, permsOf, seesAllClients } from "@/lib/permissions";
import { enforceSeatLimits } from "@/lib/seatLimits";
import { brandOf } from "@/lib/branding";
import { appUrl } from "@/lib/stripe";
import { teamEmail } from "@/lib/teamEmail";
import { sendMail } from "@/lib/mail";
import { BRAND } from "@/lib/brand";
import { teamPath } from "@/lib/teamLink";
import { activeMember } from "@/lib/team";
import { agreementsOf } from "@/lib/terms";

/**
 * Deletes a workspace's stored files (or one person's in it). Throws if any
 * couldn't be deleted, before any row goes, so the next run tries again
 * rather than leaving files nobody can find.
 */
async function deleteVideoFiles(where: { workspaceId: string } | { ownerId: string; workspaceId: string }) {
  const videos = await db.video.findMany({ where, select: { storageKey: true, uploadId: true, status: true } });
  const driver = storage();
  let failed = 0;
  // A few at a time, so a big account finishes well within the request.
  for (let i = 0; i < videos.length; i += 25) {
    const results = await Promise.allSettled(
      videos.slice(i, i + 25).map((v) =>
        v.status === "RECORDING" && v.uploadId
          ? // An unfinished upload may already be gone (aborted on an earlier try, or expired by the bucket).
            driver.abort(v.storageKey, v.uploadId).catch((err) => console.error("[account] couldn't abort upload", v.storageKey, err))
          : v.status !== "EXPIRED"
            ? driver.delete(v.storageKey)
            : null,
      ),
    );
    failed += results.filter((r) => r.status === "rejected").length;
  }
  if (failed) throw new Error(`${failed} stored file(s) couldn't be deleted`);
}

/**
 * Cancels a workspace's subscription before anything is deleted. If Stripe
 * can't be reached this throws, nothing is deleted, and they can try again:
 * a deleted account must never keep being charged.
 */
async function stopBilling(w: Workspace) {
  if (!process.env.STRIPE_SECRET_KEY) return;
  if (w.stripeSubscriptionId) {
    const sub = await stripe().subscriptions.retrieve(w.stripeSubscriptionId).catch((err) => (isMissing(err) ? null : Promise.reject(err)));
    if (sub && sub.status !== "canceled" && sub.status !== "incomplete_expired") await stripe().subscriptions.cancel(sub.id);
  }
  if (w.stripeCustomerId) {
    // Also removes saved cards. Billing has already stopped, so a failure here is only logged.
    await stripe().customers.del(w.stripeCustomerId).catch((err) => {
      if (!isMissing(err)) console.log("[account] stripe customer delete failed", JSON.stringify({ customer: w.stripeCustomerId, error: String(err?.message ?? err) }));
    });
  }
}

/**
 * Permanently delete a user, now. Workspaces they alone belong to go with
 * them, including clients, to-dos, videos and stored files, and any
 * subscription is cancelled. Recordings they made for a team (including teams
 * they've since left) stay with that team, under its owner. Closing an account
 * from Settings waits 30 days first (lib/accountDeletion.ts); this is the end
 * of that, and support's "Delete now". Safe to run again: returns whether this
 * run deleted the user.
 */
export async function deleteAccount(userId: string) {
  const memberships = await db.membership.findMany({
    where: { userId },
    include: { workspace: { include: { _count: { select: { members: true } } } } },
  });
  const own = memberships.filter((m) => m.workspace._count.members === 1).map((m) => m.workspace);
  const teams = memberships.filter((m) => m.workspace._count.members > 1).map((m) => m.workspace);
  for (const w of own) await stopBilling(w);

  const user = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  const leaver = leaverName(user);
  // Normally done when they closed the account; anything left is finished here.
  for (const w of teams) await leaveTeam(userId, w, leaver);
  const kept = await db.video.findMany({
    where: { ownerId: userId, workspaceId: { notIn: own.map((w) => w.id) } },
    select: { workspaceId: true },
    distinct: ["workspaceId"],
  });
  for (const { workspaceId } of kept) {
    const owner = await db.membership.findFirst({ where: { workspaceId, role: "OWNER", userId: { not: userId } } });
    if (owner) await db.video.updateMany({ where: { workspaceId, ownerId: userId }, data: { ownerId: owner.userId, formerStaffAt: new Date() } });
    else await deleteVideoFiles({ workspaceId, ownerId: userId });
  }
  for (const w of own) {
    await deleteVideoFiles({ workspaceId: w.id });
    await db.workspace.deleteMany({ where: { id: w.id } });
  }
  const gone = await db.user.deleteMany({ where: { id: userId } });
  // An unused sign-in link would otherwise make a fresh account under the same email.
  if (user?.email) await db.verificationToken.deleteMany({ where: { identifier: user.email } });
  return gone.count > 0;
}

/** How a leaver is named to their team. */
export const leaverName = (user: { name: string | null; email: string } | null) => user?.name ?? user?.email ?? "A former team member";

/**
 * Takes someone off a team they don't own because they closed or deleted
 * their account, or chose to leave it (`chose`, Settings > Account). Their recordings and replies stay with the team under its
 * owner, clients they looked after go back to the shared list, invites they
 * sent stop working, their seat is freed, and the owner and admins are asked
 * to reset the keys they held.
 * Does nothing if they've already left.
 */
export async function leaveTeam(userId: string, w: Workspace, leaver: string, { closedBySupport = false, chose = false } = {}) {
  const left = await db.$transaction(async (tx) => {
    const gone = await tx.membership.deleteMany({ where: { workspaceId: w.id, userId, role: { not: "OWNER" } } });
    if (!gone.count) return false;
    // Their Claude connections end with their place on the team (lib/connector/grants.ts).
    await tx.connectorGrant.updateMany({ where: { workspaceId: w.id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    const owner = await tx.membership.findFirst({ where: { workspaceId: w.id, role: "OWNER" } });
    if (owner) {
      // Shown as a former team member's, not the owner's (lib/team.ts senderName).
      const now = new Date();
      await tx.video.updateMany({ where: { workspaceId: w.id, ownerId: userId }, data: { ownerId: owner.userId, formerStaffAt: now } });
      // Their replies stay the team's: without an author they'd count as the client's in the Team overview.
      await tx.reply.updateMany({ where: { authorUserId: userId, video: { workspaceId: w.id } }, data: { authorUserId: owner.userId, formerStaffAt: now } });
    }
    await tx.client.updateMany({ where: { workspaceId: w.id, assignedToId: userId }, data: { assignedToId: null } });
    // Invites they sent and nobody has used yet stop working with them.
    await tx.invite.updateMany({ where: { workspaceId: w.id, invitedById: userId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.teamNotification.deleteMany({ where: { workspaceId: w.id, userId } });
    // They leave holding the team's keys; ask an admin to reset them.
    await tx.workspace.update({ where: { id: w.id }, data: { keyResetNeeded: leaver } });
    await tx.user.updateMany({ where: { id: userId, activeWorkspaceId: w.id }, data: { activeWorkspaceId: null } });
    return true;
  });
  if (!left) return false;
  // The login they freed can lift a colleague's pause.
  await enforceSeatLimits(w.id).catch((err) => console.error("[account] seat check after leaving", w.id, err));
  await tellManagersAboutLeaver(w, leaver, closedBySupport, chose).catch((err) => console.error("[account] leaver email", w.id, err));
  return true;
}

/** Owners and admins hear at once that someone left with the team's keys, not only when they next open Settings > Team and staff. */
async function tellManagersAboutLeaver(w: Workspace, leaver: string, closedBySupport: boolean, chose = false) {
  // Nothing is emailed in a suspended workspace's name (lib/support/admin.ts); Settings > Team and staff still asks for the reset.
  if (w.suspendedAt || w.closedAt) return;
  const managers = await db.membership.findMany({ where: { workspaceId: w.id, role: { in: ["OWNER", "ADMIN"] }, ...activeMember }, include: { user: { select: { email: true } } } });
  const brand = brandOf(w, appUrl(""));
  const mail = teamEmail({
    business: w.name,
    // Closed by SureFrame support (lib/support/admin.ts): the team isn't told why.
    subject: chose ? `${leaver} left ${w.name} on ${BRAND.name}` : closedBySupport ? `${leaver}'s ${BRAND.name} account was closed, so they've left ${w.name}` : `${leaver} closed their ${BRAND.name} account and left ${w.name}`,
    lead: chose ? `${leaver} left your team on ${BRAND.name}, so they're no longer on it.` : closedBySupport ? `${leaver}'s ${BRAND.name} account was closed, so they're no longer on your team.` : `${leaver} closed their ${BRAND.name} account, so they're no longer on your team.`,
    lines: [{ text: "Their recordings now belong to the owner. They held your team's encryption keys, so reset the keys on Settings > Team and staff now. Every client gets a new personal link. Clients who have opened their link and have an email are sent theirs automatically; you'll get the other clients' new links to send yourself." }],
    button: { label: "Reset your team's keys", link: appUrl(teamPath("/settings/team", w.id)) },
    logoUrl: brand.logoUrl,
    color: brand.color,
  });
  for (const m of managers) await sendMail({ to: m.user.email, ...mail });
}

/**
 * Everything the server holds about a user, as JSON. To-dos, notes and
 * replies are end-to-end encrypted, so they are included as ciphertext;
 * videos are downloaded from each video's page. With `wraps`, the wrapped
 * keys come too, so the browser can make a readable copy with the team key
 * (components/ReadableExport.tsx); they open nothing without it.
 */
export async function exportAccount(userId: string, { wraps = false } = {}) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, createdAt: true, accounts: { select: { provider: true } } },
  });
  const memberships = await db.membership.findMany({ where: { userId } });
  const workspaces = await Promise.all(
    memberships.map(async (m) => {
      const w = await db.workspace.findUniqueOrThrow({ where: { id: m.workspaceId } });
      // A team that has paused them shares nothing more than its name.
      if (m.pausedAt) return { role: m.role, paused: true, workspace: { id: w.id, name: w.name } };
      // Staff export only what they can see in the app (lib/permissions.ts).
      const access = { userId, workspaceId: w.id, role: m.role, perms: permsOf(m) };
      const all = seesAllClients(access);
      const mineOnly = { OR: [{ ownerId: userId }, { client: { assignedToId: userId } }, { asReply: { video: { OR: [{ ownerId: userId }, { client: { assignedToId: userId } }] } } }] };
      const [clients, videos, items, notices] = await Promise.all([
        db.client.findMany({
          // A deleted client is gone at once (lib/clientRemoval.ts), even while the deletion finishes.
          where: { ...clientScopeWhere(access), removedAt: null },
          select: { id: true, name: true, email: true, createdAt: true, remindersOff: true, teamKeyWrap: wraps },
        }),
        db.video.findMany({
          where: { workspaceId: w.id, ...(all ? {} : mineOnly) },
          select: {
            id: true, title: true, status: true, durationMs: true, sizeBytes: true, createdAt: true, clientId: true,
            encrypted: true, purgeAt: true, replyToId: true, viewCount: true, message: true, teamKeyWrap: wraps,
            replies: { select: { kind: true, authorName: true, body: true, encrypted: true, timestampMs: true, createdAt: true } },
            insight: { select: { transcript: true, summary: true, createdAt: true } },
          },
        }),
        db.item.findMany({
          where: { workspaceId: w.id, ...(all ? {} : { OR: [{ clientId: null }, { client: { assignedToId: userId } }] }) },
          select: {
            kind: true, body: true, done: true, dueAt: true, shared: true, repeat: true, reminders: true,
            remindClient: true, remindTeam: true, authorName: true, createdAt: true, clientId: true,
          },
        }),
        // Staff reminders they sent or were sent on this team.
        db.staffNotice.findMany({
          where: { workspaceId: w.id, OR: [{ fromUserId: userId }, { toUserId: userId }] },
          select: { message: true, link: true, createdAt: true, dismissedAt: true, from: { select: { email: true } }, to: { select: { email: true } } },
          orderBy: { createdAt: "asc" },
        }),
      ]);
      return {
        role: m.role,
        // Your own settings on this team (staff): reminder defaults, client email message and reply-to, reply emails.
        mySettings: {
          reminderDefaults: m.myReminderDefaults, remindClientDefault: m.myRemindClientDefault, remindTeamDefault: m.myRemindTeamDefault,
          reminderMessage: m.myReminderMessage, reminderReplyTo: m.myReminderReplyTo, replyNotify: m.replyNotify,
        },
        workspace: {
          id: w.id, name: w.name, plan: w.plan, subscriptionStatus: w.subscriptionStatus, extraClientSeats: w.extraClientSeats,
          cloudBackup: w.cloudBackup, aiAssist: w.aiAssist, timezone: w.timezone, reminderMessage: w.reminderMessage, reminderReplyTo: w.reminderReplyTo,
          videosRecorded: w.videosRecorded, createdAt: w.createdAt,
        },
        clients,
        videos: videos.map((v) => ({ ...v, sizeBytes: Number(v.sizeBytes) })),
        items,
        staffNotices: notices.map(({ from, to, ...n }) => ({ ...n, from: from.email, to: to.email })),
      };
    }),
  );
  const supportConversations = await db.supportTicket.findMany({
    where: { userId },
    select: { status: true, summary: true, createdAt: true, messages: { select: { author: true, body: true, createdAt: true }, orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  return {
    exportedAt: new Date().toISOString(),
    note: "To-dos, notes, replies and AI transcripts and summaries are end-to-end encrypted and appear here as ciphertext. Download videos from each video's page.",
    user,
    workspaces,
    supportConversations,
    // Each time you agreed to the Terms of Service and Privacy Policy (lib/terms.ts).
    termsAgreements: await agreementsOf(userId),
  };
}
