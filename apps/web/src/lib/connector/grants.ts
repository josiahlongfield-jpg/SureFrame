import crypto from "node:crypto";
import type { ConnectorGrant, Membership, User, Workspace } from "@prisma/client";
import { db } from "@/lib/db";
import { accessOf, type Access } from "@/lib/permissions";
import { suspensionOf } from "@/lib/session";
import { hasAgreed, noticePeriod } from "@/lib/terms";

/**
 * Read-only connections from a person's own AI assistant (the SureFrame connectors for Claude).
 *
 * "online" grants come from Claude's remote connector, signed in with OAuth (lib/connector/oauth.ts): short-lived
 * access tokens plus a refresh token that's replaced every time it's used. "desktop" grants are made in Settings for
 * the connector installed on the person's own computer: one token that lasts until it's disconnected.
 *
 * Only one-way fingerprints of tokens are stored. A grant can only read, only what its person can see in its
 * workspace right now (lib/permissions.ts), and stops working when they disconnect it, lose access to the team,
 * or the account is suspended, closed or deleted.
 */
export type GrantKind = "online" | "desktop";

export const ACCESS_TTL_MS = 3_600_000;
/** Unused this long, an online connection has to sign in again. Each refresh starts it over. */
export const REFRESH_TTL_MS = 60 * 86_400_000;
/** How long the list of tool uses shown in Settings is kept. */
export const USE_KEEP_DAYS = 90;

export const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
export const newToken = (prefix: "sfa" | "sfr" | "sfd") => `${prefix}_${crypto.randomBytes(32).toString("base64url")}`;

export type ConnectorCaller = {
  grant: ConnectorGrant;
  access: Access;
  user: User;
  workspace: Omit<Workspace, "brandLogo">;
  membership: Membership;
};

/** Why a token didn't work, in words the assistant can pass on. */
export class ConnectorDenied extends Error {
  constructor(message: string, public expired = false) {
    super(message);
  }
}

/** The caller behind `Authorization: Bearer <token>`, or a ConnectorDenied saying why not. */
export async function connectorCaller(req: Request, kinds: GrantKind[]): Promise<ConnectorCaller> {
  const header = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!token) throw new ConnectorDenied("Sign in required");
  const grant = await db.connectorGrant.findUnique({ where: { accessHash: tokenHash(token) } });
  if (!grant || grant.revokedAt || !kinds.includes(grant.kind as GrantKind)) throw new ConnectorDenied("This connection has been disconnected. Connect SureFrame again.", true);
  if (grant.accessExpiresAt && grant.accessExpiresAt <= new Date()) throw new ConnectorDenied("Sign-in expired", true);
  const user = await db.user.findUnique({ where: { id: grant.userId } });
  const membership = await db.membership.findUnique({ where: { userId_workspaceId: { userId: grant.userId, workspaceId: grant.workspaceId } }, include: { workspace: true } });
  if (!user || user.deleteAt || !membership) throw new ConnectorDenied("This account no longer has access to this team.", true);
  const { workspace, ...m } = membership;
  if (suspensionOf(user, workspace)) throw new ConnectorDenied("This account is suspended. Contact support@sureframe.app.");
  if (m.pausedAt) throw new ConnectorDenied("Your access to this team is paused because its plan changed. Ask the owner to restore it.");
  if (!(await hasAgreed(user.id)) && !(await noticePeriod(user)))
    throw new ConnectorDenied("Please sign in to SureFrame and agree to the current Terms of Service and Privacy Policy first.");
  // Noted at most once a minute, so a burst of tool calls is one write.
  if (!grant.lastUsedAt || Date.now() - grant.lastUsedAt.getTime() > 60_000)
    await db.connectorGrant.update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { grant, access: accessOf({ user, workspace, role: m.role, membership: m }), user, workspace, membership: m as Membership };
}

/** Logs one tool use for the person's list in Settings: which tool and when, never what it returned. */
export async function logUse(grantId: string, tool: string) {
  await db.connectorUse.create({ data: { grantId, tool: tool.slice(0, 60) } }).catch(() => {});
}

/** A new desktop connection for this person and workspace: the token, shown once. */
export async function makeDesktopGrant(userId: string, workspaceId: string) {
  const token = newToken("sfd");
  const grant = await db.connectorGrant.create({
    data: { kind: "desktop", name: "Claude desktop connector", accessHash: tokenHash(token), userId, workspaceId },
  });
  return { grant, token };
}

/** Daily clean-up: old use records, connections disconnected or unused past their sign-in, spent sign-in codes. */
export async function pruneConnectors(now = new Date()) {
  const useCutoff = new Date(now.getTime() - USE_KEEP_DAYS * 86_400_000);
  await db.connectorUse.deleteMany({ where: { createdAt: { lt: useCutoff } } });
  await db.connectorGrant.deleteMany({
    where: { OR: [{ revokedAt: { lt: useCutoff } }, { kind: "online", refreshExpiresAt: { lt: useCutoff } }] },
  });
  await db.oAuthCode.deleteMany({ where: { expiresAt: { lt: now } } });
  // Registrations nobody has a connection from any more (Claude registers afresh for each new connection).
  const used = await db.connectorGrant.findMany({ where: { oauthClientId: { not: null } }, select: { oauthClientId: true }, distinct: ["oauthClientId"] });
  await db.oAuthClient.deleteMany({ where: { createdAt: { lt: useCutoff }, id: { notIn: used.map((g) => g.oauthClientId!) } } });
}
