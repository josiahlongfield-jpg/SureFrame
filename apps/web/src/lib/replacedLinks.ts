import { db } from "@/lib/db";
import { hashToken } from "@/lib/team";

/**
 * Old personal links that a key reset replaced (lib/rekey.ts), with the business that replaced them and
 * whether the client was emailed the new one. Lets an old link, or a device still holding one, say
 * "replaced" rather than "mistyped". Only hashes of old links are kept.
 */
export async function replacedLinks(tokens: string[]) {
  if (!tokens.length) return [];
  const rows = await db.replacedClientLink.findMany({
    where: { tokenHash: { in: tokens.map(hashToken) }, client: { removedAt: null } },
    select: { emailed: true, client: { select: { workspace: { select: { name: true } } } } },
  });
  return [...new Map(rows.map((r) => [r.client.workspace.name, { business: r.client.workspace.name, emailed: r.emailed }])).values()];
}
