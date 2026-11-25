import { db } from "@/lib/db";
import { appUrl } from "@/lib/stripe";
import { sendMail } from "@/lib/mail";
import { notify } from "@/lib/notifications";
import { brandOf } from "@/lib/branding";
import { teamEmail } from "@/lib/teamEmail";
import { BRAND } from "@/lib/brand";
import { zoned } from "@/lib/dates";
import { teamPath } from "@/lib/teamLink";
import { activeMember } from "@/lib/team";
import { isDefaultTitle } from "@/lib/videoTitle";

/** How far ahead of the scheduled deletion the recorder is emailed. */
export const WARN_BEFORE_MS = 24 * 3_600_000;


/**
 * Email each recorder once, about 24 hours before our encrypted copy of their
 * recording is deleted (no cloud backup). Runs from both cron jobs: the
 * reminders job (every 5 minutes) sends it close to 24 hours ahead, and the
 * daily job catches any it missed. The purge that deletes the file runs from
 * both jobs too, soon after purgeAt, and doesn't check that a warning went
 * (lib/retention.ts): one sent late says how long is really left.
 *
 * Emails never include encrypted content (messages, replies, notes); they list
 * each recording's title once it has been given one (titles aren't encrypted),
 * the recorded date, who it was sent to and a link. Best effort: a failed send
 * is retried on the next run.
 */
export async function warnExpiring(now = new Date()) {
  const due = await db.video.findMany({
    where: {
      purgeAt: { gt: now, lte: new Date(now.getTime() + WARN_BEFORE_MS) },
      expiryWarnedAt: null,
      replyToId: null,
      status: { notIn: ["EXPIRED", "RECORDING"] },
      // Nothing is emailed while the owner's account is closed (lib/accountDeletion.ts) or support has the workspace
      // suspended (lib/support/admin.ts); the recordings still expire. Under legal hold they don't, so no warning.
      workspace: { cloudBackup: false, deleteAt: null, suspendedAt: null, closedAt: null, legalHoldAt: null },
      // Not a deleted client's conversation, while that deletion finishes (lib/clientRemoval.ts).
      NOT: { client: { removedAt: { not: null } } },
    },
    select: { id: true, ownerId: true, workspaceId: true, sourceId: true, createdAt: true, purgeAt: true, title: true, source: { select: { title: true } }, client: { select: { name: true } } },
    orderBy: { purgeAt: "asc" },
    take: 500,
  });
  const groups = new Map<string, typeof due>();
  for (const v of due) {
    const key = `${v.ownerId}:${v.workspaceId}`;
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }

  let sent = 0;
  /** One recorder's warning. `claim` says which stamp marks its recordings as warned, and whether the email went. */
  const warnGroup = async (videos: typeof due, claim: { stamp: Date; mailed: boolean }) => {
    const { ownerId, workspaceId } = videos[0];
    // Claim with a stamp of our own so a concurrent run can't send the same ones.
    const { stamp } = claim;
    await db.video.updateMany({ where: { id: { in: videos.map((v) => v.id) }, expiryWarnedAt: null }, data: { expiryWarnedAt: stamp } });
    const claimed = new Set((await db.video.findMany({ where: { id: { in: videos.map((v) => v.id) }, expiryWarnedAt: stamp }, select: { id: true } })).map((v) => v.id));
    const mine = videos.filter((v) => claimed.has(v.id));
    if (!mine.length) return;

    const [ws, user, recorderMembership] = await Promise.all([
      db.workspace.findUnique({ where: { id: workspaceId } }),
      db.user.findUnique({ where: { id: ownerId }, select: { email: true, suspendedAt: true } }),
      db.membership.findFirst({ where: { userId: ownerId, workspaceId } }),
    ]);
    if (!ws) return;
    // Someone who has left the team (or is paused or suspended) isn't told; the owner is, since the recordings are the business's.
    const left = !user || !recorderMembership || !!recorderMembership.pausedAt || !!user.suspendedAt;
    const owner = left ? await db.membership.findFirst({ where: { workspaceId, role: "OWNER", ...activeMember }, include: { user: { select: { email: true } } } }) : null;
    const to = left ? owner?.user.email : user!.email;
    const membership = left ? owner : recorderMembership;
    if (!to || !membership) {
      await db.video.updateMany({ where: { id: { in: mine.map((v) => v.id) }, expiryWarnedAt: stamp }, data: { expiryWarnedAt: null } });
      return;
    }
    const dates = zoned(ws.timezone);

    // A recording sent to several clients is one recording: list it once.
    const recordings = new Map<string, { link: string; title: string; recorded: Date; purgeAt: Date; clients: string[] }>();
    for (const v of mine) {
      const rootId = v.sourceId ?? v.id;
      const r = recordings.get(rootId) ?? { link: appUrl(`/v/${rootId}?team=1`), title: v.source?.title ?? v.title, recorded: v.createdAt, purgeAt: v.purgeAt!, clients: [] };
      if (v.client?.name && !r.clients.includes(v.client.name)) r.clients.push(v.client.name);
      if (v.purgeAt! < r.purgeAt) r.purgeAt = v.purgeAt!;
      if (v.createdAt < r.recorded) r.recorded = v.createdAt;
      recordings.set(rootId, r);
    }
    for (const r of recordings.values()) r.clients.sort((a, b) => a.localeCompare(b));
    const list = [...recordings.values()].sort((a, b) => a.purgeAt.getTime() - b.purgeAt.getTime());
    const n = list.length;
    const brand = brandOf(ws, appUrl(""));
    const backup =
      ws.plan === "FREE"
        ? ""
        : membership.role === "OWNER"
          ? `\n\nTo keep recordings on our servers from now on, turn on cloud backup in Settings > Billing: ${appUrl("/settings/billing")}`
          : `\n\nThe team owner can turn on cloud backup (Settings > Billing) to keep recordings on our servers.`;
    // Normally sent a day ahead. A late one (the jobs were paused, or earlier sends failed) says how long is really left
    // for the soonest, rather than "24 hours".
    const hoursLeft = Math.round((list[0].purgeAt.getTime() - now.getTime()) / 3_600_000);
    const onTime = hoursLeft >= 23;
    const inHours = onTime ? "24 hours" : hoursLeft >= 2 ? `${hoursLeft} hours` : hoursLeft === 1 ? "an hour" : "less than an hour";
    const about = hoursLeft >= 1 ? `in about ${inHours}` : `in ${inHours}`;
    const mail = teamEmail({
      business: ws.name,
      subject:
        n === 1
          ? `A recording is deleted from ${BRAND.name} in ${inHours}`
          : onTime
            ? `${n} recordings are deleted from ${BRAND.name} in 24 hours`
            : `${n} recordings are deleted from ${BRAND.name}, the first in ${inHours}`,
      lead:
        n === 1
          ? `Our encrypted copy of a recording ${left ? "made by someone no longer on your team" : "you made"} is scheduled to be deleted from our servers ${about}.`
          : `Our encrypted copies of ${n} recordings ${left ? "made by someone no longer on your team" : "you made"} are scheduled to be deleted from our servers ${onTime ? "in about 24 hours" : `within 24 hours, the first ${about}`}.`,
      lines: list.map((r) => ({
        // Named by its title once it has one (O72's ask, for this email too); the date says which while it doesn't.
        text: `${isDefaultTitle(r.title) ? "Recorded" : `\u201c${r.title.trim()}\u201d, recorded`} ${dates.day(r.recorded)}${r.clients.length ? `, sent to ${r.clients.join(", ")}` : ""}. Deleted after ${dates.dayTime(r.purgeAt)} ${dates.zoneName(r.purgeAt)}`,
        link: r.link,
      })),
      note:
        `If you or your clients still need ${n === 1 ? "it" : "them"}, open ${n === 1 ? "the recording" : "each recording"} and choose Save to device before then. ` +
        `After that, ${n === 1 ? "it" : "they"} can no longer be watched from the link.` +
        backup,
      button: n === 1 ? { label: "Open the recording", link: list[0].link } : { label: "See recordings deleting soon", link: appUrl(teamPath("/library?filter=soon", ws.id)) },
      footer: ws.timezone ? `Times are in your business's time zone (${dates.zone}).` : `Times are in UTC. Set your business's time zone in Settings > Account.`,
      logoUrl: brand.logoUrl,
      color: brand.color,
    });
    try {
      await sendMail({ to, ...mail });
      claim.mailed = true;
      sent++;
      // In their bell too (lib/notifications.ts): the recording, or the Library's "Deleting soon" for several. The bell
      // is read days later, so it gives the time where the email's subject says "in 24 hours".
      const after = `${dates.shortDayTime(list[0].purgeAt)} ${dates.zoneName(list[0].purgeAt)}`;
      const bell = n === 1 ? `A recording is deleted from ${BRAND.name} after ${after}` : `${n} recordings are deleted from ${BRAND.name}, the first after ${after}`;
      await notify([{ userId: membership.userId, workspaceId, kind: "EXPIRING", text: bell, href: n === 1 ? new URL(list[0].link).pathname : "/library?filter=soon" }]);
    } catch (err) {
      // Release them so the next run tries again.
      if (!claim.mailed) await db.video.updateMany({ where: { id: { in: mine.map((v) => v.id) }, expiryWarnedAt: stamp }, data: { expiryWarnedAt: null } });
      console.error("expiry warning failed", err);
    }
  };
  for (const videos of groups.values()) {
    const claim = { stamp: new Date(now.getTime() + Math.floor(Math.random() * 1000)), mailed: false };
    try {
      await warnGroup(videos, claim);
    } catch (err) {
      // Something failed between marking these as warned and sending (a database error, say). Without this the mark
      // would stay and the warning would never go: clear it so the next run tries again, and carry on with the rest.
      if (!claim.mailed) await db.video.updateMany({ where: { id: { in: videos.map((v) => v.id) }, expiryWarnedAt: claim.stamp }, data: { expiryWarnedAt: null } }).catch(() => {});
      console.error("expiry warning failed", err);
    }
  }
  return sent;
}
