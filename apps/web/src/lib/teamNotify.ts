import type { Membership, TeamNotificationKind } from "@prisma/client";
import { db } from "@/lib/db";
import { brandOf } from "@/lib/branding";
import { sendMail } from "@/lib/mail";
import { teamEmail } from "@/lib/teamEmail";
import { appUrl } from "@/lib/stripe";
import { teamPath } from "@/lib/teamLink";
import { activeMember } from "@/lib/team";

/**
 * Team emails about client replies and videos sent by staff. Each event is
 * queued per recipient; one email covers everything queued for the same
 * person and group (a conversation, or a staff member's sends), and a group
 * gets at most one email per 15 minutes. What's left waits for the next
 * email or the reminders job (every 5 minutes), which sends it as a digest.
 */
export const NOTIFY_WINDOW_MS = 15 * 60 * 1000;

type Member = Pick<Membership, "userId" | "role" | "replyNotify" | "replyNotifyStaff" | "sentNotify" | "sentNotifyStaff">;
const isManager = (m: Pick<Membership, "role">) => m.role === "OWNER" || m.role === "ADMIN";

/**
 * Who hears about a client's reply: the person looking after the
 * conversation (assigned staff member, else whoever recorded the video, else
 * the owner), plus owners and admins whose preferences ask for it. Anyone
 * who turned their reply emails off gets none (staff do this for their own
 * clients in Settings > Account). That never affects owners and admins: they
 * still get what their own preferences ask for, and the Team overview counts
 * every reply either way.
 */
export function replyRecipients(members: Member[], o: { assignedToId: string | null; recorderId: string }) {
  const find = (id: string | null) => (id ? members.find((m) => m.userId === id) : undefined);
  const primary = find(o.assignedToId) ?? find(o.recorderId) ?? members.find((m) => m.role === "OWNER");
  // Whose client this is, for "Only selected staff".
  const responsible = find(o.assignedToId) ?? find(o.recorderId);
  const out = new Set<string>();
  if (primary && primary.replyNotify !== "OFF") out.add(primary.userId);
  for (const m of members) {
    if (!isManager(m)) continue;
    if (m.replyNotify === "ALL") out.add(m.userId);
    if (m.replyNotify === "SELECTED" && responsible && m.replyNotifyStaff.includes(responsible.userId)) out.add(m.userId);
  }
  return [...out];
}

/** Owners and admins (never the sender) who asked to hear about this staff member's sends. */
export function sentRecipients(members: Member[], o: { actorId: string; assignedToId: string | null }) {
  return members
    .filter((m) => isManager(m) && m.userId !== o.actorId)
    .filter((m) =>
      m.sentNotify === "ALL" ||
      (m.sentNotify === "SELECTED" && m.sentNotifyStaff.includes(o.actorId)) ||
      (m.sentNotify === "MINE" && o.assignedToId === m.userId),
    )
    .map((m) => m.userId);
}

/** A client replied in this conversation. Never throws. */
export async function notifyClientReply(conversationId: string) {
  try {
    const video = await db.video.findUnique({ where: { id: conversationId }, include: { client: true } });
    if (!video || video.replyToId || !video.client) return;
    // Paused or suspended staff can't sign in: their clients' replies go to whoever else would hear (the owner at least).
    const members = await db.membership.findMany({ where: { workspaceId: video.workspaceId, ...activeMember }, orderBy: { id: "asc" } });
    const to = replyRecipients(members, { assignedToId: video.client.assignedToId, recorderId: video.ownerId });
    if (!to.length) return;
    await db.teamNotification.createMany({
      data: to.map((userId) => ({ kind: "CLIENT_REPLY" as const, userId, workspaceId: video.workspaceId, groupKey: video.id, clientId: video.clientId, videoId: video.id })),
    });
    for (const userId of to) await flushGroup(userId, "CLIENT_REPLY", video.id);
  } catch (err) {
    console.error("reply notification failed", err);
  }
}

/** A team member sent videos to clients (one send, or a send to many). Never throws. */
export async function notifyVideosSent(workspaceId: string, actorId: string, sends: { videoId: string; clientId: string }[]) {
  try {
    if (!sends.length) return;
    const [members, clients] = await Promise.all([
      db.membership.findMany({ where: { workspaceId, ...activeMember }, orderBy: { id: "asc" } }),
      db.client.findMany({ where: { id: { in: sends.map((s) => s.clientId) } }, select: { id: true, assignedToId: true } }),
    ]);
    const assigned = new Map(clients.map((c) => [c.id, c.assignedToId]));
    const rows = sends.flatMap((s) =>
      sentRecipients(members, { actorId, assignedToId: assigned.get(s.clientId) ?? null }).map((userId) => ({
        kind: "VIDEO_SENT" as const, userId, workspaceId, groupKey: `sent:${actorId}`, actorUserId: actorId, clientId: s.clientId, videoId: s.videoId,
      })),
    );
    if (!rows.length) return;
    await db.teamNotification.createMany({ data: rows });
    for (const userId of new Set(rows.map((r) => r.userId))) await flushGroup(userId, "VIDEO_SENT", `sent:${actorId}`);
  } catch (err) {
    console.error("sent notification failed", err);
  }
}

/** Atomically take the 15-minute slot for one person and group. */
async function claim(key: string, now: Date) {
  const cutoff = new Date(now.getTime() - NOTIFY_WINDOW_MS);
  const rows = await db.$queryRaw<{ key: string }[]>`
    INSERT INTO "NotifyThrottle" ("key", "lastSentAt") VALUES (${key}, ${now})
    ON CONFLICT ("key") DO UPDATE SET "lastSentAt" = ${now} WHERE "NotifyThrottle"."lastSentAt" < ${cutoff}
    RETURNING "key"`;
  return rows.length > 0;
}

/** Send one email covering everything queued for this person and group, unless one went out in the last 15 minutes. */
export async function flushGroup(userId: string, kind: TeamNotificationKind, groupKey: string, now = new Date()) {
  const pending = await db.teamNotification.findMany({ where: { userId, kind, groupKey, sentAt: null }, orderBy: { createdAt: "asc" } });
  if (!pending.length) return false;
  if (!(await claim(`${kind}:${userId}:${groupKey}`, now))) return false;
  const taken = await db.teamNotification.updateMany({ where: { id: { in: pending.map((p) => p.id) }, sentAt: null }, data: { sentAt: now } });
  if (!taken.count) return false;

  const ws = await db.workspace.findUnique({ where: { id: pending[0].workspaceId } });
  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { email: true, suspendedAt: true } }),
    db.membership.findFirst({ where: { userId, workspaceId: pending[0].workspaceId } }),
  ]);
  // Left the team or paused since, or the owner closed the account (lib/accountDeletion.ts), or support suspended
  // the workspace or their login (lib/support/admin.ts): dropped, not sent later.
  if (!ws || !user || !membership || membership.pausedAt || ws.deleteAt || ws.suspendedAt || ws.closedAt || user.suspendedAt) return false;
  const brand = brandOf(ws, appUrl(""));
  const clients = new Map((await db.client.findMany({ where: { id: { in: pending.map((p) => p.clientId!).filter(Boolean) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const clientName = (id: string | null) => (id && clients.get(id)) || "A client";

  let mail;
  if (kind === "CLIENT_REPLY") {
    const name = clientName(pending[0].clientId);
    const n = pending.length;
    mail = teamEmail({
      business: ws.name,
      // Owners and admins following along get these too, so not "your video".
      subject: n === 1 ? `${name} replied` : `${name} sent ${n} replies`,
      lead: n === 1 ? `${name} replied to a video from ${ws.name}.` : `${name} sent ${n} replies to a video from ${ws.name}.`,
      button: { label: "Open the conversation", link: appUrl(`/v/${groupKey}?team=1`) },
      footer: "For privacy, replies are only shown in the app. Choose which emails you get under Settings > Account, Emails to you.",
      logoUrl: brand.logoUrl,
      color: brand.color,
    });
  } else {
    const actor = await db.user.findUnique({ where: { id: pending[0].actorUserId ?? "" }, select: { name: true, email: true } });
    const who = actor?.name ?? actor?.email.split("@")[0] ?? "Someone on your team";
    const n = pending.length;
    mail = teamEmail({
      business: ws.name,
      subject: `${who} sent ${n === 1 ? "a video" : `${n} videos`} to clients`,
      lead: `${who} sent ${n === 1 ? "a video" : `${n} videos`} to clients:`,
      lines: pending.map((p) => ({ text: clientName(p.clientId), link: p.videoId ? appUrl(`/v/${p.videoId}?team=1`) : undefined })),
      button: { label: "Open the Team overview", link: appUrl(teamPath("/team", ws.id)) },
      footer: "Choose which emails you get under Settings > Account, Emails to you.",
      logoUrl: brand.logoUrl,
      color: brand.color,
    });
  }
  try {
    await sendMail({ to: user.email, ...mail });
  } catch (err) {
    // Put them back so the reminders job tries again.
    await db.teamNotification.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { sentAt: null } });
    await db.notifyThrottle.deleteMany({ where: { key: `${kind}:${userId}:${groupKey}` } });
    throw err;
  }
  return true;
}

/** Run from the reminders job: send the digests whose 15 minutes are up. */
export async function flushTeamNotifications(now = new Date()) {
  const groups = await db.teamNotification.groupBy({ by: ["userId", "kind", "groupKey"], where: { sentAt: null }, orderBy: { userId: "asc" }, take: 200 });
  let sent = 0;
  for (const g of groups) {
    try {
      if (await flushGroup(g.userId, g.kind, g.groupKey, now)) sent++;
    } catch (err) {
      console.error("team digest failed", err);
    }
  }
  return sent;
}

/** Daily: drop old sent notifications and expired throttles. */
export async function pruneTeamNotifications(now = new Date()) {
  // Kept while the workspace is on legal hold (lib/support/admin.ts).
  await db.teamNotification.deleteMany({ where: { sentAt: { lt: new Date(now.getTime() - 30 * 86_400_000) }, workspace: { legalHoldAt: null } } });
  await db.notifyThrottle.deleteMany({ where: { lastSentAt: { lt: new Date(now.getTime() - 86_400_000) } } });
}
