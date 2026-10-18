import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/team";

/**
 * Old personal links that a key reset replaced (lib/rekey.ts, and restoring a client after one), with the
 * business that replaced them and whether the client was emailed the new one. Lets an old link, or a
 * device still holding one, say "replaced" rather than "mistyped". Only hashes of old links are kept.
 * A client the business has since removed hears that instead, so isn't included. One row per client,
 * the newest.
 */
export async function replacedLinks(tokens: string[]) {
  if (!tokens.length) return [];
  const rows = await db.replacedClientLink.findMany({
    where: { tokenHash: { in: tokens.map(hashToken) }, client: { removedAt: null } },
    orderBy: { createdAt: "desc" },
    select: {
      emailed: true,
      client: { select: { id: true, workspaceId: true, workspace: { select: { id: true, name: true, plan: true, brandColor: true, brandLogoType: true, brandVersion: true } } } },
    },
  });
  return [...new Map(rows.map((r) => [r.client.id, { ...r, business: r.client.workspace.name }])).values()];
}

/** Inside the transaction that gives a restored client a new link (lib/clientRemoval.ts). */
export function recordReplaced(tx: Prisma.TransactionClient, clientId: string, oldToken: string, emailed: boolean) {
  const tokenHash = hashToken(oldToken);
  return tx.replacedClientLink.upsert({ where: { tokenHash }, create: { tokenHash, clientId, emailed }, update: { clientId, emailed } });
}

/** Marks a client's latest replaced link as emailed, once the new link's email has gone. */
export async function markReplacedEmailed(clientId: string) {
  const last = await db.replacedClientLink.findFirst({ where: { clientId }, orderBy: { createdAt: "desc" }, select: { tokenHash: true } });
  if (last) await db.replacedClientLink.update({ where: { tokenHash: last.tokenHash }, data: { emailed: true } });
}
