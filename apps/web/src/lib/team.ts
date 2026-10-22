import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { staffSeatLimit } from "@/lib/plans";
import { nameWithBusiness } from "@/lib/senderLine";

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
 * A business this person really works in, as opposed to the empty Free workspace every login is given on
 * first use (lib/session.ts currentUser), which someone who joined a team from an invite never set up: still
 * named after their email, on Free, with no subscription or complimentary plan. "Switch business" is only
 * offered between real ones (and the one open now).
 */
export const isRealBusiness = (m: { role: string; workspace: { name: string; plan: string; stripeSubscriptionId: string | null; complimentaryPlan: string | null } }) =>
  m.role !== "OWNER" || !isPlaceholderName(m.workspace.name) || m.workspace.plan !== "FREE" || !!m.workspace.stripeSubscriptionId || !!m.workspace.complimentaryPlan;

/** The businesses to offer in "Switch business": the real ones, and the one open now. */
export const switchableBusinesses = <M extends Parameters<typeof isRealBusiness>[0] & { workspaceId: string }>(memberships: M[], activeId: string) =>
  memberships.filter((m) => m.workspaceId === activeId || isRealBusiness(m));

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

/**
 * How someone who has left the team appears on what they recorded or wrote. Their recordings stay with the
 * business under its owner (video.ownerId), so without this the owner would be credited with them. They
 * aren't named once they've gone.
 */
export const FORMER_MEMBER = "Former team member";

type Sender = { formerStaffAt: Date | null; owner: { name: string | null; email?: string } };

/**
 * Who a video is from. The team sees the recorder's name (or the start of their email); clients see
 * "Sam from Business", or just the business when the recorder gave no name, never an email. Either way,
 * a former team member's recording reads "Former team member · Business".
 */
export function senderName(video: Sender, business: string, viewer: "team" | "client") {
  if (video.formerStaffAt) return `${FORMER_MEMBER} · ${business}`;
  if (viewer === "team") return video.owner.name ?? video.owner.email?.split("@")[0] ?? business;
  return video.owner.name ? nameWithBusiness(video.owner.name, business, "from") : business;
}
