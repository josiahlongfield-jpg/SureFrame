import { brandOf } from "@/lib/branding";
import { zoned } from "@/lib/dates";
import { db } from "@/lib/db";
import { RECEIPTS_NOTE } from "@/lib/plans";
import { sendMail } from "@/lib/mail";
import { applyBackupSetting, purgeDate } from "@/lib/retention";
import { appUrl } from "@/lib/stripe";
import { teamEmail } from "@/lib/teamEmail";
import { teamPath } from "@/lib/teamLink";
import { activeMember } from "@/lib/team";

/**
 * Cloud backup ended without the owner switching it off (the plan was
 * cancelled, lapsed, or Stripe no longer has it), so every recording's server
 * copy is now due for deletion. The owner hears straight away, with the date.
 */
export async function tellOwnerBackupEnded(workspaceId: string) {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  const owner = await db.membership.findFirst({ where: { workspaceId, role: "OWNER", ...activeMember }, include: { user: { select: { email: true } } } });
  // Not while nobody can get in (the account closed, or suspended by support): the 30 days wait until they can
  // (backupEnded, startBackupEndedClock). Not on legal hold either (nothing is deleted then).
  if (!workspace || !owner || workspace.deleteAt || workspace.suspendedAt || workspace.closedAt || workspace.legalHoldAt) return;
  const left = await db.video.count({ where: { workspaceId, status: { not: "EXPIRED" }, replyToId: null, sourceId: null } });
  if (!left) return;
  const when = zoned(workspace.timezone).longDay(purgeDate(false)!);
  const brand = brandOf(workspace, appUrl(""));
  const mail = teamEmail({
    business: workspace.name,
    subject: "Cloud backup has ended for your recordings",
    lead: `Your SureFrame plan no longer includes cloud backup, so our copies of your ${left === 1 ? "recording" : `${left} recordings`} will be deleted on ${when}.`,
    lines: [
      { text: "To keep them, subscribe again with cloud backup before then, or open each video and choose Save to device." },
      { text: "Clients can't watch a recording once our copy is deleted." },
      { text: RECEIPTS_NOTE },
    ],
    button: { label: "Open Billing", link: appUrl(teamPath("/settings/billing", workspaceId)) },
    logoUrl: brand.logoUrl,
    color: brand.color,
  });
  await sendMail({ to: owner.user.email, ...mail }).catch((err) => console.error("[billing] backup-ended email", workspaceId, err));
}

/** Support has the workspace suspended or closed, or its owner closed their account: nobody can save their recordings. */
const lockedOut = (w: { suspendedAt: Date | null; closedAt: Date | null; deleteAt: Date | null }) => !!(w.suspendedAt || w.closedAt || w.deleteAt);

/**
 * Cloud backup ended (the plan was cancelled or lapsed). Recordings' 30 days
 * start now, with the owner told, unless nobody can get in to save them: then
 * they wait until the workspace is unsuspended, reopened or kept
 * (startBackupEndedClock).
 */
export async function backupEnded(workspaceId: string, { notify = true } = {}) {
  const w = await db.workspace.findUnique({ where: { id: workspaceId }, select: { suspendedAt: true, closedAt: true, deleteAt: true } });
  if (!w || lockedOut(w)) return;
  await applyBackupSetting(workspaceId, false);
  if (notify) await tellOwnerBackupEnded(workspaceId);
}

/**
 * Starts the 30 days for recordings whose backup ended while nobody could get
 * in (backupEnded), once they can again, and tells the owner the date.
 */
export async function startBackupEndedClock(workspaceId: string) {
  const w = await db.workspace.findUnique({ where: { id: workspaceId }, select: { cloudBackup: true, suspendedAt: true, closedAt: true, deleteAt: true } });
  if (!w || w.cloudBackup || lockedOut(w)) return 0;
  const { count } = await db.video.updateMany({ where: { workspaceId, status: { not: "EXPIRED" }, purgeAt: null }, data: { purgeAt: purgeDate(false), expiryWarnedAt: null } });
  if (count) await tellOwnerBackupEnded(workspaceId);
  return count;
}
