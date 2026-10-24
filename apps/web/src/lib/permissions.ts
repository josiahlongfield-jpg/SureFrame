import type { Membership, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/session";

/**
 * Who on a team may see and do what. Owners and admins have full access.
 * A member (staff) sees only the clients assigned to them, the videos sent
 * to those clients and the videos they recorded themselves, plus whatever
 * else the owner or an admin turned on for them on the Team page.
 *
 * Everything the server hands out about clients, videos, conversations and
 * to-dos goes through these checks. Staff devices hold the team key, so this
 * is the line that keeps them out: the server never serves them anything
 * (ciphertext included) for a client they can't see.
 */
export type Access = {
  userId: string;
  workspaceId: string;
  role: Role;
  perms: StaffPerms;
};

export type StaffPerms = { seeAllClients: boolean; addClients: boolean; deleteAnyVideo: boolean; sendToMany: boolean };

/** What a new member can do until the owner or an admin changes it. */
export const DEFAULT_STAFF_PERMS: StaffPerms = { seeAllClients: false, addClients: true, deleteAnyVideo: false, sendToMany: true };

export const PERM_KEYS = ["seeAllClients", "addClients", "deleteAnyVideo", "sendToMany"] as const;

export const permsOf = (m: Pick<Membership, (typeof PERM_KEYS)[number]>): StaffPerms => ({
  seeAllClients: m.seeAllClients,
  addClients: m.addClients,
  deleteAnyVideo: m.deleteAnyVideo,
  sendToMany: m.sendToMany,
});

/** Build the access record for a signed-in user (the shape currentUser() returns). */
export function accessOf(me: { user: { id: string }; workspace: { id: string }; role: Role; membership?: Pick<Membership, (typeof PERM_KEYS)[number]> | null }): Access {
  return { userId: me.user.id, workspaceId: me.workspace.id, role: me.role, perms: me.membership ? permsOf(me.membership) : DEFAULT_STAFF_PERMS };
}

export const isManager = (a: Pick<Access, "role">) => a.role === "OWNER" || a.role === "ADMIN";

/** Sees every client in the workspace, including unassigned ("Shared") ones. */
export const seesAllClients = (a: Access) => isManager(a) || a.perms.seeAllClients;

/** Effective permissions, with owners and admins always allowed everything. */
export function effectivePerms(a: Access): StaffPerms {
  if (isManager(a)) return { seeAllClients: true, addClients: true, deleteAnyVideo: true, sendToMany: true };
  return a.perms;
}

/** Prisma filter for the clients this person may see. */
export function clientScopeWhere(a: Access): Prisma.ClientWhereInput {
  return seesAllClients(a) ? { workspaceId: a.workspaceId } : { workspaceId: a.workspaceId, assignedToId: a.userId };
}

export function canSeeClient(a: Access, client: { workspaceId: string; assignedToId: string | null }) {
  return client.workspaceId === a.workspaceId && (seesAllClients(a) || client.assignedToId === a.userId);
}

/**
 * A conversation with a client who is being deleted (lib/clientRemoval.ts), which goes with them: hidden from the
 * moment they're deleted. A recording also sent to someone else stays.
 */
const deletedClientsOnly: Prisma.VideoWhereInput = { client: { removedAt: { not: null } }, copies: { none: { OR: [{ clientId: null }, { client: { removedAt: null } }] } } };

/**
 * The library list: originals, plus (for restricted staff) the copies sent to
 * their clients when they can't open the original itself.
 */
export function libraryWhere(a: Access): Prisma.VideoWhereInput {
  if (seesAllClients(a)) return { workspaceId: a.workspaceId, replyToId: null, sourceId: null, NOT: deletedClientsOnly };
  return {
    workspaceId: a.workspaceId,
    replyToId: null,
    NOT: deletedClientsOnly,
    OR: [
      { ownerId: a.userId, sourceId: null },
      { ownerId: { not: a.userId }, client: { assignedToId: a.userId } },
    ],
  };
}

type VideoLike = { workspaceId: string; ownerId: string; clientId: string | null; replyToId: string | null };

/**
 * May this person open this video (a conversation; pass the root for reply
 * media)? `client` is the video's client when the caller already has it.
 */
export async function canSeeVideo(a: Access, video: VideoLike, client?: { assignedToId: string | null } | null) {
  if (video.workspaceId !== a.workspaceId) return false;
  if (seesAllClients(a) || video.ownerId === a.userId) return true;
  if (!video.clientId) return false;
  const c = client !== undefined ? client : await db.client.findUnique({ where: { id: video.clientId }, select: { assignedToId: true } });
  return c?.assignedToId === a.userId;
}

/** The conversation a video belongs to: itself, or the video a reply's media was posted in. */
export async function rootOf<V extends VideoLike & { replyToId: string | null }>(video: V) {
  return video.replyToId ? await db.video.findUnique({ where: { id: video.replyToId } }) : video;
}

/** Load a video (or reply media) this person may see, or 404. */
export async function visibleVideo(a: Access, id: string) {
  const video = await db.video.findUnique({ where: { id } });
  if (!video || video.workspaceId !== a.workspaceId) throw new HttpError(404, "Video not found");
  const root = await rootOf(video);
  if (!root || !(await canSeeVideo(a, root))) throw new HttpError(404, "Video not found");
  return video;
}

/** Deleting: owners/admins any video; staff their own, or any they can see if allowed. */
export function canDeleteVideo(a: Access, video: { ownerId: string }) {
  return isManager(a) || video.ownerId === a.userId || a.perms.deleteAnyVideo;
}

export function requirePerm(a: Access, perm: keyof StaffPerms, message: string) {
  if (!effectivePerms(a)[perm]) throw new HttpError(403, message);
}

/**
 * Who on the team hears about one client (e.g. a to-do reminder): the staff
 * member assigned to them, else everyone who can see unassigned clients
 * (owner, admins, and staff allowed to see all clients).
 */
export function clientTeam<M extends Pick<Membership, "userId" | "role" | "seeAllClients">>(members: M[], client: { assignedToId: string | null }) {
  const assigned = client.assignedToId ? members.find((m) => m.userId === client.assignedToId) : undefined;
  return assigned ? [assigned] : members.filter((m) => m.role !== "MEMBER" || m.seeAllClients);
}
