import type Stripe from "stripe";
import { db, type Workspace } from "@/lib/db";
import { deleteAccount, leaveTeam, leaverName } from "@/lib/account";
import { startBackupEndedClock } from "@/lib/backupEnded";
import { BRAND } from "@/lib/brand";
import { zoned } from "@/lib/dates";
import { isEmailBlocked } from "@/lib/blockedEmail";
import { alertFounder } from "@/lib/founderAlert";
import { LEGAL } from "@/lib/legal";
import { sendMail } from "@/lib/mail";
import { PLANS } from "@/lib/plans";
import { rateLimit } from "@/lib/rateLimit";
import { enforceSeatLimits } from "@/lib/seatLimits";
import { HttpError } from "@/lib/session";
import { appUrl, stripe } from "@/lib/stripe";
import { endOpenCheckouts, isMissing } from "@/lib/subscription";
import { teamEmail } from "@/lib/teamEmail";
import { DELETION_GRACE_DAYS, DELETION_WARN_DAYS } from "@/lib/periods";

/**
 * Deleting your own account closes it straight away and deletes it for good
 * DELETION_GRACE_DAYS later, unless you sign in before then and keep it.
 *
 * While it's closed: you count as signed out everywhere (lib/session.ts), your
 * clients' links stop (they're paused), nothing more is emailed in your
 * business's name, invites are cancelled and the subscription doesn't renew.
 * Staff leave their teams at once (a seat and the team's keys can't wait 30
 * days). Recordings without cloud backup still expire on their usual dates.
 */
export { DELETION_GRACE_DAYS };
/** How far ahead of the deletion the account holder is reminded. */
export const DELETION_WARN_MS = DELETION_WARN_DAYS * 86_400_000;
export const deletionDate = (from = new Date()) => new Date(from.getTime() + DELETION_GRACE_DAYS * 86_400_000);
/** An owner leaving would strand their staff in a workspace nobody pays for. */
export const OWNER_WITH_STAFF = "You own a team with other staff. Remove them in Settings > Team and staff first.";

/** One email per subject a day to the founder, however many runs hit it. */
const once = (key: string) => rateLimit(`alert:${key}`, 1, 86_400).then(() => true, () => false);

/** Workspaces the user alone belongs to (deleted with them) and teams they're staff on. */
export async function workspacesOf(userId: string) {
  const memberships = await db.membership.findMany({
    where: { userId },
    include: { workspace: { include: { _count: { select: { members: true } } } } },
    orderBy: { id: "asc" },
  });
  return {
    own: memberships.filter((m) => m.workspace._count.members === 1).map((m) => m.workspace),
    teams: memberships.filter((m) => m.workspace._count.members > 1).map((m) => m.workspace),
    ownsTeam: memberships.some((m) => m.role === "OWNER" && m.workspace._count.members > 1),
  };
}

type Renewal = { result: "none" | "stopped" | "cancelled" | "ending"; endsAt: Date | null };

/**
 * Stops a closing account's subscription from renewing. A paid-up one stays
 * until its period ends, so keeping the account in time loses nothing; one
 * behind on payment is cancelled now, so its retries stop. Throws if Stripe
 * can't be reached, before anything else has changed.
 */
async function stopRenewal(w: Workspace): Promise<Renewal> {
  if (!process.env.STRIPE_SECRET_KEY || !w.stripeSubscriptionId) return { result: "none", endsAt: null };
  const sub = await stripe().subscriptions.retrieve(w.stripeSubscriptionId).catch((err) => (isMissing(err) ? null : Promise.reject(err)));
  if (!sub || sub.status === "canceled" || sub.status === "incomplete_expired") return { result: "none", endsAt: null };
  if (sub.status !== "active" && sub.status !== "trialing") {
    await stripe().subscriptions.cancel(sub.id);
    return { result: "cancelled", endsAt: null };
  }
  // Already set to end (cancelled in Manage subscription, or a dispute): leave it, and don't turn it back on later.
  if (sub.cancel_at_period_end || sub.cancel_at) return { result: "ending", endsAt: sub.cancel_at ? new Date(sub.cancel_at * 1000) : w.currentPeriodEnd };
  await stripe().subscriptions.update(sub.id, { cancel_at_period_end: true });
  return { result: "stopped", endsAt: w.currentPeriodEnd };
}

/**
 * Turns renewal back on for a subscription we stopped. "ended" when there's
 * nothing left to renew (the period ran out, or it was cancelled for being
 * behind on payment). Stripe's webhook brings the rest of Billing up to date.
 */
async function resumeRenewal(w: Workspace): Promise<"resumed" | "ended"> {
  if (!w.stripeSubscriptionId) return "ended";
  if (!process.env.STRIPE_SECRET_KEY) return "resumed";
  const sub: Stripe.Subscription | null = await stripe().subscriptions.retrieve(w.stripeSubscriptionId).catch((err) => (isMissing(err) ? null : Promise.reject(err)));
  if (!sub || (sub.status !== "active" && sub.status !== "trialing")) return "ended";
  if (sub.cancel_at_period_end) await stripe().subscriptions.update(sub.id, { cancel_at_period_end: false });
  await db.workspace.update({ where: { id: w.id }, data: { cancelsAt: null } });
  return "resumed";
}

/**
 * Closes an account and schedules its deletion (Settings > Account, or
 * support on the account holder's request). Billing is dealt with first: if
 * Stripe can't be reached this throws and nothing changes. Running it again
 * for an account already closed returns its date.
 */
export async function requestAccountDeletion(userId: string, { notify = true } = {}) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, "Account not found");
  if (user.deleteAt) return { deleteAt: user.deleteAt, teamsLeft: [] as string[] };
  const { own, teams, ownsTeam } = await workspacesOf(userId);
  if (ownsTeam) throw new HttpError(409, OWNER_WITH_STAFF);

  const billing = new Map<string, Renewal>();
  const undo = async () => {
    for (const w of own) {
      if (billing.get(w.id)?.result !== "stopped") continue;
      await stripe()
        .subscriptions.update(w.stripeSubscriptionId!, { cancel_at_period_end: false })
        .catch((err) => console.error(JSON.stringify({ level: "error", message: "[account] couldn't turn renewal back on after a failed close", workspace: w.id, error: String(err) })));
    }
  };
  try {
    for (const w of own) {
      billing.set(w.id, await stopRenewal(w));
      await endOpenCheckouts(w);
    }
  } catch (err) {
    await undo();
    throw err;
  }

  const now = new Date();
  const deleteAt = deletionDate(now);
  const ownIds = own.map((w) => w.id);
  let closed: boolean;
  try {
    closed = await db.$transaction(async (tx) => {
      // Claimed, so a double click can't close it twice.
      const res = await tx.user.updateMany({
        where: { id: userId, deleteAt: null },
        data: { deletionRequestedAt: now, deleteAt, deletionWarnedAt: null, activeWorkspaceId: null },
      });
      if (!res.count) return false;
      for (const w of own) {
        const b = billing.get(w.id)!;
        const stopped = b.result === "stopped" || b.result === "cancelled";
        await tx.workspace.update({
          where: { id: w.id },
          data: { deleteAt, ...(stopped ? { renewalStoppedAt: now } : {}), ...(b.result === "stopped" ? { cancelsAt: b.endsAt } : {}) },
        });
      }
      // Their clients' links stop, and so do reminders and new-video emails to them (all check pausedAt).
      await tx.client.updateMany({ where: { workspaceId: { in: ownIds }, removedAt: null, pausedAt: null }, data: { pausedAt: now } });
      // Nobody joins meanwhile: a workspace with staff in it on the deletion date would outlive its owner.
      await tx.invite.updateMany({ where: { workspaceId: { in: ownIds }, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } });
      return true;
    });
  } catch (err) {
    await undo();
    throw err;
  }
  if (!closed) {
    // Another request closed it a moment ago; keep a note of any renewal this one stopped, so keeping it turns that back on.
    for (const w of own) {
      if (billing.get(w.id)?.result === "stopped") {
        await db.workspace.updateMany({ where: { id: w.id, deleteAt: { not: null }, renewalStoppedAt: null }, data: { renewalStoppedAt: now } });
      }
    }
    const current = await db.user.findUnique({ where: { id: userId }, select: { deleteAt: true } });
    return { deleteAt: current?.deleteAt ?? deleteAt, teamsLeft: [] as string[] };
  }

  // Staff leave their teams now: their seat is freed and the managers are asked to reset the keys.
  const teamsLeft: string[] = [];
  const leaver = leaverName(user);
  for (const w of teams) {
    try {
      if (await leaveTeam(userId, w, leaver)) teamsLeft.push(w.name);
    } catch (err) {
      // Finished when the account is deleted (deleteAccount runs the same steps).
      console.error(JSON.stringify({ level: "error", message: "[account] leaving a team on close failed", workspace: w.id, error: String(err) }));
    }
  }

  if (notify) {
    const ws = own[0] ?? null;
    const mail = scheduledEmail({
      deleteAt,
      tz: ws?.timezone,
      workspace: ws ? { name: ws.name, plan: PLANS[ws.plan].name, billing: billing.get(ws.id)! } : null,
      teamsLeft,
    });
    await sendMail({ to: user.email, ...mail }).catch((err) => console.error("[account] closed email", userId, err));
  }
  return { deleteAt, teamsLeft };
}

/**
 * Keeps a closed account (the account holder signed in again, or support on
 * their request). Allowed until the deletion date; the purge only runs after
 * it, so the two can't overlap. Clients the plan covers get their links back.
 */
export async function restoreAccount(userId: string, { notify = true } = {}) {
  const now = new Date();
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, "Account not found");
  if (!user.deleteAt) throw new HttpError(409, "This account isn't closed");
  // Closed or suspended by support (lib/support/admin.ts): only support can change that.
  if (user.closedAt) throw new HttpError(403, `This account was closed by ${BRAND.name} support, so it can't be kept. Contact ${LEGAL.email}.`);
  if (user.suspendedAt) throw new HttpError(403, `This login is suspended, so the account can't be kept right now. Contact ${LEGAL.email}.`);
  const own = await db.workspace.findMany({ where: { deleteAt: { not: null }, members: { some: { userId } } } });
  // Sign-ins from before it was closed stay signed out (closing told them "signed out on every device"); the fresh one
  // keeping it is newer. Never earlier than a "Sign out everywhere" made meanwhile.
  const cutoff =
    user.deletionRequestedAt && (!user.sessionsValidAfter || user.deletionRequestedAt > user.sessionsValidAfter) ? user.deletionRequestedAt : user.sessionsValidAfter;
  const kept = await db.$transaction(async (tx) => {
    const res = await tx.user.updateMany({
      where: { id: userId, deleteAt: { gt: now } },
      data: { deleteAt: null, deletionRequestedAt: null, deletionWarnedAt: null, ...(cutoff ? { sessionsValidAfter: cutoff } : {}) },
    });
    if (!res.count) return false;
    const ids = own.map((w) => w.id);
    await tx.workspace.updateMany({ where: { id: { in: ids } }, data: { deleteAt: null, renewalStoppedAt: null } });
    // Uploads refused while it was closed (lib/retention.ts abortStaleUploads) get a new week to finish.
    await tx.video.updateMany({ where: { workspaceId: { in: ids }, status: "RECORDING" }, data: { updatedAt: now } });
    return true;
  });
  if (!kept) throw new HttpError(410, "This account has reached its deletion date, so it can't be kept");

  let planEnded = false;
  for (const w of own) {
    if (w.renewalStoppedAt) {
      const renewal = await resumeRenewal(w).catch(async (err) => {
        console.error(JSON.stringify({ level: "error", message: "[account] couldn't turn renewal back on", workspace: w.id, error: String(err) }));
        await alertFounder(`Renewal not turned back on for ${w.name}`, [
          `${user.email} kept their account, but their subscription (${w.stripeSubscriptionId}) couldn't be set to renew again: ${String((err as Error)?.message ?? err)}.`,
          "Turn renewal back on in the Stripe Dashboard, or ask them to renew in Settings > Billing > Manage subscription.",
        ]);
        return "resumed" as const;
      });
      if (renewal === "ended") planEnded = true;
    }
    // Recalculated from the plan: clients it covers can open their links again.
    await enforceSeatLimits(w.id).catch((err) => console.error("[account] seat check after keeping", w.id, err));
    // Cloud backup that ended while it was closed: the recordings' 30 days start now, and the owner is told the date.
    await startBackupEndedClock(w.id).catch((err) => console.error("[account] backup clock after keeping", w.id, err));
  }
  if (notify) {
    const mail = keptEmail({ workspace: own[0]?.name ?? null, planEnded });
    await sendMail({ to: user.email, ...mail }).catch((err) => console.error("[account] kept email", userId, err));
  }
  return { planEnded };
}

/** Refused while legal hold is on (lib/support/admin.ts setLegalHold). */
export const LEGAL_HOLD_DELETE = "This account belongs to a workspace on legal hold, so it can't be deleted until the hold is lifted.";
/**
 * Nothing of a workspace on legal hold is deleted, so neither is an account on it, nor one that rows of it point at
 * (staff who have since left: deleting the login would take its invites, staff notices and recordings with it).
 */
const heldWs = { workspace: { legalHoldAt: { not: null } } } as const;
const notHeld = {
  memberships: { none: heldWs },
  invitesSent: { none: heldWs },
  noticesSent: { none: heldWs },
  noticesReceived: { none: heldWs },
  teamNotifications: { none: heldWs },
  videos: { none: heldWs },
} as const;
export const onLegalHold = async (userId: string) => (await db.user.count({ where: { id: userId, NOT: notHeld } })) > 0;

/**
 * Deletes an account for good now, without waiting for its date (support, on
 * a verified request from the account holder). Refuses an owner with staff.
 */
export async function purgeAccountNow(userId: string, { notify = true } = {}) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, "Account not found");
  const { own, ownsTeam } = await workspacesOf(userId);
  if (ownsTeam) throw new HttpError(409, OWNER_WITH_STAFF);
  if (await onLegalHold(userId)) throw new HttpError(409, LEGAL_HOLD_DELETE);
  const mail = deletedEmail(user.email, own[0]?.name ?? null, { closed: !!user.closedAt, blocked: await isEmailBlocked(user.email) });
  const deleted = await deleteAccount(userId);
  if (deleted && notify) await sendMail({ to: user.email, ...mail }).catch((err) => console.error("[account] deleted email", userId, err));
  return deleted;
}

/**
 * Deletes accounts whose date has come (both cron jobs, within a time
 * budget). One that fails is retried on the next run; the founder hears
 * about one more than 3 days overdue.
 */
export async function purgeScheduledAccounts(now = new Date(), budgetMs = 40_000) {
  const deadline = Date.now() + budgetMs;
  // Accounts on a workspace under legal hold wait until it's lifted (lib/support/admin.ts).
  const due = await db.user.findMany({ where: { deleteAt: { lte: now }, ...notHeld }, select: { id: true, email: true, deleteAt: true, closedAt: true }, orderBy: { deleteAt: "asc" }, take: 50 });
  let purged = 0;
  for (const u of due) {
    if (Date.now() > deadline) break;
    try {
      // Read again: kept at the last moment, or deleted by another run.
      const user = await db.user.findUnique({ where: { id: u.id }, select: { deleteAt: true } });
      if (!user?.deleteAt || user.deleteAt > now || (await onLegalHold(u.id))) continue;
      const { own, ownsTeam } = await workspacesOf(u.id);
      if (ownsTeam) {
        // Shouldn't happen (invites were cancelled): deleting the owner would leave their staff a workspace nobody runs.
        if (await once(`account-purge-team:${u.id}`)) {
          await alertFounder("A closed account owns a team", [`${u.email} (${u.id}) closed their account, but their workspace now has other staff, so it wasn't deleted.`, "Decide what to do in the support console."]);
        }
        continue;
      }
      const mail = deletedEmail(u.email, own[0]?.name ?? null, { closed: !!u.closedAt, blocked: await isEmailBlocked(u.email) });
      if (!(await deleteAccount(u.id))) continue;
      purged++;
      await sendMail({ to: u.email, ...mail }).catch((err) => console.error("[account] deleted email", u.id, err));
    } catch (err) {
      console.error(JSON.stringify({ level: "error", message: "[account-purge] failed; retried next run", user: u.id, error: String(err) }));
      if (now.getTime() - u.deleteAt!.getTime() > DELETION_WARN_MS && (await once(`account-purge:${u.id}`))) {
        await alertFounder(`Account deletion overdue for ${u.email}`, [
          `${u.email} (${u.id}) was due to be deleted on ${u.deleteAt!.toISOString()}, but it keeps failing: ${String((err as Error)?.message ?? err)}.`,
          "It's retried every few minutes. Check the logs, and Stripe if the error is from billing.",
        ]);
      }
    }
  }
  return purged;
}

/** Emails each closed account about 3 days before it's deleted. A failed send is retried on the next run. */
export async function warnScheduledDeletions(now = new Date()) {
  const due = await db.user.findMany({
    // Not for an account support closed or suspended: it can't be kept by signing in (lib/support/admin.ts).
    where: { deleteAt: { gt: now, lte: new Date(now.getTime() + DELETION_WARN_MS) }, deletionWarnedAt: null, closedAt: null, suspendedAt: null },
    select: { id: true },
    take: 200,
  });
  let sent = 0;
  for (const { id } of due) {
    // Claim with a stamp of our own so a concurrent run can't send it too.
    const stamp = new Date(now.getTime() + Math.floor(Math.random() * 1000));
    const claim = await db.user.updateMany({ where: { id, deletionWarnedAt: null, deleteAt: { gt: now } }, data: { deletionWarnedAt: stamp } });
    if (!claim.count) continue;
    const user = await db.user.findUnique({ where: { id }, include: { memberships: { include: { workspace: true }, orderBy: { id: "asc" } } } });
    if (!user?.deleteAt) continue;
    const ws = user.memberships.find((m) => m.workspace.deleteAt)?.workspace ?? null;
    try {
      await sendMail({ to: user.email, ...reminderEmail({ deleteAt: user.deleteAt, tz: ws?.timezone, workspace: ws?.name ?? null }) });
      sent++;
    } catch (err) {
      await db.user.updateMany({ where: { id, deletionWarnedAt: stamp }, data: { deletionWarnedAt: null } });
      console.error("[account] deletion reminder failed", id, err);
    }
  }
  return sent;
}

// ---- Emails: plain SureFrame emails about the account itself, not branded as the business ----

const KEEP_LINK = () => appUrl("/account/restore");
const notYou = `Didn't ask for this? Sign in, keep your account and contact ${LEGAL.email}.`;
const list = (names: string[]) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

function scheduledEmail(o: { deleteAt: Date; tz?: string | null; workspace: { name: string; plan: string; billing: Renewal } | null; teamsLeft: string[] }) {
  const dates = zoned(o.tz);
  const when = dates.longDay(o.deleteAt);
  const w = o.workspace;
  const lines: { text: string }[] = [{ text: "You're signed out on every device." }];
  if (w) {
    lines.push({ text: `Your clients can't open their links, and they aren't sent reminders or new-video emails from ${w.name}.` });
    const b = w.billing;
    const ends = b.endsAt ? dates.longDay(b.endsAt) : null;
    if (b.result === "stopped") {
      lines.push({
        text:
          b.endsAt && b.endsAt < o.deleteAt
            ? `Your ${w.plan} plan won't renew, so it ends on ${ends}. Keep your account before then and it renews as normal; after that you'd need to subscribe again.`
            : `Your ${w.plan} plan won't renew. Keep your account and it renews as normal.`,
      });
    } else if (b.result === "cancelled") {
      lines.push({ text: "Your subscription had a payment outstanding, so it's cancelled now. If you keep your account, you'd need to subscribe again." });
    } else if (b.result === "ending") {
      lines.push({ text: `Your ${w.plan} plan was already set to end${ends ? ` on ${ends}` : ""}, and it won't renew.` });
    }
    lines.push({ text: "Recordings without cloud backup still expire on their usual dates in the meantime, and reminders due while your account is closed aren't sent." });
  }
  if (o.teamsLeft.length) {
    lines.push({ text: `You've left ${list(o.teamsLeft)}. Keeping your account won't put you back on ${o.teamsLeft.length === 1 ? "that team" : "those teams"}; ask them for a new invite.` });
  }
  return teamEmail({
    business: BRAND.name,
    subject: `Your ${BRAND.name} account will be deleted on ${when}`,
    lead:
      `You closed your ${BRAND.name} account. It will be deleted for good on ${when}` +
      (w ? `, with ${w.name} and its recordings, clients, to-dos and notes. ` : ". ") +
      "Sign in before then to keep your account with everything as it was.",
    lines,
    button: { label: "Keep my account", link: KEEP_LINK() },
    footer: notYou,
  });
}

function reminderEmail(o: { deleteAt: Date; tz?: string | null; workspace: string | null }) {
  const dates = zoned(o.tz);
  return teamEmail({
    business: BRAND.name,
    subject: `Your ${BRAND.name} account will be deleted on ${dates.longDay(o.deleteAt)}`,
    lead:
      `Your ${BRAND.name} account is closed and will be deleted for good on ${dates.longDay(o.deleteAt)}` +
      (o.workspace ? `, with ${o.workspace} and its recordings, clients, to-dos and notes.` : ".") +
      " After that it can't be brought back.",
    lines: [{ text: "To keep it, sign in before then and choose Keep my account." }],
    button: { label: "Keep my account", link: KEEP_LINK() },
    footer: notYou,
  });
}

function keptEmail(o: { workspace: string | null; planEnded: boolean }) {
  const lines: { text: string }[] = [];
  if (o.workspace) lines.push({ text: "Clients your plan covers can open their links again." });
  if (o.planEnded) lines.push({ text: "Your subscription ended while your account was closed. Choose a plan in Settings > Billing to subscribe again." });
  return teamEmail({
    business: BRAND.name,
    subject: `Your ${BRAND.name} account is open again`,
    lead: `Your ${BRAND.name} account is open again and won't be deleted.`,
    lines,
    button: { label: `Open ${BRAND.name}`, link: appUrl("/library") },
    footer: `Didn't do this? Contact ${LEGAL.email} straight away.`,
  });
}

export function deletedEmail(email: string, workspace: string | null, o: { closed?: boolean; blocked?: boolean } = {}) {
  return teamEmail({
    business: BRAND.name,
    subject: `Your ${BRAND.name} account has been deleted`,
    lead: `Your ${BRAND.name} account for ${email} has been deleted` + (workspace ? `, with ${workspace} and its recordings, clients, to-dos and notes.` : "."),
    lines: [{ text: "A few records are kept after deletion where the law requires, such as billing records held by our payment provider. Our Privacy Policy explains what's kept." }],
    button: { label: `Visit ${BRAND.name}`, link: appUrl("/") },
    // Closed by support (lib/support/admin.ts): no "welcome back", and a blocked address can't sign up again.
    footer: o.blocked
      ? `This email address can't be used with ${BRAND.name} again.`
      : o.closed
        ? undefined
        : "You're welcome back any time. Signing up with the same email starts a new, empty account.",
  });
}
