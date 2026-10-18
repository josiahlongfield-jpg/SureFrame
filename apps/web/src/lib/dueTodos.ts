import { db } from "@/lib/db";
import { clientScopeWhere, type Access } from "@/lib/permissions";

/** "Due" in the menu badge and the library's list: overdue, or due within this long. */
export const DUE_SOON_MS = 24 * 3_600_000;

export type DueTodos = { total: number; general: number; clients: { id: string; name: string; count: number }[] };

/**
 * Open to-dos that are overdue or due within a day, for the menu badge and the
 * library. Only counts and client names: the to-dos' text is encrypted.
 */
export async function dueTodos(access: Access): Promise<DueTodos> {
  const rows = await db.item.groupBy({
    by: ["clientId"],
    where: {
      workspaceId: access.workspaceId,
      kind: "TASK",
      done: false,
      dueAt: { lte: new Date(Date.now() + DUE_SOON_MS) },
      // The business's own list, and the clients this person can see.
      OR: [{ clientId: null }, { client: { ...clientScopeWhere(access), removedAt: null } }],
    },
    _count: { _all: true },
  });
  const ids = rows.flatMap((r) => (r.clientId ? [r.clientId] : []));
  const names = ids.length ? await db.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const clients = rows
    .flatMap((r) => {
      const c = names.find((n) => n.id === r.clientId);
      return c ? [{ id: c.id, name: c.name, count: r._count._all }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const general = rows.find((r) => !r.clientId)?._count._all ?? 0;
  return { total: general + clients.reduce((n, c) => n + c.count, 0), general, clients };
}
