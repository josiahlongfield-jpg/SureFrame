import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { deletedEmail, LEGAL_HOLD_DELETE, onLegalHold, purgeAccountNow, restoreAccount, workspacesOf } from "@/lib/accountDeletion";
import { ACTIVE_STATUSES } from "@/lib/billing";
import { isEmailBlocked } from "@/lib/blockedEmail";
import { BRAND } from "@/lib/brand";
import { CLIENT_KEEP_DAYS, purgeClient, restoreClient } from "@/lib/clientRemoval";
import { seatUsage } from "@/lib/clients";
import { qldDay } from "@/lib/support/when";
import { db, type Workspace } from "@/lib/db";
import { LEGAL } from "@/lib/legal";
import { sendMail } from "@/lib/mail";
import { PLANS } from "@/lib/plans";
import { enforceSeatLimits } from "@/lib/seatLimits";
import { HttpError } from "@/lib/session";
import { appUrl, stripe } from "@/lib/stripe";
import { customerExists, forgetSubscription, isMissing, syncSubscription } from "@/lib/subscription";
import {
  guard,
  loadUser,
  loadWorkspace,
  logAdmin,
  notice,
  owner,
  QUESTIONS,
  reasonOf,
  sendNotice,
  unblockEmail,
  wsLabel,
  type AdminActionName,
  type SupportAdmin,
} from "@/lib/support/admin";
import { supportInbox } from "@/lib/support/tickets";
import { teamPath } from "@/lib/teamLink";
import { videosUsed } from "@/lib/videoAllowance";

/**
 * The support console's other powers (the rest are in lib/support/admin.ts,
 * with the same rules): deleting an account now or cancelling its scheduled
 * deletion (both on a verified request from the account's own address),
 * removed clients (restore, keep 30 more days, delete now), correcting the
 * Free plan's count of videos, re-syncing billing from Stripe, re-running the
 * seat check, and unblocking an address with a notice.
 */

/** What the admin types to confirm deleting an account now. */
export const deleteConfirmation = (email: string) => `DELETE ${email}`;
/** What the admin types to confirm deleting a removed client now. */
export const clientDeleteConfirmation = (c: { name: string; email: string | null }) => `DELETE ${c.email ?? c.name}`;
const typed = (got: string, want: string) => got.trim().toLowerCase() === want.toLowerCase();

const D = 86_400_000;

async function mergeDetails(id: string, extra: Prisma.InputJsonObject) {
  const row = await db.adminAction.findUnique({ where: { id }, select: { details: true } });
  const details = (row?.details && typeof row.details === "object" && !Array.isArray(row.details) ? row.details : {}) as Prisma.JsonObject;
  await db.adminAction.update({ where: { id }, data: { details: { ...details, ...extra } } });
}

/**
 * For changes made by code with transactions of its own (account deletion,
 * restoring a client, Stripe): the record is written first and completed
 * after ("done" with the result, or "failed" with the error), so nothing is
 * ever changed without one.
 */
async function tracked<T>(
  actor: SupportAdmin,
  entry: {
    action: AdminActionName;
    workspaceId?: string | null;
    userId?: string | null;
    clientId?: string | null;
    target?: string | null;
    reason: string;
    details: Prisma.InputJsonObject;
  },
  run: () => Promise<T>,
  result: (r: T) => Prisma.InputJsonObject,
) {
  const row = await logAdmin(db, actor, { ...entry, details: { ...entry.details, status: "started" } });
  let out: T;
  try {
    out = await run();
  } catch (err) {
    await mergeDetails(row.id, { status: "failed", error: String((err as Error)?.message ?? err).slice(0, 500) }).catch((e) =>
      console.error("[support-console] couldn't record a failure", row.id, e),
    );
    throw err;
  }
  await mergeDetails(row.id, { status: "done", ...result(out) });
  return { row, out };
}

const clientsPath = (workspaceId: string) => appUrl(teamPath("/clients", workspaceId));
const clientLabel = (c: { name: string; email: string | null }, ws: { name: string }) => `${c.name}${c.email ? ` <${c.email}>` : ""} of ${ws.name}`;

// ---- 8. Delete an account now / cancel its scheduled deletion ----

/**
 * Deletes an account for good now (the account holder asked, from its own
 * address): its subscription is cancelled, its Stripe customer, files,
 * workspace and login are deleted. Refused for an owner with staff and under
 * legal hold. The "deleted" email goes to the address unless unticked.
 */
export async function deleteAccountNow(actor: SupportAdmin, o: { userId: string; reason: string; confirm: string; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  guard(actor, { userId: o.userId });
  const user = await loadUser(o.userId);
  if (!typed(o.confirm, deleteConfirmation(user.email))) throw new HttpError(400, `Type ${deleteConfirmation(user.email)} to confirm.`);
  const { own, ownsTeam } = await workspacesOf(user.id);
  if (ownsTeam) throw new HttpError(409, "This login owns a team with other staff. They need to leave the team first (closing the account takes them off it).");
  for (const w of own) guard(actor, { workspaceId: w.id });
  if (await onLegalHold(user.id)) throw new HttpError(409, LEGAL_HOLD_DELETE);
  // Written now: the account and its workspace are gone afterwards.
  const mail = deletedEmail(user.email, own[0]?.name ?? null, { closed: !!user.closedAt, blocked: await isEmailBlocked(user.email) });
  const { row, out: deleted } = await tracked(
    actor,
    {
      action: "account.delete_now",
      userId: user.id,
      workspaceId: own[0]?.id ?? null,
      target: user.email,
      reason,
      details: {
        notify,
        before: {
          email: user.email,
          createdAt: user.createdAt.toISOString(),
          deleteAt: user.deleteAt?.toISOString() ?? null,
          closedAt: user.closedAt?.toISOString() ?? null,
          workspaces: own.map((w) => ({ id: w.id, name: w.name, plan: w.plan, stripeCustomerId: w.stripeCustomerId, stripeSubscriptionId: w.stripeSubscriptionId })),
        },
      },
    },
    () => purgeAccountNow(user.id, { notify: false }),
    (deleted) => ({ deleted }),
  );
  let emailed = false;
  if (deleted && notify) {
    emailed = await sendMail({ to: user.email, ...mail, replyTo: supportInbox() ?? LEGAL.email }).then(
      () => true,
      (err) => (console.error("[support-console] deleted email failed", row.id, err), false),
    );
  }
  await mergeDetails(row.id, { emailedTo: emailed ? user.email : null });
  return { actionId: row.id, deleted, emailed };
}

/**
 * Cancels the scheduled deletion of an account its holder closed (they asked,
 * from its own address, and can't sign in to keep it themselves). Not for an
 * account support closed: that's reopened after a review instead.
 */
export async function cancelScheduledDeletion(actor: SupportAdmin, o: { userId: string; reason: string; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  guard(actor, { userId: o.userId });
  const user = await loadUser(o.userId);
  if (!user.deleteAt) throw new HttpError(409, "This account isn't scheduled for deletion.");
  if (user.closedAt) throw new HttpError(409, "Support closed this account, so its deletion can't be cancelled. If a review finds the closure was wrong, reopen it instead.");
  if (user.suspendedAt) throw new HttpError(409, "This login is suspended. Unsuspend it first, then cancel the deletion.");
  if (user.deleteAt <= new Date()) throw new HttpError(410, "This account has reached its deletion date, so it can't be kept.");
  const own = await db.workspace.findMany({ where: { deleteAt: { not: null }, members: { some: { userId: user.id } } } });
  for (const w of own) guard(actor, { workspaceId: w.id });
  const { row, out } = await tracked(
    actor,
    {
      action: "account.cancel_deletion",
      userId: user.id,
      workspaceId: own[0]?.id ?? null,
      target: user.email,
      reason,
      details: { notify, before: { deleteAt: user.deleteAt.toISOString(), deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null } },
    },
    () => restoreAccount(user.id, { notify: false }),
    (r) => ({ planEnded: r.planEnded, after: { deleteAt: null } }),
  );
  let emailed = false;
  if (notify) {
    const w = own[0];
    emailed = await sendNotice(
      row.id,
      user.email,
      notice({
        subject: `Your ${BRAND.name} account won't be deleted`,
        lead: `As you asked, we've cancelled the deletion of your ${BRAND.name} account (${user.email}). It's open again and won't be deleted.`,
        lines: [
          ...(w ? [{ text: "Clients your plan covers can open their links again." }] : []),
          ...(out.planEnded ? [{ text: "Your subscription ended while your account was closed. Choose a plan in Settings > Billing to subscribe again." }] : []),
        ],
        button: { label: `Open ${BRAND.name}`, link: appUrl("/library") },
        footer: `Didn't ask for this? Contact ${LEGAL.email} straight away.`,
      }),
    );
  }
  return { actionId: row.id, emailed, planEnded: out.planEnded };
}

// ---- 9. Removed clients ----

async function loadClient(clientId: string) {
  const c = await db.client.findUnique({ where: { id: clientId }, include: { workspace: true } });
  if (!c) throw new HttpError(404, "Client not found");
  return c;
}

/**
 * Brings a removed client back (the business asked). Their link works again,
 * or they get a new one if the team's keys were reset meanwhile. With
 * `ignoreSeatLimit`, the newest clients over the plan's seats are paused.
 */
export async function restoreRemovedClient(actor: SupportAdmin, o: { clientId: string; reason: string; ignoreSeatLimit?: boolean; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  const c = await loadClient(o.clientId);
  const ws = c.workspace;
  guard(actor, { workspaceId: ws.id });
  if (!c.removedAt) throw new HttpError(409, "This client hasn't been removed.");
  if (c.purgeAt && c.purgeAt <= new Date()) throw new HttpError(410, "This client's 30 days are up, so they're being deleted and can't be restored.");
  if (ws.deleteAt || ws.closedAt) throw new HttpError(409, "This account is closed, so its clients can't be restored. The account has to be kept or reopened first.");
  if (!o.ignoreSeatLimit) {
    // Checked again, under the seat lock, by restoreClient.
    const seats = await seatUsage(ws);
    if (seats.used >= seats.limit)
      throw new HttpError(402, `All ${seats.limit} client seats are in use. Tick "Restore even if every seat is in use", or ask the business to free a seat.`);
  }
  const own = await owner(ws.id);
  const { row, out } = await tracked(
    actor,
    {
      action: "client.restore",
      workspaceId: ws.id,
      clientId: c.id,
      userId: own?.user.id,
      target: clientLabel(c, ws),
      reason,
      details: { notify, ignoreSeatLimit: !!o.ignoreSeatLimit, before: { removedAt: c.removedAt.toISOString(), purgeAt: c.purgeAt?.toISOString() ?? null } },
    },
    () => restoreClient(ws, c.id, { ignoreSeatLimit: !!o.ignoreSeatLimit }),
    (r) => ({ after: { removedAt: null }, newLink: r.newLink, clientEmailed: r.emailed, paused: r.client.paused, seats: r.seats }),
  );
  let emailed = false;
  if (notify) {
    const over = out.seats.used > out.seats.limit;
    emailed = await sendNotice(
      row.id,
      own?.user.email,
      notice({
        subject: `${c.name} is one of your clients again`,
        lead: `We've restored ${c.name} to ${ws.name}'s clients on ${BRAND.name}.`,
        lines: [
          {
            text: !out.newLink
              ? "Their personal link works again."
              : out.emailed
                ? "Your team's keys were reset while they were removed, so they have a new personal link, which we've emailed to them."
                : "Your team's keys were reset while they were removed, so they have a new personal link. Copy it from the Clients page and send it to them.",
          },
          ...(over
            ? [{ text: `You now have ${out.seats.used} clients and your plan covers ${out.seats.limit}, so the newest ones over that are paused until a seat is free.` }]
            : []),
        ],
        button: { label: "Open Clients", link: clientsPath(ws.id) },
        footer: QUESTIONS,
      }),
    );
  }
  return { actionId: row.id, emailed, newLink: out.newLink, clientEmailed: out.emailed, paused: out.client.paused, seats: out.seats };
}

/** Keeps a removed client CLIENT_KEEP_DAYS longer before they're deleted, so the business has more time to restore them. */
export async function keepRemovedClientLonger(actor: SupportAdmin, o: { clientId: string; reason: string; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  const c = await loadClient(o.clientId);
  const ws = c.workspace;
  guard(actor, { workspaceId: ws.id });
  if (!c.removedAt) throw new HttpError(409, "This client hasn't been removed.");
  // Undated removals get their date (and the owner a notice) from the clean-up job: nothing to extend yet.
  if (!c.purgeAt) throw new HttpError(409, "This client has no deletion date yet. The clean-up job gives them one, and tells the owner, on its next run.");
  if (c.purgeAt <= new Date()) throw new HttpError(410, "This client's 30 days are up, so they're being deleted.");
  const purgeAt = new Date(c.purgeAt.getTime() + CLIENT_KEEP_DAYS * D);
  const own = await owner(ws.id);
  const row = await db.$transaction(async (tx) => {
    const res = await tx.client.updateMany({ where: { id: c.id, removedAt: { not: null }, purgeAt: c.purgeAt }, data: { purgeAt, purgeWarnedAt: null } });
    if (!res.count) throw new HttpError(409, "This client changed meanwhile. Reload and try again.");
    return logAdmin(tx, actor, {
      action: "client.keep_longer",
      workspaceId: ws.id,
      clientId: c.id,
      userId: own?.user.id,
      target: clientLabel(c, ws),
      reason,
      details: { notify, before: { purgeAt: c.purgeAt!.toISOString() }, after: { purgeAt: purgeAt.toISOString() } },
    });
  });
  let emailed = false;
  if (notify) {
    const until = qldDay(purgeAt);
    emailed = await sendNotice(
      row.id,
      own?.user.email,
      notice({
        subject: `${c.name} will be kept until ${until}`,
        lead: `We'll keep ${c.name}, a client removed from ${ws.name}, until ${until}.`,
        lines: [{ text: "Until then you can restore them from Clients > Removed clients. After that their details, videos and messages with you are deleted for good." }],
        button: { label: "Open Clients", link: clientsPath(ws.id) },
        footer: QUESTIONS,
      }),
    );
  }
  return { actionId: row.id, emailed, purgeAt };
}

/**
 * Deletes a removed client for good now, as the clean-up job would at the end
 * of their 30 days (lib/clientRemoval.ts purgeClient). If their files can't be
 * deleted yet, they stay due and the job finishes it within minutes.
 */
export async function deleteRemovedClientNow(actor: SupportAdmin, o: { clientId: string; reason: string; confirm: string; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  const c = await loadClient(o.clientId);
  const ws = c.workspace;
  guard(actor, { workspaceId: ws.id });
  if (!typed(o.confirm, clientDeleteConfirmation(c))) throw new HttpError(400, `Type ${clientDeleteConfirmation(c)} to confirm.`);
  if (!c.removedAt) throw new HttpError(409, "Only a removed client can be deleted here.");
  if (ws.legalHoldAt) throw new HttpError(409, "This workspace is on legal hold, so nothing of it can be deleted until the hold is lifted.");
  const own = await owner(ws.id);
  const now = new Date();
  const row = await db.$transaction(async (tx) => {
    const res = await tx.client.updateMany({ where: { id: c.id, removedAt: { not: null } }, data: { purgeAt: now } });
    if (!res.count) throw new HttpError(409, "This client changed meanwhile. Reload and try again.");
    return logAdmin(tx, actor, {
      action: "client.delete_now",
      workspaceId: ws.id,
      clientId: c.id,
      userId: own?.user.id,
      target: clientLabel(c, ws),
      reason,
      details: { notify, status: "started", before: { removedAt: c.removedAt!.toISOString(), purgeAt: c.purgeAt?.toISOString() ?? null }, after: { purgeAt: now.toISOString() } },
    });
  });
  const result = await purgeClient(c.id, now).catch((err) => {
    console.error(JSON.stringify({ level: "error", message: "[support-console] client delete failed; the clean-up job retries", client: c.id, error: String(err) }));
    return "failed" as const;
  });
  const purged = result === "purged";
  // Not finished here: it's due now, so the clean-up job finishes it within minutes.
  await mergeDetails(row.id, { status: purged ? "done" : result === "failed" ? "retrying" : "skipped" });
  let emailed = false;
  if (notify && purged) {
    emailed = await sendNotice(
      row.id,
      own?.user.email,
      notice({
        subject: `${c.name} has been deleted`,
        lead: `We've deleted ${c.name}, a client removed from ${ws.name}, for good: their details, the videos sent only to them, and their conversations, to-dos and notes.`,
        lines: [{ text: "Recordings you also sent to other clients stay with those clients." }],
        button: { label: "Open Clients", link: clientsPath(ws.id) },
        footer: QUESTIONS,
      }),
    );
  } else if (notify) {
    await mergeDetails(row.id, { emailedTo: null });
  }
  return { actionId: row.id, emailed, result };
}

// ---- 10. Free videos used ----

/** Sets how many videos a workspace has recorded, the count the Free plan's lifetime limit is checked against (corrections). */
export async function setFreeVideosUsed(actor: SupportAdmin, o: { workspaceId: string; value: number; reason: string; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  if (!Number.isInteger(o.value) || o.value < 0 || o.value > 1_000_000) throw new HttpError(400, "Enter a whole number, 0 or more.");
  guard(actor, { workspaceId: o.workspaceId });
  const w = await loadWorkspace(o.workspaceId);
  const own = await owner(w.id);
  const row = await db.$transaction(async (tx) => {
    // Locked, so a recording finishing meanwhile counts after this, not lost under it.
    const [locked] = await tx.$queryRaw<{ videosRecorded: number }[]>`SELECT "videosRecorded" FROM "Workspace" WHERE id = ${w.id} FOR UPDATE`;
    if (!locked) throw new HttpError(404, "Workspace not found");
    if (locked.videosRecorded === o.value) throw new HttpError(409, `It's already ${o.value}.`);
    await tx.workspace.update({ where: { id: w.id }, data: { videosRecorded: o.value } });
    return logAdmin(tx, actor, {
      action: "workspace.videos_recorded",
      workspaceId: w.id,
      userId: own?.user.id,
      target: wsLabel(w, own?.user.email),
      reason,
      details: { notify, before: { videosRecorded: locked.videosRecorded }, after: { videosRecorded: o.value } },
    });
  });
  let emailed = false;
  if (notify) {
    const limit = PLANS.FREE.maxVideos!;
    const { used, uploading } = await videosUsed(w.id);
    emailed = await sendNotice(
      row.id,
      own?.user.email,
      notice({
        subject: "We've corrected your count of videos",
        lead: `We've corrected the number of videos ${w.name} has recorded on ${BRAND.name}. It's now ${o.value}.`,
        lines: [
          w.plan === "FREE"
            ? {
                text:
                  `That's ${Math.min(used, limit)} of the Free plan's ${limit} videos used` +
                  (uploading ? `, including ${uploading === 1 ? "1 recording" : `${uploading} recordings`} still uploading` : "") +
                  `, so you have ${Math.max(0, limit - used)} left.`,
              }
            : { text: `This only matters on the Free plan, which includes ${limit} videos in total.` },
        ],
        button: { label: `Open ${BRAND.name}`, link: appUrl(teamPath("/library", w.id)) },
        footer: QUESTIONS,
      }),
    );
  }
  return { actionId: row.id, emailed };
}

// ---- 11. Billing and seats ----

const billingFields = (w: Workspace) => ({
  plan: w.plan,
  complimentaryPlan: w.complimentaryPlan,
  stripeCustomerId: w.stripeCustomerId,
  stripeSubscriptionId: w.stripeSubscriptionId,
  subscriptionStatus: w.subscriptionStatus,
  billingInterval: w.billingInterval,
  currentPeriodEnd: w.currentPeriodEnd?.toISOString() ?? null,
  cancelsAt: w.cancelsAt?.toISOString() ?? null,
  extraClientSeats: w.extraClientSeats,
  extraStaffSeats: w.extraStaffSeats,
  foundingPrices: w.foundingPrices,
  discountLabel: w.discountLabel,
  cloudBackup: w.cloudBackup,
  aiAssist: w.aiAssist,
});

/** The workspace's subscription in Stripe: the one on file, else the latest one on its customer made for it. */
async function findSubscription(w: Workspace): Promise<{ sub: Stripe.Subscription | null; missing: boolean }> {
  if (w.stripeSubscriptionId) {
    const sub = await stripe()
      .subscriptions.retrieve(w.stripeSubscriptionId)
      .catch((err) => (isMissing(err) ? null : Promise.reject(err)));
    if (sub) return { sub, missing: false };
  }
  let sub: Stripe.Subscription | null = null;
  if (w.stripeCustomerId && (await customerExists(w.stripeCustomerId))) {
    const all = (await stripe().subscriptions.list({ customer: w.stripeCustomerId, status: "all", limit: 20 })).data.filter((s) => s.metadata?.workspaceId === w.id);
    sub = all.find((s) => ACTIVE_STATUSES.has(s.status)) ?? all[0] ?? null;
  }
  return { sub, missing: !!w.stripeSubscriptionId && sub?.id !== w.stripeSubscriptionId };
}

/**
 * Reads the workspace's subscription from Stripe again and applies it, as the
 * webhook does (plan, seats, add-ons, renewal date), for when a webhook was
 * missed. One Stripe no longer has is forgotten. `notify` sends the owner the
 * usual emails if that pauses clients or staff, or ends cloud backup.
 */
export async function resyncBilling(actor: SupportAdmin, o: { workspaceId: string; reason: string; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  guard(actor, { workspaceId: o.workspaceId });
  const w = await loadWorkspace(o.workspaceId);
  if (!process.env.STRIPE_SECRET_KEY) throw new HttpError(409, "Stripe isn't set up on this server.");
  if (!w.stripeSubscriptionId && !w.stripeCustomerId) throw new HttpError(409, "This workspace has no Stripe customer or subscription, so there's nothing to sync.");
  const own = await owner(w.id);
  const before = billingFields(w);
  const { row, out } = await tracked(
    actor,
    { action: "billing.resync", workspaceId: w.id, userId: own?.user.id, target: wsLabel(w, own?.user.email), reason, details: { notify, before } },
    async () => {
      const { sub, missing } = await findSubscription(w);
      if (missing && !sub) await forgetSubscription(w, { customer: !(await customerExists(w.stripeCustomerId)), notify });
      const forMe = !!sub && sub.metadata?.workspaceId === w.id;
      if (sub && forMe) await syncSubscription(sub, { notify });
      const after = billingFields(await db.workspace.findUniqueOrThrow({ where: { id: w.id } }));
      const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
      // A subscription made for another workspace (its metadata says so) is never applied here.
      return { subscription: sub?.id ?? null, stripeStatus: sub?.status ?? null, forgotten: missing && !sub, otherWorkspace: !!sub && !forMe, after, changed };
    },
    (r) => ({ subscription: r.subscription, stripeStatus: r.stripeStatus, forgotten: r.forgotten, otherWorkspace: r.otherWorkspace, after: r.after, changed: r.changed }),
  );
  return { actionId: row.id, ...out };
}

/** Runs the seat check (lib/seatLimits.ts) again: clients and staff over the plan are paused, the rest restored. */
export async function rerunSeatCheck(actor: SupportAdmin, o: { workspaceId: string; reason: string; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  guard(actor, { workspaceId: o.workspaceId });
  const w = await loadWorkspace(o.workspaceId);
  if (w.deleteAt) throw new HttpError(409, "This account is closed, so its clients stay paused until it's kept or reopened.");
  const own = await owner(w.id);
  const paused = async () => ({
    pausedClients: await db.client.count({ where: { workspaceId: w.id, removedAt: null, pausedAt: { not: null } } }),
    pausedStaff: await db.membership.count({ where: { workspaceId: w.id, pausedAt: { not: null } } }),
  });
  const before = await paused();
  const { row, out } = await tracked(
    actor,
    { action: "workspace.seat_check", workspaceId: w.id, userId: own?.user.id, target: wsLabel(w, own?.user.email), reason, details: { notify, before } },
    async () => (await enforceSeatLimits(w.id, { notify }), paused()),
    (after) => ({ after }),
  );
  return { actionId: row.id, before, after: out };
}

// ---- 12. Unblocking an address ----

/** Unblocks an address (lib/support/admin.ts unblockEmail) and, unless unticked, tells it so. */
export async function unblockEmailAndTell(actor: SupportAdmin, o: { email: string; reason: string; notify?: boolean }) {
  const notify = o.notify ?? true;
  const email = o.email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  const { actionId } = await unblockEmail(actor, { email, reason: o.reason });
  await db.adminAction.update({ where: { id: actionId }, data: { userId: user?.id ?? null, details: { notify } } });
  let emailed = false;
  if (notify) {
    const closedUntil = user?.closedAt && user.deleteAt ? qldDay(user.deleteAt) : null;
    emailed = await sendNotice(
      actionId,
      email,
      notice({
        subject: `This email address can be used with ${BRAND.name} again`,
        lead: closedUntil
          ? `This email address (${email}) is no longer blocked from signing up to ${BRAND.name}.`
          : `This email address (${email}) can be used with ${BRAND.name} again.`,
        lines: closedUntil
          ? [{ text: `The account that was closed is still deleted on ${closedUntil}. After that you can sign up again with this address.` }]
          : user
            ? [{ text: "Sign in to carry on." }]
            : [],
        button: closedUntil ? { label: `Visit ${BRAND.name}`, link: appUrl("/") } : { label: "Sign in", link: appUrl("/login") },
        footer: QUESTIONS,
      }),
    );
  }
  return { actionId, emailed };
}
