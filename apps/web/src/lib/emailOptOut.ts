import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appSecret } from "@/lib/secrets";

/**
 * A client's "stop emailing me" outlives their client record (MAIL-10, 26 November 2026). `Client.remindersOff` is
 * the switch itself; this keeps a marker of each address that turned a business's emails off, so that if the business
 * deletes the client and adds the same address again, the new client starts with emails off. Written when a client
 * turns emails off (and, for clients who did so before markers existed, when they're deleted); removed when they turn
 * them back on; gone with the workspace (onDelete: Cascade).
 *
 * The marker is an HMAC of the workspace id and the lower-cased address, keyed with the app's existing secret
 * (AUTH_SECRET, lib/secrets.ts), never the address. Keyed rather than salted: email addresses are easy to guess, so
 * a salt stored beside the hash would still let anyone holding a copy of the database test addresses one by one,
 * while without the secret the markers say nothing. The workspace id in it means the same address gives a different
 * marker for each business, so markers can't be matched across businesses. If AUTH_SECRET is ever changed, existing
 * markers stop matching (clients already on a list keep their own setting; only re-adding forgets it).
 */
export const optOutMarker = (workspaceId: string, email: string) =>
  crypto.createHmac("sha256", appSecret()).update(`email-opt-out:${workspaceId}:${email.trim().toLowerCase()}`).digest("base64url");

type Db = Prisma.TransactionClient | typeof db;

/** Keeps the marker for this client's address, if it has one. Safe to call again. */
export async function rememberOptOut(clientId: string, tx: Db = db) {
  const c = await tx.client.findUnique({ where: { id: clientId }, select: { workspaceId: true, email: true } });
  if (!c?.email) return;
  await tx.emailOptOut.createMany({ data: [{ workspaceId: c.workspaceId, marker: optOutMarker(c.workspaceId, c.email) }], skipDuplicates: true });
}

/** The client turned emails back on: forgets the marker for their address. */
export async function forgetOptOut(clientId: string, tx: Db = db) {
  const c = await tx.client.findUnique({ where: { id: clientId }, select: { workspaceId: true, email: true } });
  if (!c?.email) return;
  await tx.emailOptOut.deleteMany({ where: { workspaceId: c.workspaceId, marker: optOutMarker(c.workspaceId, c.email) } });
}

/** Which of these addresses turned this business's emails off before, lower-cased. */
export async function optedOutBefore(workspaceId: string, emails: (string | null | undefined)[], tx: Db = db) {
  const byMarker = new Map(emails.flatMap((e) => (e ? [[optOutMarker(workspaceId, e), e.trim().toLowerCase()] as const] : [])));
  if (!byMarker.size) return new Set<string>();
  const found = await tx.emailOptOut.findMany({ where: { workspaceId, marker: { in: [...byMarker.keys()] } }, select: { marker: true } });
  return new Set(found.map((f) => byMarker.get(f.marker)!));
}
