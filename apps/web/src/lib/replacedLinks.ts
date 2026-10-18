import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Personal links a key reset replaced (lib/rekey.ts, and restoring a client after one). Only a hash of the
 * old token is kept: it opens nothing, it just lets the old link say it was replaced and a new one sent,
 * rather than that it was mistyped.
 */
export const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** Inside the transaction that gives a client a new token. */
export function recordReplaced(tx: Prisma.TransactionClient, clientId: string, oldToken: string, emailed: boolean) {
  return tx.replacedLink.upsert({
    where: { tokenHash: tokenHash(oldToken) },
    create: { tokenHash: tokenHash(oldToken), clientId, emailed },
    update: { clientId, emailed },
  });
}

/** Marks the latest replaced link of a client as emailed, once the new link's email has gone. */
export async function markReplacedEmailed(clientId: string) {
  const last = await db.replacedLink.findFirst({ where: { clientId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (last) await db.replacedLink.update({ where: { id: last.id }, data: { emailed: true } });
}

/**
 * The replaced links among these tokens, the newest per client, with what a client needs to hear:
 * who replaced it and whether the new one was emailed. A client the business has since removed hears
 * that instead, so isn't included.
 */
export async function findReplaced(tokens: string[]) {
  if (!tokens.length) return [];
  const rows = await db.replacedLink.findMany({
    where: { tokenHash: { in: tokens.map(tokenHash) }, client: { removedAt: null } },
    orderBy: { createdAt: "desc" },
    select: {
      emailed: true,
      client: { select: { id: true, workspaceId: true, workspace: { select: { name: true, plan: true, brandColor: true, brandLogoType: true, brandVersion: true, id: true } } } },
    },
  });
  return [...new Map(rows.map((r) => [r.client.id, r])).values()];
}
