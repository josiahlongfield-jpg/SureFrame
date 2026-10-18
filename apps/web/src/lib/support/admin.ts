import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { exportAccount, leaveTeam, leaverName } from "@/lib/account";
import { blockedEmailHash } from "@/lib/blockedEmail";
import { BRAND } from "@/lib/brand";
import { qldDay } from "@/lib/support/when";
import { db, type Workspace } from "@/lib/db";
import { alertFounder } from "@/lib/founderAlert";
import { LEGAL } from "@/lib/legal";
import { sendMail } from "@/lib/mail";
import { startBackupEndedClock } from "@/lib/backupEnded";
import { RETENTION_DAYS } from "@/lib/retention";
import { enforceSeatLimits } from "@/lib/seatLimits";
import { HttpError } from "@/lib/session";
import { appUrl, stripe } from "@/lib/stripe";
import { endOpenCheckouts, isMissing } from "@/lib/subscription";
import { isSupportAgent, supportInbox } from "@/lib/support/tickets";
import { teamPath } from "@/lib/teamLink";
import { teamEmail } from "@/lib/teamEmail";
import { ADMIN_ACTION_KEEP_YEARS, CLOSURE_DELETE_DAYS, REVIEW_DAYS } from "@/lib/periods";

/**
 * The founder's support powers: warn, suspend and unsuspend a workspace or a
 * login, close an account for good, legal hold, turn a client's link off and
 * on, sign out everywhere, and block or unblock an email address.
 *
 * Every power needs a support admin (isSupportAdmin) and a written reason
 * (internal, never shown to the customer or the help chat), can't be used on
 * the admin's own login or a workspace they belong to, and is recorded in
 * AdminAction in the same transaction as the change. Unless the admin unticks
 * it (only where the law or someone's safety requires), the owner or the login
 * is emailed a plain SureFrame notice, replies to which reach the support
 * inbox, saying in plain words why and how to ask for a review.
 *
 * What each one does elsewhere: lib/session.ts (suspended members see
 * /suspended, the API answers 403 ACCOUNT_SUSPENDED), src/auth.ts (signed-out
 * sessions, blocked addresses), lib/access.ts (clients' links), and the
 * scheduled jobs (no emails while suspended, nothing deleted under legal hold).
 */

/**
 * Who has the support powers: SUPPORT_ADMINS (comma-separated emails), else
 * SUPPORT_EMAIL alone. Not every SUPPORT_AGENTS member: an agent can answer
 * tickets without being able to suspend or close accounts.
 */
export function isSupportAdmin(email: string | null | undefined) {
  if (!email) return false;
  const admins = (process.env.SUPPORT_ADMINS ?? process.env.SUPPORT_EMAIL ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase());
}

/**
 * The founder: SUPPORT_EMAIL alone, whoever else is a support admin. Only the
 * founder gives discount codes (Josiah, 16 October 2026, "until further notice").
 */
export function isFounder(email: string | null | undefined) {
  const founder = process.env.SUPPORT_EMAIL?.trim().toLowerCase();
  return !!email && !!founder && email.toLowerCase() === founder;
}

export type SupportAdmin = { userId: string; email: string; workspaceIds: string[] };

/**
 * The signed-in support agent (SUPPORT_AGENTS), or null. Suspending an agent's login cuts them off too: only a support
 * admin keeps working while their own login is suspended. A closed account is cut off as well.
 */
export async function activeSupportAgent() {
  const id = (await auth())?.user?.id;
  if (!id) return null;
  const u = await db.user.findUnique({ where: { id }, select: { id: true, email: true, suspendedAt: true, closedAt: true, deleteAt: true } });
  if (!u || u.deleteAt || u.closedAt || !isSupportAgent(u.email)) return null;
  if (u.suspendedAt && !isSupportAdmin(u.email)) return null;
  return u;
}

/** The signed-in support admin, or null. Works while their own workspace is paused or suspended. */
export async function currentSupportAdmin(): Promise<SupportAdmin | null> {
  const id = (await auth())?.user?.id;
  if (!id) return null;
  const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, memberships: { select: { workspaceId: true } } } });
  if (!user || !isSupportAdmin(user.email)) return null;
  return { userId: user.id, email: user.email, workspaceIds: user.memberships.map((m) => m.workspaceId) };
}

/** The signed-in support admin; anyone else gets a 404 (support tools don't announce themselves). */
export async function requireSupportAdmin() {
  const admin = await currentSupportAdmin();
  if (!admin) throw new HttpError(404, "Not found");
  return admin;
}

/** What each logged action is called. */
export type AdminActionName =
  | "account.warn"
  | "workspace.suspend"
  | "workspace.unsuspend"
  | "user.suspend"
  | "user.unsuspend"
  | "account.close"
  | "account.reopen"
  | "workspace.legal_hold_on"
  | "workspace.legal_hold_off"
  | "client.link_off"
  | "client.link_on"
  | "user.sign_out_everywhere"
  | "email.block"
  | "email.unblock"
  // Logged by the support console's other tools.
  | (string & {});

/**
 * Records a support action. Pass the transaction that makes the change, so
 * there's never a change without its record (or a record without its change).
 */
export function logAdmin(
  tx: Pick<Prisma.TransactionClient, "adminAction">,
  actor: Pick<SupportAdmin, "userId" | "email">,
  entry: { action: AdminActionName; workspaceId?: string | null; userId?: string | null; clientId?: string | null; target?: string | null; reason?: string | null; details?: Prisma.InputJsonObject },
) {
  return tx.adminAction.create({ data: { actorUserId: actor.userId, actorEmail: actor.email, ...entry } });
}

/** Support records are kept 7 years (tax and legal-claims periods), then deleted by the daily job. */
export { ADMIN_ACTION_KEEP_YEARS };
export async function pruneAdminActions(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - ADMIN_ACTION_KEEP_YEARS);
  return (await db.adminAction.deleteMany({ where: { createdAt: { lt: cutoff } } })).count;
}

/** The customer-facing reason, in plain words. The admin's own reason stays internal. */
export const NOTICE_REASONS = {
  terms: "because of a breach of our Terms of Service",
  unlawful: "because we believe it was used for something unlawful or harmful",
  fraud: "because of suspected fraud, including payment fraud or false information",
  law: "because the law requires us to",
  safety: "to protect people from harm",
  security: "to protect the account's security",
  request: "at the account holder's request",
} as const;
export type NoticeReason = keyof typeof NOTICE_REASONS;
export const isNoticeReason = (v: unknown): v is NoticeReason => typeof v === "string" && v in NOTICE_REASONS;

/** The internal reason every action needs. */
export function reasonOf(reason: string | null | undefined) {
  const r = (reason ?? "").trim();
  if (!r) throw new HttpError(400, "Write the reason for this (it's kept in the support log, not shown to the customer).");
  if (r.length > 500) throw new HttpError(400, "Keep the reason to 500 characters or fewer.");
  return r;
}

/** A note the customer sees (a suspension note, a warning's message). */
function noteOf(note: string | null | undefined) {
  const n = (note ?? "").trim();
  if (n.length > 1000) throw new HttpError(400, "Keep the note to 1000 characters or fewer.");
  return n || null;
}

/** Support can't lock itself out, or act on its own business. */
export function guard(actor: SupportAdmin, t: { userId?: string | null; workspaceId?: string | null }) {
  if (t.userId && t.userId === actor.userId) throw new HttpError(403, "You can't use this on your own login.");
  if (t.workspaceId && actor.workspaceIds.includes(t.workspaceId)) throw new HttpError(403, "You can't use this on a workspace you belong to.");
}

export const owner = (workspaceId: string) =>
  db.membership.findFirst({ where: { workspaceId, role: "OWNER" }, include: { user: { select: { id: true, email: true, name: true } } } });

export const wsLabel = (w: Pick<Workspace, "name">, ownerEmail?: string | null) => (ownerEmail ? `${w.name} (${ownerEmail})` : w.name);

export async function loadWorkspace(workspaceId: string) {
  const w = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!w) throw new HttpError(404, "Workspace not found");
  return w;
}

export async function loadUser(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw new HttpError(404, "Account not found");
  return u;
}

// ---- Notices: plain SureFrame emails (not branded as the business), replies go to the support inbox ----

export const REVIEW = `If you think this is a mistake, reply to this email or email ${LEGAL.email} within ${REVIEW_DAYS} days and we'll review it.`;
export const QUESTIONS = `Questions? Reply to this email or contact ${LEGAL.email}.`;
export const termsLine = () => ({ text: "Our Terms of Service", link: appUrl("/legal/terms") });

export function notice(o: { subject: string; lead: string; lines?: { text: string; link?: string }[]; note?: string | null; footer: string; button?: { label: string; link: string } }) {
  return teamEmail({
    business: BRAND.name,
    subject: o.subject,
    lead: o.lead,
    lines: o.lines,
    note: o.note ? `A note from ${BRAND.name} support:\n${o.note}` : undefined,
    button: o.button ?? { label: "Contact support", link: `mailto:${LEGAL.email}` },
    footer: o.footer,
  });
}

/** Sends a notice and records on the action whether it went. Never throws: the change has been made. */
export async function sendNotice(actionId: string, to: string | null | undefined, mail: ReturnType<typeof notice>) {
  let emailed = false;
  if (to) {
    emailed = await sendMail({ to, ...mail, replyTo: supportInbox() ?? LEGAL.email }).then(
      () => true,
      (err) => (console.error(JSON.stringify({ level: "error", message: "[support-admin] notice email failed", action: actionId, error: String(err) })), false),
    );
  }
  const row = await db.adminAction.findUnique({ where: { id: actionId }, select: { details: true } });
  const details = (row?.details && typeof row.details === "object" && !Array.isArray(row.details) ? row.details : {}) as Prisma.JsonObject;
  await db.adminAction.update({ where: { id: actionId }, data: { details: { ...details, emailedTo: emailed ? to! : null } } });
  return emailed;
}

// ---- Billing ----

/** Turns renewal off (suspension's "Stop renewal at period end"). Throws if Stripe can't be reached, before anything changes. */
async function stopRenewalAtPeriodEnd(w: Workspace) {
  if (!process.env.STRIPE_SECRET_KEY || !w.stripeSubscriptionId) return null;
  const sub = await stripe().subscriptions.retrieve(w.stripeSubscriptionId).catch((err) => (isMissing(err) ? null : Promise.reject(err)));
  if (!sub || (sub.status !== "active" && sub.status !== "trialing")) return null;
  if (sub.cancel_at_period_end || sub.cancel_at)
    return { subscription: sub.id, renewal: "already ending" as const, endsAt: (sub.cancel_at ? new Date(sub.cancel_at * 1000) : w.currentPeriodEnd)?.toISOString() ?? null };
  await stripe().subscriptions.update(sub.id, { cancel_at_period_end: true });
  await db.workspace.update({ where: { id: w.id }, data: { cancelsAt: w.currentPeriodEnd } });
  return { subscription: sub.id, renewal: "stopped" as const, endsAt: w.currentPeriodEnd?.toISOString() ?? null };
}

/**
 * Turns renewal back on (unsuspending with "Resume renewal"), if the subscription is still running and no payment
 * has been disputed (a dispute stops renewal too, api/webhooks/stripe; a person turns it back on in Stripe).
 */
async function resumeRenewal(w: Workspace) {
  if (!process.env.STRIPE_SECRET_KEY || !w.stripeSubscriptionId) return null;
  const sub = await stripe().subscriptions.retrieve(w.stripeSubscriptionId).catch((err) => (isMissing(err) ? null : Promise.reject(err)));
  if (!sub || (sub.status !== "active" && sub.status !== "trialing")) return { renewal: "ended" as const };
  if (!sub.cancel_at_period_end) return { subscription: sub.id, renewal: "already renewing" as const };
  const charges = w.stripeCustomerId ? await stripe().charges.list({ customer: w.stripeCustomerId, limit: 100 }) : null;
  if (charges?.data.some((c) => c.disputed)) return { subscription: sub.id, renewal: "disputed" as const };
  await stripe().subscriptions.update(sub.id, { cancel_at_period_end: false });
  await db.workspace.update({ where: { id: w.id }, data: { cancelsAt: null } });
  return { subscription: sub.id, renewal: "resumed" as const };
}

/** Cancels a closed account's subscription now: no further charges. Refunds are made in Stripe by a person where the law requires. */
async function cancelNow(w: Workspace) {
  if (!process.env.STRIPE_SECRET_KEY || !w.stripeSubscriptionId) return null;
  const sub = await stripe().subscriptions.retrieve(w.stripeSubscriptionId).catch((err) => (isMissing(err) ? null : Promise.reject(err)));
  if (!sub || sub.status === "canceled" || sub.status === "incomplete_expired") return null;
  await stripe().subscriptions.cancel(sub.id);
  return { subscription: sub.id, cancelled: true };
}

const billingFailed = (err: unknown): never => {
  throw new HttpError(502, `Stripe couldn't be updated (${String((err as Error)?.message ?? err).slice(0, 200)}), so nothing was changed. Try again.`);
};

// ---- 1. Warning ----

/** Emails the owner of a workspace (or a login) a warning. Nothing else changes. */
export async function warn(actor: SupportAdmin, o: { workspaceId?: string; userId?: string; reason: string; category: NoticeReason; message?: string | null }) {
  const reason = reasonOf(o.reason);
  const message = noteOf(o.message);
  guard(actor, { userId: o.userId, workspaceId: o.workspaceId });
  const w = o.workspaceId ? await loadWorkspace(o.workspaceId) : null;
  const own = w ? await owner(w.id) : null;
  const user = o.userId ? await loadUser(o.userId) : own?.user;
  if (!user) throw new HttpError(404, "Nobody to warn");
  const row = await db.$transaction((tx) =>
    logAdmin(tx, actor, {
      action: "account.warn",
      workspaceId: w?.id,
      userId: user.id,
      target: w ? wsLabel(w, own?.user.email) : user.email,
      reason,
      details: { category: o.category, message },
    }),
  );
  const mail = notice({
    subject: `A warning about your ${BRAND.name} account`,
    lead: `We're writing about ${w ? `${w.name} on ${BRAND.name}` : `your ${BRAND.name} login (${user.email})`} ${NOTICE_REASONS[o.category]}.`,
    lines: [
      { text: "Please make sure the account is used in line with our Terms of Service. If the problem continues, we may suspend or close the account." },
      termsLine(),
    ],
    note: message,
    footer: REVIEW,
  });
  const emailed = await sendNotice(row.id, user.email, mail);
  return { actionId: row.id, emailed };
}

// ---- 2. Suspend / unsuspend a workspace ----

/**
 * Suspends a workspace: its members see the suspended page (the API answers
 * 403 ACCOUNT_SUSPENDED, so unfinished uploads stay on their devices), its
 * clients see that its videos are unavailable, and nothing is emailed in its
 * name (reminders stay unsent). Nothing is deleted because of it; recordings
 * still expire and removed clients are still deleted on their dates, unless
 * the workspace is on legal hold. Billing carries on unless `stopRenewal`.
 */
export async function suspendWorkspace(
  actor: SupportAdmin,
  o: { workspaceId: string; reason: string; category: NoticeReason; note?: string | null; notify?: boolean; stopRenewal?: boolean },
) {
  const reason = reasonOf(o.reason);
  const note = noteOf(o.note);
  const notify = o.notify ?? true;
  guard(actor, { workspaceId: o.workspaceId });
  const w = await loadWorkspace(o.workspaceId);
  if (w.closedAt) throw new HttpError(409, "This account has been closed.");
  if (w.suspendedAt) throw new HttpError(409, "This workspace is already suspended.");
  const own = await owner(w.id);
  const billing = o.stopRenewal ? await stopRenewalAtPeriodEnd(w).catch(billingFailed) : null;
  const now = new Date();
  const row = await db.$transaction(async (tx) => {
    const res = await tx.workspace.updateMany({ where: { id: w.id, suspendedAt: null, closedAt: null }, data: { suspendedAt: now, suspendedReason: reason, suspendedNote: note } });
    if (!res.count) throw new HttpError(409, "This workspace is already suspended.");
    return logAdmin(tx, actor, {
      action: "workspace.suspend",
      workspaceId: w.id,
      userId: own?.user.id,
      target: wsLabel(w, own?.user.email),
      reason,
      details: { category: o.category, note, notify, billing, before: { suspendedAt: null }, after: { suspendedAt: now.toISOString() } },
    });
  });
  let emailed = false;
  if (notify) {
    // Set to end, whether this suspension stopped renewal or it already was (cancelled in Manage subscription, a dispute, closing the account).
    const ending = billing?.renewal === "stopped" || billing?.renewal === "already ending" || (!billing && !!w.stripeSubscriptionId && !!w.cancelsAt);
    const endsAt = billing?.endsAt ? new Date(billing.endsAt) : w.cancelsAt;
    const ends = endsAt ? qldDay(endsAt) : null;
    const lines = [
      { text: "Nobody on your team can use it while it's suspended, and your clients see that your videos are unavailable right now. Nothing has been deleted." },
      { text: "Reminders and other emails from SureFrame to you, your team and your clients are paused." },
      // The same whatever else is going on (a legal hold is never given away by what's left out).
      { text: "The usual deletion schedules in our Terms carry on: recordings without cloud backup still leave our servers, and removed clients are deleted when their 30 days end." },
      ...(ending
        ? [
            { text: `Your subscription won't renew${ends ? `, so it ends on ${ends}` : ""}. You can still manage it when you sign in.` },
            ...(w.cloudBackup
              ? [{ text: `Cloud backup ends with your plan. Backed-up recordings are kept while the account is suspended; once it's lifted, our copies are deleted ${RETENTION_DAYS} days later unless you subscribe again with cloud backup.` }]
              : []),
          ]
        : w.stripeSubscriptionId
          ? [{ text: "Your subscription carries on. You can still manage or cancel it when you sign in." }]
          : []),
      termsLine(),
    ];
    emailed = await sendNotice(
      row.id,
      own?.user.email,
      notice({ subject: `Your ${BRAND.name} account has been suspended`, lead: `We've suspended ${w.name} on ${BRAND.name} ${NOTICE_REASONS[o.category]}.`, lines, note, footer: REVIEW }),
    );
  }
  return { actionId: row.id, emailed, billing };
}

/** Whether the last suspension stopped renewal, so unsuspending can offer to turn it back on. */
export async function renewalStoppedBySuspension(workspaceId: string) {
  const last = await db.adminAction.findFirst({ where: { workspaceId, action: "workspace.suspend" }, orderBy: { createdAt: "desc" }, select: { details: true } });
  const billing = (last?.details as { billing?: { renewal?: string } } | null)?.billing;
  return billing?.renewal === "stopped";
}

/**
 * Lifts a suspension. Reminders that came due meanwhile are skipped (not sent
 * late); `resumeRenewal` turns renewal back on if the subscription is still running.
 */
export async function unsuspendWorkspace(actor: SupportAdmin, o: { workspaceId: string; reason: string; notify?: boolean; resumeRenewal?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  guard(actor, { workspaceId: o.workspaceId });
  const w = await loadWorkspace(o.workspaceId);
  if (w.closedAt) throw new HttpError(409, "This account was closed. Reopen it instead, after a review.");
  if (!w.suspendedAt) throw new HttpError(409, "This workspace isn't suspended.");
  const own = await owner(w.id);
  const billing = o.resumeRenewal ? await resumeRenewal(w).catch(billingFailed) : null;
  const now = new Date();
  const row = await db.$transaction(async (tx) => {
    const res = await tx.workspace.updateMany({ where: { id: w.id, suspendedAt: { not: null }, closedAt: null }, data: { suspendedAt: null, suspendedReason: null, suspendedNote: null } });
    if (!res.count) throw new HttpError(409, "This workspace isn't suspended.");
    const skipped = await tx.reminder.updateMany({ where: { sentAt: null, sendAt: { lte: now }, item: { workspaceId: w.id } }, data: { sentAt: now, error: "suspended" } });
    // Uploads refused meanwhile (lib/retention.ts abortStaleUploads) get a new week to finish.
    await tx.video.updateMany({ where: { workspaceId: w.id, status: "RECORDING" }, data: { updatedAt: now } });
    return logAdmin(tx, actor, {
      action: "workspace.unsuspend",
      workspaceId: w.id,
      userId: own?.user.id,
      target: wsLabel(w, own?.user.email),
      reason,
      details: {
        notify,
        billing,
        remindersSkipped: skipped.count,
        before: { suspendedAt: w.suspendedAt!.toISOString(), suspendedReason: w.suspendedReason, suspendedNote: w.suspendedNote },
        after: { suspendedAt: null },
      },
    });
  });
  // Cloud backup that ended while it was suspended: the recordings' 30 days start now, and the owner is told the date.
  await startBackupEndedClock(w.id).catch((err) => console.error("[support-admin] backup clock after unsuspending", w.id, err));
  let emailed = false;
  if (notify) {
    emailed = await sendNotice(
      row.id,
      own?.user.email,
      notice({
        subject: `Your ${BRAND.name} account is no longer suspended`,
        lead: `${w.name} is no longer suspended. You and your team can use it again, and clients your plan covers can open their videos again.`,
        lines: [
          { text: "Reminders that came due while it was suspended weren't sent." },
          ...(billing?.renewal === "resumed" ? [{ text: "Your subscription renews as normal again." }] : []),
        ],
        button: { label: `Open ${BRAND.name}`, link: appUrl(teamPath("/library", w.id)) },
        footer: QUESTIONS,
      }),
    );
  }
  return { actionId: row.id, emailed, billing };
}

// ---- 3. Suspend / unsuspend a login ----

/** Suspends one login everywhere: it sees the suspended page on every workspace, can't join teams or use the app, and gets no team emails. */
export async function suspendUser(actor: SupportAdmin, o: { userId: string; reason: string; category: NoticeReason; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  guard(actor, { userId: o.userId });
  const user = await loadUser(o.userId);
  if (user.suspendedAt) throw new HttpError(409, "This login is already suspended.");
  const now = new Date();
  const row = await db.$transaction(async (tx) => {
    const res = await tx.user.updateMany({ where: { id: user.id, suspendedAt: null }, data: { suspendedAt: now, suspendedReason: reason } });
    if (!res.count) throw new HttpError(409, "This login is already suspended.");
    return logAdmin(tx, actor, { action: "user.suspend", userId: user.id, target: user.email, reason, details: { category: o.category, notify, before: { suspendedAt: null }, after: { suspendedAt: now.toISOString() } } });
  });
  let emailed = false;
  if (notify) {
    emailed = await sendNotice(
      row.id,
      user.email,
      notice({
        subject: `Your ${BRAND.name} login has been suspended`,
        lead: `We've suspended your ${BRAND.name} login (${user.email}) ${NOTICE_REASONS[o.category]}.`,
        lines: [{ text: "You can't use SureFrame with it while it's suspended. Nothing has been deleted." }, termsLine()],
        footer: REVIEW,
      }),
    );
  }
  return { actionId: row.id, emailed };
}

export async function unsuspendUser(actor: SupportAdmin, o: { userId: string; reason: string; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  guard(actor, { userId: o.userId });
  const user = await loadUser(o.userId);
  if (user.closedAt) throw new HttpError(409, "This account was closed. Reopen it instead, after a review.");
  if (!user.suspendedAt) throw new HttpError(409, "This login isn't suspended.");
  const row = await db.$transaction(async (tx) => {
    const res = await tx.user.updateMany({ where: { id: user.id, suspendedAt: { not: null }, closedAt: null }, data: { suspendedAt: null, suspendedReason: null } });
    if (!res.count) throw new HttpError(409, "This login isn't suspended.");
    // Its uploads refused meanwhile (lib/retention.ts abortStaleUploads) get a new week to finish.
    await tx.video.updateMany({ where: { status: "RECORDING", OR: [{ ownerId: user.id }, { asReply: { is: { authorUserId: user.id } } }] }, data: { updatedAt: new Date() } });
    return logAdmin(tx, actor, {
      action: "user.unsuspend",
      userId: user.id,
      target: user.email,
      reason,
      details: { notify, before: { suspendedAt: user.suspendedAt!.toISOString(), suspendedReason: user.suspendedReason }, after: { suspendedAt: null } },
    });
  });
  let emailed = false;
  if (notify) {
    emailed = await sendNotice(
      row.id,
      user.email,
      notice({
        subject: `Your ${BRAND.name} login is no longer suspended`,
        lead: `Your ${BRAND.name} login (${user.email}) is no longer suspended. You can sign in and use it again.`,
        button: { label: `Open ${BRAND.name}`, link: appUrl("/library") },
        footer: QUESTIONS,
      }),
    );
  }
  return { actionId: row.id, emailed };
}

// ---- 4. Close an account for good ----

/** What the admin types to confirm a closure. */
export const closeConfirmation = (email: string) => `CLOSE ${email}`;

/**
 * Closes an account permanently, straight away and without warning (a serious
 * or repeated breach of the Terms, or unlawful or harmful use). For the login
 * and every workspace it owns or is alone in:
 * - Stripe first: the subscription is cancelled now (no further charges). If
 *   Stripe can't be reached nothing changes.
 * - suspended and marked closed, signed out everywhere, invites cancelled, and
 *   deleted for good CLOSURE_DELETE_DAYS later by the account purge (unless on
 *   legal hold), or on the date already set if its holder had deleted it
 *   themselves. The account holder can't keep it (lib/accountDeletion.ts).
 * - staff of a closed workspace leave it (they keep their own logins), and the
 *   login leaves any team it was staff on.
 * - optionally the address is blocked from signing up again, and legal hold set.
 */
export async function closeAccount(
  actor: SupportAdmin,
  o: { userId: string; reason: string; category: NoticeReason; confirm: string; notify?: boolean; blockEmail?: boolean; legalHold?: boolean },
) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  guard(actor, { userId: o.userId });
  const user = await loadUser(o.userId);
  if (o.confirm.trim().toLowerCase() !== closeConfirmation(user.email).toLowerCase()) throw new HttpError(400, `Type ${closeConfirmation(user.email)} to confirm.`);
  if (user.closedAt) throw new HttpError(409, "This account is already closed.");
  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    include: { workspace: { include: { _count: { select: { members: true } } } } },
    orderBy: { id: "asc" },
  });
  // Closed with the login: what it owns, and anywhere it's alone. Elsewhere it just leaves the team.
  const closing = memberships.filter((m) => m.role === "OWNER" || m.workspace._count.members === 1).map((m) => m.workspace);
  const leaving = memberships.filter((m) => m.role !== "OWNER" && m.workspace._count.members > 1).map((m) => m.workspace);
  for (const w of closing) guard(actor, { workspaceId: w.id });

  const billing: Record<string, unknown> = {};
  for (const w of closing) {
    billing[w.id] = await cancelNow(w).catch(billingFailed);
    await endOpenCheckouts(w);
  }

  const now = new Date();
  // After the review window, so a review can still reopen it. An earlier date (they'd already deleted it themselves) stays.
  const closureDate = new Date(now.getTime() + CLOSURE_DELETE_DAYS * 86_400_000);
  const selfDeleted = !!user.deleteAt && user.deleteAt < closureDate;
  const deleteAt = selfDeleted ? user.deleteAt! : closureDate;
  const closingIds = closing.map((w) => w.id);
  const row = await db.$transaction(async (tx) => {
    const res = await tx.user.updateMany({
      where: { id: user.id, closedAt: null },
      data: {
        closedAt: now,
        suspendedAt: user.suspendedAt ?? now,
        suspendedReason: user.suspendedReason ?? reason,
        deleteAt,
        deletionRequestedAt: user.deletionRequestedAt ?? now,
        // Signed out on every device, now.
        sessionsValidAfter: now,
        activeWorkspaceId: null,
      },
    });
    if (!res.count) throw new HttpError(409, "This account is already closed.");
    for (const w of closing) {
      await tx.workspace.update({
        where: { id: w.id },
        data: {
          closedAt: now,
          suspendedAt: w.suspendedAt ?? now,
          suspendedReason: w.suspendedReason ?? reason,
          deleteAt,
          ...(o.legalHold && !w.legalHoldAt ? { legalHoldAt: now, legalHoldReason: reason } : {}),
        },
      });
    }
    await tx.invite.updateMany({ where: { workspaceId: { in: closingIds }, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await tx.mobileCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
    await tx.verificationToken.deleteMany({ where: { identifier: user.email } });
    if (o.blockEmail) {
      await tx.blockedEmail.upsert({
        where: { emailHash: blockedEmailHash(user.email) },
        create: { emailHash: blockedEmailHash(user.email), reason, actorEmail: actor.email, userId: user.id },
        update: {},
      });
    }
    return logAdmin(tx, actor, {
      action: "account.close",
      userId: user.id,
      workspaceId: closing[0]?.id ?? null,
      target: user.email,
      reason,
      details: {
        category: o.category,
        notify,
        blockEmail: !!o.blockEmail,
        legalHold: !!o.legalHold,
        deleteAt: deleteAt.toISOString(),
        deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
        workspaces: closing.map((w) => ({ id: w.id, name: w.name, plan: w.plan })),
        leftTeams: leaving.map((w) => ({ id: w.id, name: w.name })),
        billing: billing as Prisma.InputJsonObject,
      },
    });
  });

  // Staff of a closed workspace leave it; they keep their own logins. The team's emails are paused, so nobody is told by
  // the usual leaver email; they each get their own short notice instead.
  const staffNotices: { email: string; workspace: string }[] = [];
  for (const w of closing) {
    const closed = await db.workspace.findUniqueOrThrow({ where: { id: w.id } });
    const staff = await db.membership.findMany({ where: { workspaceId: w.id, role: { not: "OWNER" }, userId: { not: user.id } }, include: { user: { select: { email: true, name: true } } } });
    for (const m of staff) {
      try {
        if (await leaveTeam(m.userId, closed, leaverName(m.user))) staffNotices.push({ email: m.user.email, workspace: w.name });
      } catch (err) {
        console.error(JSON.stringify({ level: "error", message: "[support-admin] removing staff from a closed workspace failed", workspace: w.id, user: m.userId, error: String(err) }));
        await closeProblem(user.email, `${m.user.email} couldn't be taken off ${w.name}'s team (${String(err)}). Until they are, the account purge won't delete the workspace.`);
      }
    }
  }
  // The login leaves teams it was staff on; their owners hear that its account was closed, not why.
  const teamsLeft: string[] = [];
  for (const w of leaving) {
    try {
      if (await leaveTeam(user.id, w, leaverName(user), { closedBySupport: true })) teamsLeft.push(w.name);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", message: "[support-admin] leaving a team on close failed", workspace: w.id, error: String(err) }));
      await closeProblem(user.email, `The closed login couldn't be taken off ${w.name}'s team (${String(err)}).`);
    }
  }

  let emailed = false;
  if (notify) {
    const w = closing[0];
    const when = qldDay(deleteAt);
    // The Terms give 30 days from the closure both to ask for a review and for a copy of the data: one date for both.
    const reviewBy = qldDay(new Date(now.getTime() + REVIEW_DAYS * 86_400_000));
    const cancelled = Object.values(billing).some(Boolean);
    const lines = [
      { text: "You can't sign in to it any more, and you've been signed out on every device." },
      ...(w ? [{ text: `Your clients can no longer open their videos from ${w.name}, and nothing more is emailed in its name.` }] : []),
      ...(cancelled ? [{ text: "Your subscription has been cancelled, so you won't be charged again." }] : []),
      {
        text:
          (w
            ? `${w.name} and its recordings, clients, to-dos and notes will be deleted for good on ${when}`
            : `Your account will be deleted for good on ${when}`) +
          (selfDeleted ? ", the date set when you deleted your account" : "") +
          `, unless the law requires us to keep ${w ? "them" : "it"} longer.`,
      },
      { text: `To get a copy of your account data, email ${LEGAL.email} by ${reviewBy}.` },
      ...(teamsLeft.length ? [{ text: `You're no longer on the team${teamsLeft.length === 1 ? "" : "s"} of ${teamsLeft.join(", ")}.` }] : []),
      ...(o.blockEmail ? [{ text: `This email address can't be used to sign up to ${BRAND.name} again.` }] : []),
      termsLine(),
    ];
    emailed = await sendNotice(
      row.id,
      user.email,
      notice({
        subject: `Your ${BRAND.name} account has been closed`,
        lead: `We've closed your ${BRAND.name} account (${user.email})${w ? ` and ${w.name}` : ""} ${NOTICE_REASONS[o.category]}. This is permanent.`,
        lines,
        footer: `If you think this is a mistake, reply to this email or email ${LEGAL.email} by ${reviewBy} and we'll review it.`,
      }),
    );
    for (const s of staffNotices) {
      const mail = notice({
        subject: `You're no longer on ${s.workspace}'s team`,
        lead: `${s.workspace}'s ${BRAND.name} account has been closed, so you're no longer on its team.`,
        lines: [{ text: `Your own ${BRAND.name} login still works.` }],
        button: { label: `Open ${BRAND.name}`, link: appUrl("/library") },
        footer: QUESTIONS,
      });
      await sendMail({ to: s.email, ...mail, replyTo: supportInbox() ?? LEGAL.email }).catch((err) => console.error("[support-admin] staff notice failed", err));
    }
  }
  return { actionId: row.id, emailed, deleteAt, workspaces: closing.map((w) => w.id), teamsLeft, staffRemoved: staffNotices.length };
}

/**
 * Sent in place of a sign-in link when someone asks to sign in to an account support closed: its closure email
 * says it can't be signed in to. The sign-in page shows its usual "Check your email", so only whoever reads this
 * inbox learns the account is closed.
 */
export async function sendClosedAccountSignIn(user: { email: string; closedAt: Date; deleteAt: Date | null }) {
  const reviewBy = new Date(user.closedAt.getTime() + REVIEW_DAYS * 86_400_000);
  const mail = notice({
    subject: `Your ${BRAND.name} account is closed`,
    lead: `Someone asked to sign in to ${BRAND.name} as ${user.email}. ${BRAND.name} support closed this account on ${qldDay(user.closedAt)}, so it can't be signed in to, and no sign-in link was sent.`,
    lines: [
      ...(user.deleteAt ? [{ text: `It will be deleted for good on ${qldDay(user.deleteAt)}, unless the law requires us to keep it longer.` }] : []),
      { text: "If you didn't ask to sign in, you can ignore this email." },
    ],
    footer:
      reviewBy > new Date()
        ? `If you think the closure is a mistake, reply to this email or email ${LEGAL.email} by ${qldDay(reviewBy)} and we'll review it.`
        : QUESTIONS,
  });
  await sendMail({ to: user.email, ...mail, replyTo: supportInbox() ?? LEGAL.email });
}

/**
 * Undoes a closure after a review finds it was wrong, before the deletion
 * date. The login and its workspaces open again and the address is unblocked.
 * The cancelled subscription and the staff who were taken off the team don't
 * come back: the owner subscribes again and sends new invites. An account its
 * holder had deleted themselves before support closed it goes back to that:
 * still deleted on its date unless they sign in and keep it.
 */
export async function reopenAccount(actor: SupportAdmin, o: { userId: string; reason: string; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  guard(actor, { userId: o.userId });
  const user = await loadUser(o.userId);
  if (!user.closedAt) throw new HttpError(409, "This account isn't closed.");
  const now = new Date();
  if (user.deleteAt && user.deleteAt <= now) throw new HttpError(410, "This account has reached its deletion date, so it can't be reopened.");
  const closed = await db.workspace.findMany({ where: { closedAt: { not: null }, members: { some: { userId: user.id } } } });
  for (const w of closed) guard(actor, { workspaceId: w.id });
  // They'd deleted it themselves before support closed it (closeAccount stamps both at once otherwise): that request stands.
  const selfDeleted = !!user.deletionRequestedAt && user.deletionRequestedAt < user.closedAt;
  const row = await db.$transaction(async (tx) => {
    const res = await tx.user.updateMany({
      where: { id: user.id, closedAt: { not: null }, deleteAt: { gt: now } },
      data: { closedAt: null, suspendedAt: null, suspendedReason: null, deletionWarnedAt: null, ...(selfDeleted ? {} : { deleteAt: null, deletionRequestedAt: null }) },
    });
    if (!res.count) throw new HttpError(409, "This account can't be reopened now.");
    await tx.workspace.updateMany({
      where: { id: { in: closed.map((w) => w.id) } },
      data: { closedAt: null, suspendedAt: null, suspendedReason: null, suspendedNote: null, ...(selfDeleted ? {} : { deleteAt: null, renewalStoppedAt: null }) },
    });
    // Uploads refused meanwhile (lib/retention.ts abortStaleUploads) get a new week to finish.
    await tx.video.updateMany({ where: { workspaceId: { in: closed.map((w) => w.id) }, status: "RECORDING" }, data: { updatedAt: now } });
    const unblocked = await tx.blockedEmail.deleteMany({ where: { emailHash: blockedEmailHash(user.email) } });
    return logAdmin(tx, actor, {
      action: "account.reopen",
      userId: user.id,
      workspaceId: closed[0]?.id ?? null,
      target: user.email,
      reason,
      details: {
        notify,
        selfDeleted,
        unblocked: unblocked.count > 0,
        workspaces: closed.map((w) => w.id),
        before: { closedAt: user.closedAt!.toISOString(), deleteAt: user.deleteAt?.toISOString() ?? null, deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null },
      },
    });
  });
  // The plan may have changed meanwhile (the subscription was cancelled): clients it covers come back. Not for an
  // account still closed at its holder's request: its clients stay paused until they keep it (lib/accountDeletion.ts).
  if (!selfDeleted) {
    for (const w of closed) {
      await enforceSeatLimits(w.id, { notify: false }).catch((err) => console.error("[support-admin] seat check after reopening", w.id, err));
      // Cloud backup ended with the cancelled subscription: the recordings' 30 days start now, and the owner is told the date.
      await startBackupEndedClock(w.id).catch((err) => console.error("[support-admin] backup clock after reopening", w.id, err));
    }
  }
  let emailed = false;
  if (notify) {
    const hadSub = closed.some((w) => w.stripeSubscriptionId);
    const subLine = hadSub ? [{ text: "Your subscription was cancelled when the account was closed. Choose a plan in Settings > Billing to subscribe again." }] : [];
    const when = user.deleteAt ? qldDay(user.deleteAt) : "";
    emailed = await sendNotice(
      row.id,
      user.email,
      selfDeleted
        ? notice({
            subject: `We've lifted the closure of your ${BRAND.name} account`,
            lead: `We've reviewed the closure of your ${BRAND.name} account (${user.email}) and lifted it. You'd already deleted the account yourself, so it's still due to be deleted for good on ${when}, as you asked.`,
            lines: [{ text: "To keep it instead, sign in before then and choose Keep my account." }, ...(hadSub ? [{ text: "Your subscription was cancelled when the account was closed, so if you keep it you'd need to subscribe again." }] : [])],
            button: { label: "Keep my account", link: appUrl("/account/restore") },
            footer: QUESTIONS,
          })
        : notice({
            subject: `Your ${BRAND.name} account is open again`,
            lead: `We've reviewed the closure of your ${BRAND.name} account (${user.email}) and opened it again. It won't be deleted.`,
            lines: [{ text: "Sign in to carry on. Clients your plan covers can open their videos again." }, ...subLine, { text: "Anyone who was on your team needs a new invite." }],
            button: { label: `Open ${BRAND.name}`, link: appUrl("/library") },
            footer: QUESTIONS,
          }),
    );
  }
  return { actionId: row.id, emailed, selfDeleted };
}

// ---- 5. Legal hold ----

/**
 * Legal hold on or off. While on, no automatic clean-up deletes anything of
 * the workspace (recordings' relay expiry, unfinished uploads, removed
 * clients, the account deletion). For keeping data when the law requires it
 * or for a report to the authorities, so nobody is emailed about it. Once
 * lifted, anything already past its date is deleted on the next run.
 */
export async function setLegalHold(actor: SupportAdmin, o: { workspaceId: string; on: boolean; reason: string }) {
  const reason = reasonOf(o.reason);
  guard(actor, { workspaceId: o.workspaceId });
  const w = await loadWorkspace(o.workspaceId);
  if (o.on === !!w.legalHoldAt) throw new HttpError(409, o.on ? "This workspace is already on legal hold." : "This workspace isn't on legal hold.");
  const own = await owner(w.id);
  const now = new Date();
  const row = await db.$transaction(async (tx) => {
    const res = await tx.workspace.updateMany({
      where: { id: w.id, legalHoldAt: o.on ? null : { not: null } },
      data: o.on ? { legalHoldAt: now, legalHoldReason: reason } : { legalHoldAt: null, legalHoldReason: null },
    });
    if (!res.count) throw new HttpError(409, "The legal hold changed meanwhile. Reload and try again.");
    return logAdmin(tx, actor, {
      action: o.on ? "workspace.legal_hold_on" : "workspace.legal_hold_off",
      workspaceId: w.id,
      userId: own?.user.id,
      target: wsLabel(w, own?.user.email),
      reason,
      details: { before: { legalHoldAt: w.legalHoldAt?.toISOString() ?? null, legalHoldReason: w.legalHoldReason }, after: { legalHoldAt: o.on ? now.toISOString() : null } },
    });
  });
  return { actionId: row.id };
}

// ---- 6. A client's link off / on ----

/**
 * Turns a client's personal link off: they can't open anything and can't be
 * sent anything, and the business sees "Link off". The seat stays in use and
 * the flag survives key resets (which don't email them a new link).
 */
export async function disableClientLink(actor: SupportAdmin, o: { clientId: string; reason: string; category: NoticeReason; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  const client = await db.client.findUnique({ where: { id: o.clientId }, include: { workspace: true } });
  if (!client) throw new HttpError(404, "Client not found");
  guard(actor, { workspaceId: client.workspaceId });
  if (client.removedAt) throw new HttpError(409, "This client has been removed, so their link already doesn't work.");
  if (client.linkDisabledAt) throw new HttpError(409, "This client's link is already off.");
  const own = await owner(client.workspaceId);
  const now = new Date();
  const row = await db.$transaction(async (tx) => {
    const res = await tx.client.updateMany({ where: { id: client.id, linkDisabledAt: null }, data: { linkDisabledAt: now, linkDisabledReason: reason } });
    if (!res.count) throw new HttpError(409, "This client's link is already off.");
    return logAdmin(tx, actor, {
      action: "client.link_off",
      workspaceId: client.workspaceId,
      clientId: client.id,
      userId: own?.user.id,
      target: `${client.name}${client.email ? ` <${client.email}>` : ""} of ${client.workspace.name}`,
      reason,
      details: { category: o.category, notify, before: { linkDisabledAt: null }, after: { linkDisabledAt: now.toISOString() } },
    });
  });
  let emailed = false;
  if (notify) {
    emailed = await sendNotice(
      row.id,
      own?.user.email,
      notice({
        subject: `${client.name}'s link has been turned off`,
        lead: `We've turned off ${client.name}'s personal link to ${client.workspace.name} on ${BRAND.name} ${NOTICE_REASONS[o.category]}.`,
        lines: [
          { text: `${client.name} can't open their videos or be sent new ones, and they still use a client seat. Nothing has been deleted.` },
          termsLine(),
        ],
        footer: REVIEW,
      }),
    );
  }
  return { actionId: row.id, emailed };
}

export async function enableClientLink(actor: SupportAdmin, o: { clientId: string; reason: string; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  const client = await db.client.findUnique({ where: { id: o.clientId }, include: { workspace: true } });
  if (!client) throw new HttpError(404, "Client not found");
  guard(actor, { workspaceId: client.workspaceId });
  if (!client.linkDisabledAt) throw new HttpError(409, "This client's link isn't off.");
  const own = await owner(client.workspaceId);
  const row = await db.$transaction(async (tx) => {
    const res = await tx.client.updateMany({ where: { id: client.id, linkDisabledAt: { not: null } }, data: { linkDisabledAt: null, linkDisabledReason: null } });
    if (!res.count) throw new HttpError(409, "This client's link isn't off.");
    // Their replies refused meanwhile (lib/retention.ts abortStaleUploads) get a new week to finish.
    await tx.video.updateMany({ where: { status: "RECORDING", asReply: { is: { authorUserId: null, video: { clientId: client.id } } } }, data: { updatedAt: new Date() } });
    return logAdmin(tx, actor, {
      action: "client.link_on",
      workspaceId: client.workspaceId,
      clientId: client.id,
      userId: own?.user.id,
      target: `${client.name}${client.email ? ` <${client.email}>` : ""} of ${client.workspace.name}`,
      reason,
      details: { notify, before: { linkDisabledAt: client.linkDisabledAt!.toISOString(), linkDisabledReason: client.linkDisabledReason }, after: { linkDisabledAt: null } },
    });
  });
  let emailed = false;
  if (notify) {
    const works = !client.removedAt && !client.pausedAt && !client.workspace.suspendedAt && !client.workspace.closedAt && !client.workspace.deleteAt;
    emailed = await sendNotice(
      row.id,
      own?.user.email,
      notice({
        subject: `${client.name}'s link has been turned back on`,
        lead: `We've turned ${client.name}'s personal link to ${client.workspace.name} back on.` + (works ? ` ${client.name} can open their videos and be sent new ones again.` : ""),
        button: { label: "Open Clients", link: appUrl(teamPath("/clients", client.workspaceId)) },
        footer: QUESTIONS,
      }),
    );
  }
  return { actionId: row.id, emailed };
}

// ---- 7. Sign out everywhere ----

/**
 * Ends every sign-in this login has, on every device and in the mobile app
 * (src/auth.ts rejects tokens from before now), plus unused sign-in links and
 * app hand-over codes. Signing in again works as normal; devices keep their
 * encryption keys.
 */
export async function signOutEverywhere(actor: SupportAdmin, o: { userId: string; reason: string; category?: NoticeReason; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const notify = o.notify ?? true;
  guard(actor, { userId: o.userId });
  const user = await loadUser(o.userId);
  const now = new Date();
  const row = await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { sessionsValidAfter: now } });
    await tx.mobileCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
    await tx.verificationToken.deleteMany({ where: { identifier: user.email } });
    return logAdmin(tx, actor, {
      action: "user.sign_out_everywhere",
      userId: user.id,
      target: user.email,
      reason,
      details: { category: o.category ?? null, notify, before: { sessionsValidAfter: user.sessionsValidAfter?.toISOString() ?? null }, after: { sessionsValidAfter: now.toISOString() } },
    });
  });
  let emailed = false;
  if (notify) {
    emailed = await sendNotice(
      row.id,
      user.email,
      notice({
        subject: `You've been signed out of ${BRAND.name} everywhere`,
        lead: `We've signed your ${BRAND.name} login (${user.email}) out on every device${o.category ? ` ${NOTICE_REASONS[o.category]}` : ""}.`,
        lines: [{ text: "Sign in again to carry on. A browser you've used before keeps its encryption keys, so it won't ask for your recovery key." }],
        button: { label: "Sign in", link: appUrl("/login") },
        footer: `Didn't expect this? Reply to this email or contact ${LEGAL.email}.`,
      }),
    );
  }
  return { actionId: row.id, emailed };
}

// ---- Blocking an address ----

/**
 * Stops an address signing in or signing up, by any method (src/auth.ts).
 * Only a hash of it is stored in the block list (lib/blockedEmail.ts). When
 * it's an existing login's address, the login is emailed why (unless
 * unticked), and a login whose plan still renews can't be blocked on its own:
 * it would be charged without being able to sign in to cancel.
 */
export async function blockEmail(actor: SupportAdmin, o: { email: string; reason: string; userId?: string | null; category?: NoticeReason; notify?: boolean }) {
  const reason = reasonOf(o.reason);
  const email = o.email.trim().toLowerCase();
  if (!email.includes("@")) throw new HttpError(400, "Enter an email address.");
  if (blockedEmailHash(email) === blockedEmailHash(actor.email)) throw new HttpError(403, "You can't block your own address.");
  const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true } });
  guard(actor, { userId: user?.id });
  if (user && !o.category) throw new HttpError(400, "Choose the reason the email gives.");
  const renewing = user
    ? await db.workspace.findFirst({ where: { members: { some: { userId: user.id, role: "OWNER" } }, stripeSubscriptionId: { not: null }, cancelsAt: null, closedAt: null } })
    : null;
  if (renewing)
    throw new HttpError(
      409,
      `${renewing.name}'s subscription still renews, and a blocked address can't sign in to cancel it. Close the account (it can block the address), or suspend the workspace with Stop renewal first.`,
    );
  const notify = !!user && (o.notify ?? true);
  const hash = blockedEmailHash(email);
  const row = await db.$transaction(async (tx) => {
    if (await tx.blockedEmail.findUnique({ where: { emailHash: hash } })) throw new HttpError(409, "This address is already blocked.");
    await tx.blockedEmail.create({ data: { emailHash: hash, reason, actorEmail: actor.email, userId: o.userId ?? user?.id ?? null } });
    return logAdmin(tx, actor, { action: "email.block", userId: o.userId ?? user?.id ?? null, target: email, reason, details: { category: o.category ?? null, notify } });
  });
  let emailed = false;
  if (notify && user && o.category) {
    emailed = await sendNotice(
      row.id,
      user.email,
      notice({
        subject: `This email address can no longer be used with ${BRAND.name}`,
        lead: `We've stopped this email address (${email}) being used to sign in or sign up to ${BRAND.name} ${NOTICE_REASONS[o.category]}.`,
        lines: [{ text: "Nothing has been deleted by this." }, termsLine()],
        footer: REVIEW,
      }),
    );
  }
  return { actionId: row.id, emailed };
}

export async function unblockEmail(actor: SupportAdmin, o: { email: string; reason: string }) {
  const reason = reasonOf(o.reason);
  const email = o.email.trim().toLowerCase();
  const hash = blockedEmailHash(email);
  const row = await db.$transaction(async (tx) => {
    const gone = await tx.blockedEmail.deleteMany({ where: { emailHash: hash } });
    if (!gone.count) throw new HttpError(404, "This address isn't blocked.");
    return logAdmin(tx, actor, { action: "email.unblock", target: email, reason });
  });
  return { actionId: row.id };
}

/**
 * The account's data download (the same as Settings > Account), for an
 * account that can't sign in to get it: one support closed, or whose address
 * is blocked. Support sends it to the account's own address. Logged.
 */
export async function exportUserData(actor: SupportAdmin, o: { userId: string; reason: string }) {
  const reason = reasonOf(o.reason);
  guard(actor, { userId: o.userId });
  const user = await loadUser(o.userId);
  const data = await exportAccount(user.id);
  const row = await logAdmin(db, actor, { action: "account.export", userId: user.id, target: user.email, reason });
  return { actionId: row.id, email: user.email, data };
}

/** Lets the founder know when a closure couldn't tidy up after itself. Never throws: the account is closed. */
async function closeProblem(email: string, problem: string) {
  await alertFounder(`Closing ${email} needs a look`, [problem, "The account is closed either way. Check the logs and finish this by hand."]).catch((err) => console.error("[support-admin] alert failed", err));
}
