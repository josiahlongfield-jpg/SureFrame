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
import { HELD_FOR_WARNING, warnable } from "@/lib/retention";
import { lookingAfter } from "@/lib/teamNotify";

/** How far ahead of the scheduled deletion the recorder is emailed. */
export const WARN_BEFORE_MS = 24 * 3_600_000;

/** Gives back a claim that didn't end in an email, so the next run tries again. One the purge held back a day stays marked as held. */
async function release(videos: { id: string; expiryWarnedAt: Date | null }[], stamp: Date) {
  const held = new Set(videos.filter((v) => v.expiryWarnedAt?.getTime() === HELD_FOR_WARNING.getTime()).map((v) => v.id));
  const ids = videos.map((v) => v.id);
  await Promise.all([
    db.video.updateMany({ where: { id: { in: ids.filter((id) => !held.has(id)) }, expiryWarnedAt: stamp }, data: { expiryWarnedAt: null } }),
    db.video.updateMany({ where: { id: { in: [...held] }, expiryWarnedAt: stamp }, data: { expiryWarnedAt: HELD_FOR_WARNING } }),
  ]);
}

/**
 * Email once, about 24 hours before our encrypted copy of a recording is
 * deleted (no cloud backup), with the clients' video and voice replies in those
 * conversations listed in it (MAIL-8: never an email of replies alone). It goes
 * to whoever recorded it while they're on the team and can still open it; once
 * they can't (its client was given to someone else, SEC-7), to whoever looks
 * after that client now (lib/teamNotify.ts lookingAfter, the owner when nobody
 * does). A client's reply goes by the conversation's recorder the same way. Runs from both cron jobs: the
 * reminders job (every 5 minutes) sends it close to 24 hours ahead, and the
 * daily job catches any it missed. The purge that deletes the file runs from
 * both jobs too, soon after purgeAt. One due with no warning sent is held back a
 * day by the purge, once (lib/retention.ts), so this sends it first; one sent
 * late anyway says how long is really left.
 *
 * Emails never include encrypted content (messages, replies, notes); they list
 * each recording's title once it has been given one (titles aren't encrypted),
 * the recorded date, who it was sent to and a link. A client's replies are listed
 * by the client's name and the date of the video they answer, never their content.
 * Best effort: a failed send is retried on the next run.
 */
export async function warnExpiring(now = new Date()) {
  const due = await db.video.findMany({
    where: {
      AND: [
        // Nothing is emailed while the owner's account is closed (lib/accountDeletion.ts) or support has the workspace
        // suspended (lib/support/admin.ts); the recordings still expire. Under legal hold they don't, so no warning.
        warnable,
        { purgeAt: { gt: now, lte: new Date(now.getTime() + WARN_BEFORE_MS) }, OR: [{ expiryWarnedAt: null }, { expiryWarnedAt: HELD_FOR_WARNING }] },
      ],
    },
    select: {
      id: true, ownerId: true, workspaceId: true, sourceId: true, replyToId: true, createdAt: true, purgeAt: true, expiryWarnedAt: true, title: true, formerStaffAt: true,
      source: { select: { title: true } }, client: { select: { name: true, assignedToId: true } },
      // A client's reply: the conversation it's in, named by the client and when its video was recorded.
      asReply: { select: { video: { select: { id: true, createdAt: true, source: { select: { createdAt: true } }, client: { select: { name: true, assignedToId: true } } } } } },
    },
    orderBy: { purgeAt: "asc" },
    take: 500,
  });
  // Who each one goes to (see above). Paused or suspended people, and people who have left, aren't told: the owner is.
  // A reply media's ownerId is its conversation's recorder (api/videos/[id]/replies).
  const workspaceIds = [...new Set(due.map((v) => v.workspaceId))];
  const active = await db.membership.findMany({ where: { workspaceId: { in: workspaceIds }, ...activeMember }, select: { userId: true, workspaceId: true, role: true, seeAllClients: true } });
  const membersOf = (workspaceId: string) => active.filter((m) => m.workspaceId === workspaceId);
  const recipientOf = (v: (typeof due)[number]) => {
    const members = membersOf(v.workspaceId);
    const client = v.replyToId ? v.asReply?.video.client : v.client;
    const recorder = members.find((m) => m.userId === v.ownerId);
    // The recorder while they can still open it (lib/permissions.ts canSeeVideo), as before SEC-7.
    if (recorder && (!client || recorder.role !== "MEMBER" || recorder.seeAllClients || client.assignedToId === recorder.userId)) return recorder.userId;
    if (client) return lookingAfter(members, { assignedToId: client.assignedToId, recorderId: v.ownerId }).primary?.userId ?? null;
    return members.find((m) => m.role === "OWNER")?.userId ?? null;
  };
  const groups = new Map<string, { to: string | null; videos: typeof due }>();
  for (const v of due) {
    const to = recipientOf(v);
    const key = `${to}:${v.workspaceId}`;
    groups.set(key, { to, videos: [...(groups.get(key)?.videos ?? []), v] });
  }

  let sent = 0;
  /** One person's warning. `claim` says which stamp marks its recordings as warned, and whether the email went. */
  const warnGroup = async (recipient: string | null, videos: typeof due, claim: { stamp: Date; mailed: boolean }) => {
    const { workspaceId } = videos[0];
    // Client replies only ride along with a recording this person is being warned about (MAIL-8): never on their own.
    if (!videos.some((v) => !v.replyToId)) return;
    // Claim with a stamp of our own so a concurrent run can't send the same ones.
    const { stamp } = claim;
    await db.video.updateMany({ where: { id: { in: videos.map((v) => v.id) }, OR: [{ expiryWarnedAt: null }, { expiryWarnedAt: HELD_FOR_WARNING }] }, data: { expiryWarnedAt: stamp } });
    const claimed = new Set((await db.video.findMany({ where: { id: { in: videos.map((v) => v.id) }, expiryWarnedAt: stamp }, select: { id: true } })).map((v) => v.id));
    const mine = videos.filter((v) => claimed.has(v.id));
    if (!mine.length) return;
    // A concurrent run took the recordings: the replies go back for an email that has one.
    if (!mine.some((v) => !v.replyToId)) {
      await release(mine, stamp);
      return;
    }

    const [ws, membership] = await Promise.all([
      db.workspace.findUnique({ where: { id: workspaceId } }),
      recipient ? db.membership.findFirst({ where: { userId: recipient, workspaceId, ...activeMember }, include: { user: { select: { email: true } } } }) : null,
    ]);
    if (!ws) return;
    const to = membership?.user.email;
    if (!to || !membership) {
      await release(mine, stamp);
      return;
    }
    // Whose recordings these are, as the email says: theirs, someone's no longer on the team (or paused), or the team's.
    const activeIds = new Set(membersOf(workspaceId).map((m) => m.userId));
    const recorders = new Set(mine.filter((v) => !v.replyToId).map((v) => (v.formerStaffAt ? null : v.ownerId)));
    const others = [...recorders].filter((id) => id !== membership.userId);
    const made = !others.length
      ? "you made"
      : !recorders.has(membership.userId) && others.every((id) => !id || !activeIds.has(id))
        ? "made by someone no longer on your team"
        : "made by your team";
    const dates = zoned(ws.timezone);

    // A recording sent to several clients is one recording: list it once. A client's replies are listed per
    // conversation, after the recordings (MAIL-8).
    const recordings = new Map<string, { link: string; title: string; recorded: Date; purgeAt: Date; clients: string[] }>();
    const replies = new Map<string, { link: string; client: string; recorded: Date; purgeAt: Date; count: number }>();
    for (const v of mine) {
      const conv = v.replyToId ? v.asReply?.video : null;
      if (v.replyToId) {
        if (!conv) continue;
        const r = replies.get(conv.id) ?? { link: appUrl(`/v/${conv.id}?team=1`), client: conv.client?.name ?? "your client", recorded: conv.source?.createdAt ?? conv.createdAt, purgeAt: v.purgeAt!, count: 0 };
        r.count++;
        if (v.purgeAt! < r.purgeAt) r.purgeAt = v.purgeAt!;
        replies.set(conv.id, r);
        continue;
      }
      const rootId = v.sourceId ?? v.id;
      // Opens on the original when it's theirs to open (it's in this email), else on their client's own copy.
      const r = recordings.get(rootId) ?? { link: appUrl(`/v/${v.id}?team=1`), title: v.source?.title ?? v.title, recorded: v.createdAt, purgeAt: v.purgeAt!, clients: [] };
      if (!v.sourceId) r.link = appUrl(`/v/${rootId}?team=1`);
      if (v.client?.name && !r.clients.includes(v.client.name)) r.clients.push(v.client.name);
      if (v.purgeAt! < r.purgeAt) r.purgeAt = v.purgeAt!;
      if (v.createdAt < r.recorded) r.recorded = v.createdAt;
      recordings.set(rootId, r);
    }
    for (const r of recordings.values()) r.clients.sort((a, b) => a.localeCompare(b));
    const list = [...recordings.values()].sort((a, b) => a.purgeAt.getTime() - b.purgeAt.getTime());
    const replyList = [...replies.values()].sort((a, b) => a.purgeAt.getTime() - b.purgeAt.getTime());
    const n = list.length;
    /** How many client replies are listed, and the soonest recording, which the subject is about. */
    const k = replyList.reduce((sum, r) => sum + r.count, 0);
    const first = list[0];
    const brand = brandOf(ws, appUrl(""));
    const backup =
      ws.plan === "FREE"
        ? ""
        : membership.role === "OWNER"
          ? `\n\nTo keep recordings on our servers from now on, turn on cloud backup in Settings > Billing: ${appUrl("/settings/billing")}`
          : `\n\nThe team owner can turn on cloud backup (Settings > Billing) to keep recordings on our servers.`;
    // Normally sent a day ahead. A late one (the jobs were paused, or earlier sends failed) says how long is really left
    // for the soonest, rather than "24 hours".
    const hoursLeft = Math.round((first.purgeAt.getTime() - now.getTime()) / 3_600_000);
    const onTime = hoursLeft >= 23;
    const inHours = onTime ? "24 hours" : hoursLeft >= 2 ? `${hoursLeft} hours` : hoursLeft === 1 ? "an hour" : "less than an hour";
    const about = hoursLeft >= 1 ? `in about ${inHours}` : `in ${inHours}`;
    const theReplies = k === 1 ? "the reply" : "the replies";
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
          ? `Our encrypted copy of a recording ${made} is scheduled to be deleted from our servers ${about}.${k ? ` So ${k === 1 ? "is a video or voice reply" : `are ${k} video or voice replies`} from your clients.` : ""}`
          : `Our encrypted copies of ${n} recordings ${made} are scheduled to be deleted from our servers ${onTime ? "in about 24 hours" : `within 24 hours, the first ${about}`}.${k ? ` So ${k === 1 ? "is a video or voice reply" : `are ${k} video or voice replies`} from your clients.` : ""}`,
      lines: [
        ...list.map((r) => ({
          // Named by its title once it has one (O72's ask, for this email too); the date says which while it doesn't.
          text: `${isDefaultTitle(r.title) ? "Recorded" : `\u201c${r.title.trim()}\u201d, recorded`} ${dates.day(r.recorded)}${r.clients.length ? `, sent to ${r.clients.join(", ")}` : ""}. Deleted after ${dates.dayTime(r.purgeAt)} ${dates.zoneName(r.purgeAt)}`,
          link: r.link,
        })),
        // "2 replies from Client A, on the video recorded 3 Nov 2026": the client's name and the date only.
        ...replyList.map((r) => ({
          text: `${r.count === 1 ? "A reply" : `${r.count} replies`} from ${r.client}, on the video recorded ${dates.day(r.recorded)}. Deleted after ${dates.dayTime(r.purgeAt)} ${dates.zoneName(r.purgeAt)}`,
          link: r.link,
        })),
      ],
      note:
        `If you or your clients still need ${n === 1 ? "it" : "them"}, open ${n === 1 ? "the recording" : "each recording"} and choose Save to device before then. ` +
        `After that, ${n === 1 ? "it" : "they"} can no longer be watched from the link.${k ? ` Watch or listen to ${theReplies} before then too.` : ""}` +
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
      const after = `${dates.shortDayTime(first.purgeAt)} ${dates.zoneName(first.purgeAt)}`;
      const bell = n === 1 ? `A recording is deleted from ${BRAND.name} after ${after}` : `${n} recordings are deleted from ${BRAND.name}, the first after ${after}`;
      await notify([{ userId: membership.userId, workspaceId, kind: "EXPIRING", text: bell, href: n > 1 ? "/library?filter=soon" : new URL(first.link).pathname }]);
    } catch (err) {
      // Release them so the next run tries again.
      if (!claim.mailed) await release(mine, stamp);
      console.error("expiry warning failed", err);
    }
  };
  for (const { to, videos } of groups.values()) {
    const claim = { stamp: new Date(now.getTime() + Math.floor(Math.random() * 1000)), mailed: false };
    try {
      await warnGroup(to, videos, claim);
    } catch (err) {
      // Something failed between marking these as warned and sending (a database error, say). Without this the mark
      // would stay and the warning would never go: clear it so the next run tries again, and carry on with the rest.
      if (!claim.mailed) await release(videos, claim.stamp).catch(() => {});
      console.error("expiry warning failed", err);
    }
  }
  return sent;
}
