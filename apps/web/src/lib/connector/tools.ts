import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { clientScopeWhere, isManager, type Access } from "@/lib/permissions";
import { visibleReplies } from "@/lib/replies";
import { duration, teamStats } from "@/lib/monitoring";
import { FORMER_MEMBER } from "@/lib/team";

/**
 * The activity tools both connectors offer (lib/connector/grants.ts). Read-only, and only what the person can
 * see in their team right now (lib/permissions.ts): names, dates, counts and whether things were opened or
 * answered. Nothing here reads anything encrypted, so the server never needs a key.
 *
 * Each tool returns plain JSON for the assistant to work from.
 */
export class ToolInputError extends Error {}

type Args = Record<string, unknown>;
export type ConnectorTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  managersOnly?: boolean;
  run: (access: Access, args: Args, now: Date) => Promise<unknown>;
};

const DAY = 86_400_000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function intArg(args: Args, key: string, fallback: number, min: number, max: number) {
  const v = args[key];
  if (v === undefined || v === null || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new ToolInputError(`${key} must be a number`);
  return Math.min(max, Math.max(min, Math.round(n)));
}
function strArg(args: Args, key: string) {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ToolInputError(`${key} must be text`);
  return v.trim().slice(0, 200) || undefined;
}
function enumArg<T extends string>(args: Args, key: string, values: readonly T[], fallback: T): T {
  const v = strArg(args, key);
  if (!v) return fallback;
  if (!values.includes(v as T)) throw new ToolInputError(`${key} must be one of: ${values.join(", ")}`);
  return v as T;
}

/** The clients this person can see, still on the books. */
const myClients = (a: Access): Prisma.ClientWhereInput => ({ ...clientScopeWhere(a), removedAt: null });
/** Videos sent to those clients (a client's own copy of a video sent to several counts as theirs). */
const myClientVideos = (a: Access): Prisma.VideoWhereInput => ({ workspaceId: a.workspaceId, replyToId: null, client: myClients(a) });
/** To-dos on the business's own list and on those clients. */
const myTodos = (a: Access): Prisma.ItemWhereInput => ({
  workspaceId: a.workspaceId,
  kind: "TASK",
  OR: [{ clientId: null }, { client: myClients(a) }],
});

/** One client by id or (part of) its name. Several matches come back as a list to pick from. */
async function findClient(a: Access, ref: string | undefined) {
  if (!ref) throw new ToolInputError("client is required (a name or id from list_clients)");
  const byId = await db.client.findFirst({ where: { ...myClients(a), id: ref } });
  if (byId) return byId;
  const matches = await db.client.findMany({ where: { ...myClients(a), name: { contains: ref, mode: "insensitive" } }, orderBy: { name: "asc" }, take: 10 });
  const exact = matches.filter((c) => c.name.toLowerCase() === ref.toLowerCase());
  if (exact.length === 1 || matches.length === 1) return exact[0] ?? matches[0];
  if (!matches.length) throw new ToolInputError(`No client you can see matches "${ref}". Use list_clients to find them.`);
  throw new ToolInputError(`Several clients match "${ref}": ${matches.map((c) => `${c.name} (${c.id})`).join(", ")}. Ask which one, then pass its id.`);
}

async function staffNames(workspaceId: string) {
  const members = await db.membership.findMany({ where: { workspaceId }, include: { user: { select: { name: true, email: true } } } });
  return new Map(members.map((m) => [m.userId, m.user.name ?? m.user.email.split("@")[0]]));
}

type Conversation = { id: string; title: string; clientId: string | null; replies: { authorUserId: string | null; byClient: boolean; createdAt: Date }[] };

/** When the client started waiting for an answer in this conversation, or null if nobody's waiting. */
function waitingSince(v: Conversation) {
  let waiting: Date | null = null;
  for (const r of v.replies) {
    if (r.byClient || !r.authorUserId) waiting ??= r.createdAt;
    else waiting = null;
  }
  return waiting;
}

async function waitingConversations(a: Access, where: Prisma.VideoWhereInput = {}) {
  const yearAgo = new Date(Date.now() - 365 * DAY);
  const recent = { ...visibleReplies, createdAt: { gt: yearAgo } };
  const convs = await db.video.findMany({
    where: { ...myClientVideos(a), ...where, replies: { some: recent } },
    select: {
      id: true, title: true, clientId: true, client: { select: { name: true, assignedToId: true } },
      replies: { where: recent, select: { authorUserId: true, byClient: true, createdAt: true }, orderBy: { createdAt: "asc" } },
    },
    take: 2000,
  });
  return convs
    .map((v) => ({ v, since: waitingSince(v) }))
    .filter((x): x is { v: (typeof convs)[number]; since: Date } => !!x.since)
    .sort((x, y) => x.since.getTime() - y.since.getTime());
}

const READ_NOTE = "Messages, replies, to-dos, notes and transcripts are end-to-end encrypted, so only names, dates and counts are available here.";

export const TOOLS: ConnectorTool[] = [
  {
    name: "get_overview",
    title: "Overview",
    description:
      "A summary of SureFrame activity for the clients this person can see: videos sent and opened, clients waiting for an answer, quiet clients, new clients who haven't opened their link, and overdue or upcoming to-dos. Start here for a report.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 365, description: "How many days back to count videos sent (default 7)." },
        quiet_days: { type: "integer", minimum: 1, maximum: 365, description: "A client is quiet if they haven't had a video in this many days (default 14)." },
      },
      additionalProperties: false,
    },
    async run(a, args, now) {
      const days = intArg(args, "days", 7, 1, 365);
      const quietDays = intArg(args, "quiet_days", 14, 1, 365);
      const since = new Date(now.getTime() - days * DAY);
      const quietBefore = new Date(now.getTime() - quietDays * DAY);
      const sentWhere: Prisma.VideoWhereInput = { ...myClientVideos(a), OR: [{ sentAt: { gte: since } }, { sentAt: null, createdAt: { gte: since } }] };
      const [clients, newClients, sent, opened, waiting, overdue, dueWeek, quiet] = await Promise.all([
        db.client.count({ where: myClients(a) }),
        db.client.count({ where: { ...myClients(a), linkOpenedAt: null } }),
        db.video.count({ where: sentWhere }),
        db.video.count({ where: { ...sentWhere, viewCount: { gt: 0 } } }),
        waitingConversations(a),
        db.item.count({ where: { ...myTodos(a), done: false, dueAt: { lt: now } } }),
        db.item.count({ where: { ...myTodos(a), done: false, dueAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY) } } }),
        db.client.count({ where: { ...myClients(a), videos: { none: { replyToId: null, OR: [{ sentAt: { gte: quietBefore } }, { createdAt: { gte: quietBefore } }] } } } }),
      ]);
      return {
        period: { days, from: iso(since), to: iso(now) },
        scope: isManager(a) ? "whole team" : "your clients",
        clients,
        new_clients_not_opened_link: newClients,
        videos_sent: sent,
        videos_opened: opened,
        clients_waiting_for_answer: waiting.length,
        longest_wait: waiting[0] ? duration(now.getTime() - waiting[0].since.getTime()) : null,
        quiet_clients: { count: quiet, no_video_for_days: quietDays },
        todos: { overdue, due_next_7_days: dueWeek },
        note: READ_NOTE,
      };
    },
  },
  {
    name: "list_clients",
    title: "List clients",
    description:
      "Clients this person can see, with who looks after them, their last video, whether they're waiting for an answer, and overdue to-dos. Filter to clients waiting for an answer, quiet clients, or new ones who haven't opened their link.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["all", "waiting", "quiet", "new"], description: "Which clients (default all)." },
        query: { type: "string", description: "Part of a client's name." },
        quiet_days: { type: "integer", minimum: 1, maximum: 365, description: "For filter quiet: no video in this many days (default 14)." },
      },
      additionalProperties: false,
    },
    async run(a, args, now) {
      const filter = enumArg(args, "filter", ["all", "waiting", "quiet", "new"] as const, "all");
      const query = strArg(args, "query");
      const quietDays = intArg(args, "quiet_days", 14, 1, 365);
      const where: Prisma.ClientWhereInput = { ...myClients(a), ...(query ? { name: { contains: query, mode: "insensitive" } } : {}), ...(filter === "new" ? { linkOpenedAt: null } : {}) };
      const [clients, names, last, waiting, overdue] = await Promise.all([
        db.client.findMany({ where, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true, assignedToId: true, linkOpenedAt: true, createdAt: true } }),
        staffNames(a.workspaceId),
        db.video.groupBy({ by: ["clientId"], where: myClientVideos(a), _max: { sentAt: true, createdAt: true } }),
        waitingConversations(a),
        db.item.groupBy({ by: ["clientId"], where: { ...myTodos(a), done: false, dueAt: { lt: now }, clientId: { not: null } }, _count: { _all: true } }),
      ]);
      const lastVideo = new Map(last.map((g) => [g.clientId, [g._max.sentAt, g._max.createdAt].filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime())[0] ?? null]));
      const waitingFor = new Map<string, Date>();
      for (const w of waiting) if (w.v.clientId && !waitingFor.has(w.v.clientId)) waitingFor.set(w.v.clientId, w.since);
      const overdueOf = new Map(overdue.map((g) => [g.clientId, g._count._all]));
      const quietBefore = now.getTime() - quietDays * DAY;
      const rows = clients
        .map((c) => ({
          id: c.id,
          name: c.name,
          looked_after_by: c.assignedToId ? (names.get(c.assignedToId) ?? FORMER_MEMBER) : "Shared (unassigned)",
          added: iso(c.createdAt),
          opened_their_link: !!c.linkOpenedAt,
          last_video_at: iso(lastVideo.get(c.id)),
          waiting_for_answer_since: iso(waitingFor.get(c.id)),
          overdue_todos: overdueOf.get(c.id) ?? 0,
        }))
        .filter((c) => (filter === "waiting" ? !!c.waiting_for_answer_since : filter === "quiet" ? !c.last_video_at || Date.parse(c.last_video_at) < quietBefore : true));
      return { count: rows.length, clients: rows };
    },
  },
  {
    name: "get_client_activity",
    title: "Client activity",
    description:
      "One client's activity: videos sent to them (opened or not), when they and the team replied, and their to-dos' due dates. Pass the client's name or id.",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string", description: "The client's name (or part of it) or id." },
        days: { type: "integer", minimum: 1, maximum: 365, description: "How many days back (default 30)." },
      },
      required: ["client"],
      additionalProperties: false,
    },
    async run(a, args, now) {
      const client = await findClient(a, strArg(args, "client"));
      const days = intArg(args, "days", 30, 1, 365);
      const since = new Date(now.getTime() - days * DAY);
      const [names, videos, todos, notes] = await Promise.all([
        staffNames(a.workspaceId),
        db.video.findMany({
          where: { ...myClientVideos(a), clientId: client.id, OR: [{ createdAt: { gte: since } }, { sentAt: { gte: since } }, { replies: { some: { ...visibleReplies, createdAt: { gte: since } } } }] },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true, title: true, createdAt: true, sentAt: true, viewCount: true, durationMs: true, ownerId: true, formerStaffAt: true, status: true,
            replies: { where: visibleReplies, orderBy: { createdAt: "asc" }, select: { kind: true, authorUserId: true, byClient: true, formerStaffAt: true, createdAt: true } },
          },
        }),
        db.item.findMany({ where: { workspaceId: a.workspaceId, clientId: client.id, kind: "TASK", OR: [{ done: false }, { updatedAt: { gte: since } }] }, orderBy: { dueAt: "asc" }, take: 200, select: { dueAt: true, done: true, shared: true, createdAt: true } }),
        db.item.count({ where: { workspaceId: a.workspaceId, clientId: client.id, kind: "NOTE" } }),
      ]);
      const who = (userId: string | null, former: Date | null) => (former ? FORMER_MEMBER : userId ? (names.get(userId) ?? FORMER_MEMBER) : null);
      return {
        client: { id: client.id, name: client.name, looked_after_by: client.assignedToId ? (names.get(client.assignedToId) ?? FORMER_MEMBER) : "Shared (unassigned)", opened_their_link: !!client.linkOpenedAt },
        period: { days, from: iso(since) },
        videos: videos.map((v) => ({
          id: v.id,
          title: v.title,
          recorded_by: who(v.ownerId, v.formerStaffAt),
          sent_at: iso(v.sentAt ?? v.createdAt),
          length_seconds: v.durationMs ? Math.round(v.durationMs / 1000) : null,
          opened: v.viewCount > 0,
          views: v.viewCount,
          expired: v.status === "EXPIRED",
          replies: v.replies.map((r) => ({ from: r.byClient || !r.authorUserId ? "client" : who(r.authorUserId, r.formerStaffAt), kind: r.kind.toLowerCase(), at: iso(r.createdAt) })),
          client_waiting_since: iso(waitingSince({ id: v.id, title: v.title, clientId: client.id, replies: v.replies })),
        })),
        todos: todos.map((t) => ({ due: iso(t.dueAt), done: t.done, overdue: !t.done && !!t.dueAt && t.dueAt < now, shared_with_client: t.shared })),
        notes: notes,
        note: READ_NOTE,
      };
    },
  },
  {
    name: "list_replies_waiting",
    title: "Replies waiting",
    description: "Conversations where a client replied and nobody on the team has answered yet, longest wait first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run(a, _args, now) {
      const [waiting, names] = await Promise.all([waitingConversations(a), staffNames(a.workspaceId)]);
      return {
        count: waiting.length,
        waiting: waiting.slice(0, 200).map(({ v, since }) => ({
          client: v.client?.name ?? null,
          client_id: v.clientId,
          looked_after_by: v.client?.assignedToId ? (names.get(v.client.assignedToId) ?? FORMER_MEMBER) : "Shared (unassigned)",
          video: v.title,
          video_id: v.id,
          waiting_since: iso(since),
          waiting_for: duration(now.getTime() - since.getTime()),
        })),
      };
    },
  },
  {
    name: "list_todos",
    title: "List to-dos",
    description: "Open to-dos by due date, on the business's own list and the clients this person can see. Only due dates and clients: the to-dos' text is end-to-end encrypted.",
    inputSchema: {
      type: "object",
      properties: {
        range: { type: "string", enum: ["overdue", "today", "week", "all"], description: "Overdue, due in the next 24 hours, due in the next 7 days, or every open to-do (default week, which includes overdue)." },
        client: { type: "string", description: "Only this client's to-dos (name or id)." },
      },
      additionalProperties: false,
    },
    async run(a, args, now) {
      const range = enumArg(args, "range", ["overdue", "today", "week", "all"] as const, "week");
      const ref = strArg(args, "client");
      const client = ref ? await findClient(a, ref) : null;
      const until = range === "overdue" ? now : range === "today" ? new Date(now.getTime() + DAY) : range === "week" ? new Date(now.getTime() + 7 * DAY) : null;
      const items = await db.item.findMany({
        where: { ...myTodos(a), done: false, ...(client ? { clientId: client.id } : {}), ...(until ? { dueAt: { lt: until } } : {}) },
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
        take: 500,
        select: { id: true, dueAt: true, shared: true, client: { select: { name: true } }, createdAt: true },
      });
      return {
        range,
        count: items.length,
        todos: items.map((t) => ({ id: t.id, client: t.client?.name ?? "Business list", due: iso(t.dueAt), overdue: !!t.dueAt && t.dueAt < now, shared_with_client: t.shared, added: iso(t.createdAt) })),
        note: READ_NOTE,
      };
    },
  },
  {
    name: "list_videos",
    title: "List videos",
    description: "Videos sent to clients this person can see, newest first: title, client, who recorded it, when it was sent, whether it was opened, and replies.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 365, description: "How many days back (default 30)." },
        client: { type: "string", description: "Only this client's videos (name or id)." },
        unopened_only: { type: "boolean", description: "Only videos the client hasn't opened yet." },
      },
      additionalProperties: false,
    },
    async run(a, args, now) {
      const days = intArg(args, "days", 30, 1, 365);
      const ref = strArg(args, "client");
      const client = ref ? await findClient(a, ref) : null;
      const since = new Date(now.getTime() - days * DAY);
      const [names, videos] = await Promise.all([
        staffNames(a.workspaceId),
        db.video.findMany({
          where: {
            ...myClientVideos(a),
            ...(client ? { clientId: client.id } : {}),
            ...(args.unopened_only === true ? { viewCount: 0 } : {}),
            OR: [{ sentAt: { gte: since } }, { sentAt: null, createdAt: { gte: since } }],
          },
          orderBy: { createdAt: "desc" },
          take: 300,
          select: {
            id: true, title: true, createdAt: true, sentAt: true, viewCount: true, ownerId: true, formerStaffAt: true, durationMs: true,
            client: { select: { name: true } },
            _count: { select: { replies: { where: visibleReplies } } },
          },
        }),
      ]);
      return {
        period: { days, from: iso(since) },
        count: videos.length,
        videos: videos.map((v) => ({
          id: v.id,
          title: v.title,
          client: v.client?.name ?? null,
          recorded_by: v.formerStaffAt ? FORMER_MEMBER : (names.get(v.ownerId) ?? FORMER_MEMBER),
          sent_at: iso(v.sentAt ?? v.createdAt),
          length_seconds: v.durationMs ? Math.round(v.durationMs / 1000) : null,
          opened: v.viewCount > 0,
          views: v.viewCount,
          replies: v._count.replies,
        })),
      };
    },
  },
  {
    name: "get_team_activity",
    title: "Team activity",
    description:
      "How each team member is keeping up with their clients: videos sent, clients waiting for an answer, average time to answer, quiet clients and overdue to-dos. Owners and admins only.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 365, description: "How many days back (default 30)." },
        quiet_days: { type: "integer", minimum: 1, maximum: 365, description: "A client is quiet with no video in this many days (default 14)." },
      },
      additionalProperties: false,
    },
    managersOnly: true,
    async run(a, args, now) {
      const days = intArg(args, "days", 30, 1, 365);
      const s = await teamStats(a.workspaceId, { days, staleDays: intArg(args, "quiet_days", 14, 1, 365), now });
      const row = (r: (typeof s.staff)[number]) => ({
        name: r.name,
        videos_sent: r.videosSent,
        clients_waiting_for_answer: r.unanswered,
        average_time_to_answer: r.avgReplyMs === null ? null : duration(r.avgReplyMs),
        quiet_clients: r.staleClients,
        overdue_todos: r.overdueTodos,
      });
      return { period: { days, from: iso(s.since) }, whole_business: row(s.overall), team: s.staff.map(row), unassigned_clients: row(s.shared) };
    },
  },
];

/** The tools this person may use: team activity is for owners and admins. */
export const toolsFor = (a: Access) => TOOLS.filter((t) => !t.managersOnly || isManager(a));
