import { db } from "@/lib/db";
import { hashToken } from "@/lib/team";

/**
 * Old personal links that a key reset replaced (lib/rekey.ts, which writes the rows), with the
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
