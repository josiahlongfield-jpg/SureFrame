import { db } from "@/lib/db";
import { visibleReplies } from "@/lib/replies";

/**
 * How the team is keeping up with clients, for the owner's Team overview.
 * Worked out from who sent what and when; nothing encrypted is read.
 * Owners and admins only (the page checks), staff never see others' numbers.
 */
export const PERIODS = [7, 30, 90] as const;

export type StaffStats = {
  userId: string | null; // null = unassigned ("Shared") clients
  name: string;
  videosSent: number;
  staleClients: number;
  unanswered: number;
  /** Average time from a client's reply to the team's answer, in this period. */
  avgReplyMs: number | null;
  overdueTodos: number;
};

export type Unanswered = { videoId: string; clientId: string; clientName: string; staffId: string | null; since: Date; title: string };
export type StaleClient = { clientId: string; clientName: string; staffId: string | null; lastVideoAt: Date | null; addedAt: Date };
export type OverdueTodo = { itemId: string; clientId: string; clientName: string; staffId: string | null; dueAt: Date };

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export async function teamStats(workspaceId: string, o: { days: number; staleDays: number; now?: Date }) {
  const now = o.now ?? new Date();
  const since = new Date(now.getTime() - o.days * 86_400_000);
  const staleBefore = new Date(now.getTime() - o.staleDays * 86_400_000);

  const yearAgo = new Date(now.getTime() - 365 * 86_400_000);
  const recentReplies = { ...visibleReplies, createdAt: { gt: yearAgo } };
  const [members, clients, conversations, lastSent, todos] = await Promise.all([
    db.membership.findMany({ where: { workspaceId }, include: { user: { select: { name: true, email: true } } }, orderBy: { id: "asc" } }),
    db.client.findMany({ where: { workspaceId, removedAt: null }, select: { id: true, name: true, assignedToId: true, createdAt: true }, orderBy: { name: "asc" } }),
    // Only conversations that matter here: sent in this period, or with a reply in the last year
    // (reply times and anyone still waiting). Older ones only count towards "last video".
    db.video.findMany({
      where: { workspaceId, replyToId: null, clientId: { not: null }, OR: [{ sentAt: { gte: since } }, { createdAt: { gte: since } }, { replies: { some: recentReplies } }] },
      select: {
        id: true, title: true, ownerId: true, clientId: true, createdAt: true, sentAt: true, formerStaffAt: true,
        replies: { where: recentReplies, select: { authorUserId: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    // A video is sent when it's made or later, so the latest of either is the client's last video.
    db.video.groupBy({ by: ["clientId"], where: { workspaceId, replyToId: null, clientId: { not: null } }, _max: { sentAt: true, createdAt: true } }),
    db.item.findMany({ where: { workspaceId, kind: "TASK", done: false, dueAt: { lt: now }, clientId: { not: null } }, select: { id: true, clientId: true, dueAt: true }, orderBy: { dueAt: "asc" }, take: 2000 }),
  ]);

  const memberIds = new Set(members.map((m) => m.userId));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const staffOf = (clientId: string | null) => {
    const a = clientId ? clientById.get(clientId)?.assignedToId : null;
    return a && memberIds.has(a) ? a : null;
  };

  const sent = new Map<string, number>();
  const lastVideo = new Map<string, Date>();
  for (const g of lastSent) {
    const times = [g._max.sentAt, g._max.createdAt].filter((d): d is Date => !!d);
    if (g.clientId && times.length) lastVideo.set(g.clientId, new Date(Math.max(...times.map((d) => d.getTime()))));
  }
  const replyTimes = new Map<string | null, number[]>();
  const allReplyTimes: number[] = [];
  const unanswered: Unanswered[] = [];

  for (const v of conversations) {
    const clientId = v.clientId!;
    // Counted from when it was sent, so an older recording sent today counts today.
    const sentAt = v.sentAt ?? v.createdAt;
    // A former team member's sends count for the whole business only, not for the owner who now keeps them.
    const recorder = v.formerStaffAt ? null : v.ownerId;
    if (sentAt >= since) sent.set(recorder ?? "former", (sent.get(recorder ?? "former") ?? 0) + 1);
    const client = clientById.get(clientId);
    if (!client) continue; // removed client
    // Whoever looks after the client, else whoever recorded the video.
    const staff = staffOf(clientId) ?? (recorder && memberIds.has(recorder) ? recorder : null);
    let waiting: Date | null = null;
    for (const r of v.replies) {
      if (!r.authorUserId) {
        waiting ??= r.createdAt; // the client is waiting from their first unanswered reply
      } else if (waiting) {
        if (waiting >= since) {
          const ms = r.createdAt.getTime() - waiting.getTime();
          replyTimes.set(staff, [...(replyTimes.get(staff) ?? []), ms]);
          allReplyTimes.push(ms);
        }
        waiting = null;
      }
    }
    if (waiting) unanswered.push({ videoId: v.id, clientId, clientName: client.name, staffId: staff, since: waiting, title: v.title });
  }
  unanswered.sort((a, b) => a.since.getTime() - b.since.getTime());

  // Quiet: no video for staleDays. A client added within that time who hasn't had one yet isn't quiet,
  // just new ("No video yet"), so they're listed apart and not counted as neglected.
  const quietOrNew = clients
    .filter((c) => !lastVideo.has(c.id) || lastVideo.get(c.id)! < staleBefore)
    .map((c) => ({ clientId: c.id, clientName: c.name, staffId: staffOf(c.id), lastVideoAt: lastVideo.get(c.id) ?? null, addedAt: c.createdAt }))
    .sort((a, b) => (a.lastVideoAt?.getTime() ?? 0) - (b.lastVideoAt?.getTime() ?? 0));
  const isNew = (c: StaleClient) => !c.lastVideoAt && c.addedAt >= staleBefore;
  const stale = quietOrNew.filter((c) => !isNew(c));
  const noVideoYet = quietOrNew.filter(isNew);

  const overdue: OverdueTodo[] = todos
    .filter((t) => clientById.has(t.clientId!))
    .map((t) => ({ itemId: t.id, clientId: t.clientId!, clientName: clientById.get(t.clientId!)!.name, staffId: staffOf(t.clientId), dueAt: t.dueAt! }));

  const row = (userId: string | null, name: string): StaffStats => ({
    userId,
    name,
    videosSent: userId ? (sent.get(userId) ?? 0) : 0,
    staleClients: stale.filter((s) => s.staffId === userId).length,
    unanswered: unanswered.filter((u) => u.staffId === userId).length,
    avgReplyMs: avg(replyTimes.get(userId) ?? []),
    overdueTodos: overdue.filter((t) => t.staffId === userId).length,
  });
  const staff = members.map((m) => row(m.userId, m.user.name ?? m.user.email.split("@")[0]));
  const shared = row(null, "Unassigned clients");
  const overall: StaffStats = {
    userId: null,
    name: "Whole business",
    videosSent: [...sent.values()].reduce((a, b) => a + b, 0),
    staleClients: stale.length,
    unanswered: unanswered.length,
    avgReplyMs: avg(allReplyTimes),
    overdueTodos: overdue.length,
  };
  // Their own row in the table, so the Videos sent column adds up to the whole business's (S81). Only what they sent:
  // their clients and conversations are the team's now, under whoever looks after them.
  const formerSent = sent.get("former") ?? 0;
  const former: StaffStats | null = formerSent
    ? { userId: null, name: "Former team members", videosSent: formerSent, staleClients: 0, unanswered: 0, avgReplyMs: null, overdueTodos: 0 }
    : null;
  return { since, staff, shared, former, overall, unanswered, stale, noVideoYet, overdue };
}

/** "3h", "2d", "45m". */
export function duration(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
