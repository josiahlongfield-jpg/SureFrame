import { cookies } from "next/headers";
import type { Client, Prisma, Video } from "@prisma/client";
import { db, type Workspace } from "@/lib/db";
import { ACCOUNT_SUSPENDED, currentUser, HttpError, STAFF_PAUSED, termsRequired } from "@/lib/session";
import { accessOf, canSeeClient, canSeeVideo, type Access } from "@/lib/permissions";

/** Cookie a client's personal link sets, one per workspace they belong to. */
export const clientCookie = (workspaceId: string) => `fc_client_${workspaceId}`;
/**
 * Set briefly when a client whose access has ended (removed, or the business closed its account), whose
 * business's videos are unavailable or link turned off, or whose link a key reset replaced, opens their old
 * link, so their inbox can say who (never grants access).
 */
export const REMOVED_COOKIE = "fc_removed";

/** What a client's link needs to know about their business's workspace (include as `workspace: { select: clientGate }`). */
export const clientGate = { suspendedAt: true, closedAt: true, deleteAt: true } as const;
type Gated = Pick<Client, "removedAt" | "pausedAt" | "linkDisabledAt"> & { workspace: Pick<Workspace, "suspendedAt" | "closedAt" | "deleteAt"> };

/**
 * Why a client's personal link opens nothing right now, or null when it works:
 * - "removed": the business removed them (lib/clientRemoval.ts);
 * - "unavailable": SureFrame support suspended or closed the business's workspace (clients are never told "suspended");
 * - "closed": the business closed its own account (lib/accountDeletion.ts);
 * - "off": SureFrame support turned this client's link off (lib/support/admin.ts);
 * - "paused": the business's plan no longer covers them (lib/seatLimits.ts).
 */
export function clientBlock(c: Gated): "removed" | "unavailable" | "closed" | "off" | "paused" | null {
  if (c.removedAt) return "removed";
  if (c.workspace.suspendedAt || c.workspace.closedAt) return "unavailable";
  if (c.workspace.deleteAt) return "closed";
  if (c.linkDisabledAt) return "off";
  if (c.pausedAt) return "paused";
  return null;
}

/** The same rule as a query: clients whose link works and who can be sent things. */
export const usableClientWhere = {
  removedAt: null,
  pausedAt: null,
  linkDisabledAt: null,
  workspace: { suspendedAt: null, closedAt: null, deleteAt: null },
} satisfies Prisma.ClientWhereInput;

/** Refused when sending to a client whose link support turned off. */
export const linkOffMessage = (name: string) => `${name}'s link has been turned off by SureFrame support, so they can't be sent anything. Contact support@sureframe.app.`;

export type Viewer =
  | { kind: "member"; userId: string; name: string; access: Access }
  | { kind: "client"; client: Client; name: string };

/**
 * Who is looking at this video, if they are allowed to. Videos are private:
 * team members see the conversations their access allows (lib/permissions.ts),
 * and a client can see only videos sent to them (plus the replies inside
 * those conversations). There is no public access. A member who hasn't agreed
 * to the current terms (lib/terms.ts) isn't one here until they do.
 */
export async function viewerFor(video: Video): Promise<Viewer | null> {
  const root = video.replyToId ? await db.video.findUnique({ where: { id: video.replyToId } }) : video;
  if (!root) return null;

  const me = await currentUser();
  if (me && !me.paused && !me.suspended && me.agreed && me.workspace.id === root.workspaceId) {
    const access = accessOf(me);
    if (await canSeeVideo(access, root)) {
      // Clients see this on replies: the business name rather than part of an email address.
      return { kind: "member", userId: me.user.id, name: me.user.name || me.workspace.name, access };
    }
  }

  const token = (await cookies()).get(clientCookie(root.workspaceId))?.value;
  if (!token || !root.clientId) return null;
  const client = await db.client.findUnique({ where: { token }, include: { workspace: { select: clientGate } } });
  // Removed, paused, turned off, or the business's account unavailable: nothing opens (clientBlock).
  if (!client || client.id !== root.clientId || clientBlock(client)) return null;
  return { kind: "client", client, name: client.name };
}

/** Load a video and require that the caller may view it (404 otherwise, so ids don't leak). */
export async function viewableVideo(id: string) {
  const video = await db.video.findUnique({ where: { id } });
  if (!video) throw new HttpError(404, "Video not found");
  const viewer = await viewerFor(video);
  if (!viewer) {
    // Their own team's video: the terms are what's in the way, not the video.
    const me = await currentUser();
    if (me && !me.agreed && !me.paused && !me.suspended && me.workspace.id === video.workspaceId) throw termsRequired();
    throw new HttpError(404, "Video not found");
  }
  return { video, viewer };
}

/** The client signed in on this device for a workspace (via their personal link), if any. */
export async function clientFromCookie(workspaceId: string) {
  const token = (await cookies()).get(clientCookie(workspaceId))?.value;
  if (!token) return null;
  const client = await db.client.findUnique({ where: { token }, include: { workspace: { select: clientGate } } });
  return client && !clientBlock(client) && client.workspaceId === workspaceId ? client : null;
}

/**
 * Either a team member allowed to see the client named by `clientId` (or any
 * member when there is none), or that client on their own device.
 */
export async function memberOrClient(clientId: string | null) {
  const me = await currentUser();
  if (clientId) {
    const client = await db.client.findUnique({ where: { id: clientId } });
    if (!client || client.removedAt) throw new HttpError(404, "Not found");
    const member = !!me && !me.paused && !me.suspended && me.workspace.id === client.workspaceId && canSeeClient(accessOf(me), client);
    if (member && me.agreed) return { kind: "member" as const, me, workspaceId: client.workspaceId };
    const self = await clientFromCookie(client.workspaceId);
    if (self?.id === client.id) return { kind: "client" as const, client: self, workspaceId: client.workspaceId };
    if (member) throw termsRequired();
    throw new HttpError(404, "Not found");
  }
  if (!me) throw new HttpError(401, "Sign in required");
  if (me.suspended) throw new HttpError(403, ACCOUNT_SUSPENDED, "ACCOUNT_SUSPENDED");
  if (me.paused) throw new HttpError(403, STAFF_PAUSED);
  if (!me.agreed) throw termsRequired();
  return { kind: "member" as const, me, workspaceId: me.workspace.id };
}
