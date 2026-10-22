import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { rotationDTO } from "@/lib/keys";
import { clientScopeWhere, type Access } from "@/lib/permissions";
import { visibleReplies } from "@/lib/replies";
import { FORMER_MEMBER } from "@/lib/team";
import { ToolInputError } from "@/lib/connector/tools";

/**
 * What the desktop connector unlocks on the person's own computer (apps/connector): the same encrypted to-dos,
 * notes, messages, replies and summaries the person's browser gets, with the wrapped keys that open them.
 * Nothing here is readable without the team key, which only ever reaches the server's caller, never the server.
 *
 * Desktop connections only, and only what the person can see in the team right now (lib/permissions.ts).
 */
const DAY = 86_400_000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const myClients = (a: Access): Prisma.ClientWhereInput => ({ ...clientScopeWhere(a), removedAt: null });
const myItems = (a: Access): Prisma.ItemWhereInput => ({ workspaceId: a.workspaceId, OR: [{ clientId: null }, { client: myClients(a) }] });

async function staffNames(workspaceId: string) {
  const members = await db.membership.findMany({ where: { workspaceId }, include: { user: { select: { name: true, email: true } } } });
  return new Map(members.map((m) => [m.userId, m.user.name ?? m.user.email.split("@")[0]]));
}

/** The team key's chain, so the connector can bring an older key up to date after a key reset. */
export async function teamKeys(a: Access) {
  const [ws, rotations] = await Promise.all([
    db.workspace.findUnique({ where: { id: a.workspaceId }, select: { keyFingerprint: true, name: true } }),
    db.keyRotation.findMany({ where: { workspaceId: a.workspaceId, clientId: null }, orderBy: { createdAt: "asc" } }),
  ]);
  return { team: ws?.name ?? null, fingerprint: ws?.keyFingerprint ?? null, rotations: rotations.map(rotationDTO) };
}

async function findClient(a: Access, ref: unknown) {
  if (typeof ref !== "string" || !ref.trim()) throw new ToolInputError("client is required (a name or id)");
  const q = ref.trim().slice(0, 200);
  const byId = await db.client.findFirst({ where: { ...myClients(a), id: q } });
  if (byId) return byId;
  const matches = await db.client.findMany({ where: { ...myClients(a), name: { contains: q, mode: "insensitive" } }, orderBy: { name: "asc" }, take: 10 });
  const exact = matches.filter((c) => c.name.toLowerCase() === q.toLowerCase());
  if (exact.length === 1 || matches.length === 1) return exact[0] ?? matches[0];
  if (!matches.length) throw new ToolInputError(`No client you can see matches "${q}".`);
  throw new ToolInputError(`Several clients match "${q}": ${matches.map((c) => `${c.name} (${c.id})`).join(", ")}. Ask which one, then pass its id.`);
}

const itemSelect = {
  id: true, kind: true, body: true, done: true, dueAt: true, shared: true, authorName: true, createdAt: true, updatedAt: true, clientId: true,
  client: { select: { name: true, teamKeyWrap: true } },
} satisfies Prisma.ItemSelect;

type ItemRow = Prisma.ItemGetPayload<{ select: typeof itemSelect }>;
/** A to-do or note: private ones are sealed with the team key, shared ones with the client's key (wrapped with the team key). */
const sealedItem = (i: ItemRow) => ({
  id: i.id,
  kind: i.kind === "TASK" ? "todo" : "note",
  client: i.client?.name ?? null,
  client_id: i.clientId,
  sealed: i.body,
  key: i.shared ? { client_wrap: i.client?.teamKeyWrap ?? null } : "team",
  done: i.done,
  due: iso(i.dueAt),
  shared_with_client: i.shared,
  by: i.authorName,
  added: iso(i.createdAt),
  updated: iso(i.updatedAt),
});

const conversationSelect = {
  id: true, title: true, createdAt: true, sentAt: true, viewCount: true, ownerId: true, formerStaffAt: true, encrypted: true, teamKeyWrap: true, message: true, sourceId: true,
  client: { select: { id: true, name: true } },
  replies: { where: visibleReplies, orderBy: { createdAt: "asc" }, select: { kind: true, body: true, encrypted: true, authorName: true, authorUserId: true, byClient: true, formerStaffAt: true, createdAt: true } },
} satisfies Prisma.VideoSelect;
type ConversationRow = Prisma.VideoGetPayload<{ select: typeof conversationSelect }>;

/** A video and its conversation: the message, text replies and summary are sealed with the video's key (wrapped with the team key). */
async function sealedConversations(rows: ConversationRow[], names: Map<string, string>, withInsight: boolean) {
  const insights = withInsight
    ? await db.videoInsight.findMany({ where: { videoId: { in: [...new Set(rows.map((v) => v.sourceId ?? v.id))] } }, select: { videoId: true, summary: true, transcript: true } })
    : [];
  return rows.map((v) => {
    const insight = insights.find((i) => i.videoId === (v.sourceId ?? v.id));
    return {
      id: v.id,
      title: v.title,
      client: v.client?.name ?? null,
      client_id: v.client?.id ?? null,
      recorded_by: v.formerStaffAt ? FORMER_MEMBER : (names.get(v.ownerId) ?? FORMER_MEMBER),
      sent_at: iso(v.sentAt ?? v.createdAt),
      opened: v.viewCount > 0,
      video_wrap: v.encrypted ? v.teamKeyWrap : null,
      message: v.message,
      replies: v.replies.map((r) => ({
        from: r.byClient || !r.authorUserId ? "client" : r.formerStaffAt ? FORMER_MEMBER : r.authorName,
        by_client: r.byClient || !r.authorUserId,
        kind: r.kind.toLowerCase(),
        sealed: r.kind === "TEXT" && r.encrypted ? r.body : null,
        text: r.kind === "TEXT" && !r.encrypted ? r.body : null,
        at: iso(r.createdAt),
      })),
      summary: insight ? { sealed_summary: insight.summary, sealed_transcript: insight.transcript } : null,
    };
  });
}

export type SealedQuery = Record<string, unknown> & { query?: unknown };

function days(q: SealedQuery, fallback: number) {
  const n = Number(q.days ?? fallback);
  return Number.isFinite(n) ? Math.min(365, Math.max(1, Math.round(n))) : fallback;
}

/** One request from the desktop connector. */
export async function sealedQuery(a: Access, q: SealedQuery, now = new Date()) {
  switch (q.query) {
    case "keys":
      return teamKeys(a);
    case "client": {
      const client = await findClient(a, q.client);
      const since = new Date(now.getTime() - days(q, 90) * DAY);
      const [names, items, convs] = await Promise.all([
        staffNames(a.workspaceId),
        db.item.findMany({ where: { workspaceId: a.workspaceId, clientId: client.id }, select: itemSelect, orderBy: [{ done: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: 500 }),
        db.video.findMany({
          where: { workspaceId: a.workspaceId, replyToId: null, clientId: client.id, OR: [{ createdAt: { gte: since } }, { sentAt: { gte: since } }, { replies: { some: { ...visibleReplies, createdAt: { gte: since } } } }] },
          select: conversationSelect,
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      ]);
      return {
        client: { id: client.id, name: client.name, looked_after_by: client.assignedToId ? (names.get(client.assignedToId) ?? FORMER_MEMBER) : "Shared (unassigned)", client_wrap: client.teamKeyWrap },
        items: items.map(sealedItem),
        conversations: await sealedConversations(convs, names, true),
      };
    }
    case "items": {
      const kind = q.kind === "note" ? "NOTE" : q.kind === "todo" ? "TASK" : undefined;
      const client = q.client ? await findClient(a, q.client) : null;
      const range = typeof q.range === "string" ? q.range : "all";
      const until = range === "overdue" ? now : range === "today" ? new Date(now.getTime() + DAY) : range === "week" ? new Date(now.getTime() + 7 * DAY) : null;
      const items = await db.item.findMany({
        where: {
          ...myItems(a),
          ...(kind ? { kind } : {}),
          ...(client ? { clientId: client.id } : {}),
          ...(kind === "TASK" && q.open !== false ? { done: false } : {}),
          ...(until ? { dueAt: { lt: until } } : {}),
        },
        select: itemSelect,
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
        take: 1000,
      });
      return { items: items.map(sealedItem) };
    }
    case "conversation": {
      if (typeof q.video !== "string") throw new ToolInputError("video is required (a video id)");
      const [names, v] = await Promise.all([
        staffNames(a.workspaceId),
        db.video.findFirst({ where: { id: q.video, workspaceId: a.workspaceId, replyToId: null, client: myClients(a) }, select: conversationSelect }),
      ]);
      if (!v) throw new ToolInputError("No video you can see has that id. Use list_videos to find it.");
      return { conversation: (await sealedConversations([v], names, true))[0] };
    }
    case "recent": {
      // Everything said lately, for searching on the device.
      const since = new Date(now.getTime() - days(q, 30) * DAY);
      const [names, convs, items] = await Promise.all([
        staffNames(a.workspaceId),
        db.video.findMany({
          where: { workspaceId: a.workspaceId, replyToId: null, client: myClients(a), OR: [{ createdAt: { gte: since } }, { sentAt: { gte: since } }, { replies: { some: { ...visibleReplies, createdAt: { gte: since } } } }] },
          select: conversationSelect,
          orderBy: { createdAt: "desc" },
          take: 300,
        }),
        db.item.findMany({ where: { AND: [myItems(a), { OR: [{ done: false }, { updatedAt: { gte: since } }] }] }, select: itemSelect, orderBy: { updatedAt: "desc" }, take: 1000 }),
      ]);
      return { conversations: await sealedConversations(convs, names, q.summaries === true), items: items.map(sealedItem) };
    }
    default:
      throw new ToolInputError("Unknown query");
  }
}
