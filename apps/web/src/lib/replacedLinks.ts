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
      // teamKeyWrap: only whether they have a key at all (a client from before encryption has none to hold).
      client: { select: { id: true, workspaceId: true, teamKeyWrap: true, workspace: { select: { id: true, name: true, plan: true, brandColor: true, brandLogoType: true, brandVersion: true } } } },
    },
  });
  return [...new Map(rows.map((r) => [r.client.id, { ...r, business: r.client.workspace.name }])).values()];
}

/**
 * The "Your link was replaced" card's line about an emailed new link, on a device that isn't known to hold this
 * client's key (lib/e2e/keyHeld.ts). The emailed link carries no key, so it only opens on a device that had it:
 * the same words as the email itself (lib/newLinkEmail.ts), not a promise that it opens here.
 */
export const emailedNotHere = (business: string) =>
  `They've emailed you your new link. Open it on the phone or computer you used before, and your videos and replies are all there. On a phone or computer you haven't used before, it can't open your videos: ask ${business} for your full personal link.`;
