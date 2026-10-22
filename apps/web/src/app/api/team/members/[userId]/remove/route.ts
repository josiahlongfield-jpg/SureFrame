import { db } from "@/lib/db";
import { applyRekey, RekeyBody } from "@/lib/rekey";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";
import { rateLimit } from "@/lib/rateLimit";
import { enforceSeatLimits } from "@/lib/seatLimits";
import { sendMail } from "@/lib/mail";
import { removedEmail } from "@/lib/staffEmails";
import { brandOf } from "@/lib/branding";
import { appUrl } from "@/lib/stripe";

export const maxDuration = 120;

/**
 * Remove someone from the team and reset every key they could have held.
 * The remover's browser made new team and client keys and re-sealed
 * everything (lib/e2e/rekey.ts); the person removed keeps nothing that opens
 * anything through us, and every client gets a new link.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ userId: string }> }) => {
  const { userId } = await ctx.params;
  const me = await requireUser();
  requireRole(me, "OWNER", "ADMIN");
  const { workspace } = me;
  await rateLimit(`rekey:${workspace.id}`, 20, 3600);
  const m = await db.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId: workspace.id } } });
  if (!m) throw new HttpError(404, "Not on this team");
  if (m.role === "OWNER") throw new HttpError(403, "The owner can't be changed or removed");
  if (userId === me.user.id) throw new HttpError(400, "Ask another admin or the owner to remove you");
  const body = RekeyBody.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, "Invalid key reset");
  const result = await applyRekey(workspace, body.data, async (tx) => {
    await tx.client.updateMany({ where: { workspaceId: workspace.id, assignedToId: userId }, data: { assignedToId: null } });
    // Their recordings and replies stay with the business: the owner takes them over, shown as a former team
    // member's rather than the owner's (lib/team.ts senderName). Their replies keep an author, so they never
    // count as the client's if their login is deleted later.
    const owner = await tx.membership.findFirstOrThrow({ where: { workspaceId: workspace.id, role: "OWNER" } });
    const now = new Date();
    await tx.video.updateMany({ where: { workspaceId: workspace.id, ownerId: userId }, data: { ownerId: owner.userId, formerStaffAt: now } });
    await tx.reply.updateMany({ where: { authorUserId: userId, video: { workspaceId: workspace.id } }, data: { authorUserId: owner.userId, formerStaffAt: now } });
    await tx.membership.delete({ where: { id: m.id } });
    // Their Claude connections end with their place on the team, and don't come back if they're invited again.
    await tx.connectorGrant.updateMany({ where: { workspaceId: workspace.id, userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.user.updateMany({ where: { id: userId, activeWorkspaceId: workspace.id }, data: { activeWorkspaceId: null } });
  });
  // A freed seat restores a paused staff member.
  await enforceSeatLimits(workspace.id);
  // They hear it from us, not only on their next sign-in. Nothing is emailed in a suspended workspace's name.
  const gone = await db.user.findUnique({ where: { id: userId }, select: { email: true, deleteAt: true } });
  if (gone && !gone.deleteAt && !workspace.suspendedAt && !workspace.closedAt) {
    const brand = brandOf(workspace, appUrl(""));
    await sendMail({ to: gone.email, ...removedEmail({ business: workspace.name, logoUrl: brand.logoUrl, color: brand.color }) }).catch((err) => console.error("removed email failed", err));
  }
  return Response.json(result);
});
