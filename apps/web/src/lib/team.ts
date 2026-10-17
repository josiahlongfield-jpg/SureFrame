import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { staffSeatLimit } from "@/lib/plans";

/** Invite links work for a week. */
export const INVITE_DAYS = 7;

export const newInviteToken = () => crypto.randomBytes(24).toString("base64url");
export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** Joining refused while the joiner's own account is closed and waiting to be deleted (lib/accountDeletion.ts). */
export const ACCOUNT_CLOSED_JOIN = "Your account is closed and waiting to be deleted. Keep it first, then open this invite again.";
/** Joining refused while the team's owner has closed their account. */
export const TEAM_CLOSED_JOIN = "This team has closed its SureFrame account, so it can't take new staff.";
/** Joining refused while support has suspended the team's workspace (lib/support/admin.ts). */
export const TEAM_UNAVAILABLE_JOIN = "This team's SureFrame account is unavailable right now, so it can't take new staff.";

/**
 * Staff who can use the team now, and so are sent team emails: not paused by
 * the plan (lib/seatLimits.ts), and their login isn't suspended by support
 * (lib/support/admin.ts) or closed (lib/accountDeletion.ts). A membership filter.
 */
export const activeMember = { pausedAt: null, user: { suspendedAt: null, deleteAt: null } } satisfies Prisma.MembershipWhereInput;

/** Staff seats in use: people on the team plus invites still waiting to be accepted. */
export async function staffUsage(
  workspace: { id: string; plan: Parameters<typeof staffSeatLimit>[0]["plan"]; extraStaffSeats: number },
  client: Pick<typeof db, "membership" | "invite"> = db,
) {
  const [members, pending] = await Promise.all([
    client.membership.count({ where: { workspaceId: workspace.id } }),
    client.invite.count({ where: { workspaceId: workspace.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return { members, pending, used: members + pending, limit: staffSeatLimit(workspace) };
}

/** A business still named after its owner's email, as new workspaces start ("sam's workspace"). */
export const isPlaceholderName = (name: string) => /'s workspace$/i.test(name.trim());

/**
 * Teams this person joined from an invite and is no longer on: an owner or
 * admin removed them (the invite stays accepted; the membership goes). Told
 * plainly, rather than finding themselves in a new empty workspace.
 */
export async function formerTeams(userId: string) {
  const accepted = await db.invite.findMany({
    where: { acceptedById: userId, workspace: { members: { none: { userId } }, deleteAt: null, closedAt: null } },
    select: { workspaceId: true, workspace: { select: { name: true } } },
    orderBy: { acceptedAt: "desc" },
  });
  return [...new Map(accepted.map((i) => [i.workspaceId, { id: i.workspaceId, name: i.workspace.name }])).values()];
}
