import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ACCOUNT_CLOSED_BY_SUPPORT, ACCOUNT_SUSPENDED, handle, HttpError, termsRequired } from "@/lib/session";
import { hasAgreed, recordAgreement } from "@/lib/terms";
import { limitByIp } from "@/lib/rateLimit";
import { EMAIL_BLOCKED, isEmailBlocked } from "@/lib/blockedEmail";
import { ACCOUNT_CLOSED_JOIN, hashToken, staffUsage, TEAM_CLOSED_JOIN, TEAM_UNAVAILABLE_JOIN } from "@/lib/team";

/** `agree`: ticked on the invite page, so agreeing to the terms and joining are one step. */
const Body = z.object({ token: z.string().min(20).max(100), agree: z.boolean().optional() });

/**
 * Accept an invite. Deliberately doesn't use currentUser(), which would
 * create a personal workspace for someone who only came to join a team.
 * Returns the wrapped team key so the browser can unwrap it with the
 * one-off key from the link's #fragment.
 */
export const POST = handle(async (req: Request) => {
  await limitByIp("join", 30, 3600);
  const userId = (await auth())?.user?.id;
  // A browser still holding a sign-in for an account deleted elsewhere.
  const me = userId ? await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, createdAt: true, deleteAt: true, suspendedAt: true, closedAt: true } }) : null;
  if (!userId || !me) throw new HttpError(401, "Sign in required");
  // Closed by support: it can't be kept, so there's nothing to keep first (lib/support/admin.ts).
  if (me.closedAt) throw new HttpError(403, ACCOUNT_CLOSED_BY_SUPPORT, "ACCOUNT_CLOSED");
  // A blocked address (lib/blockedEmail.ts) can't take on anything new, even from a sign-in made before the block.
  if (await isEmailBlocked(me.email)) throw new HttpError(403, EMAIL_BLOCKED, "EMAIL_BLOCKED");
  // A closed account (lib/accountDeletion.ts) is kept first, from the page it's offered on.
  if (me.deleteAt) throw new HttpError(403, ACCOUNT_CLOSED_JOIN);
  // A login suspended by support joins nothing (lib/support/admin.ts).
  if (me.suspendedAt) throw new HttpError(403, ACCOUNT_SUSPENDED, "ACCOUNT_SUSPENDED");
  const body = Body.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, "This invite link is incomplete");
  // Agree to the current Terms and Privacy Policy first (lib/terms.ts): ticked on the invite page itself.
  if (!(await hasAgreed(userId))) {
    if (!body.data.agree) throw termsRequired();
    await recordAgreement(me);
  }
  const invite = await db.invite.findUnique({ where: { tokenHash: hashToken(body.data.token) }, include: { workspace: true } });
  if (!invite || invite.revokedAt) throw new HttpError(404, "This invite was cancelled or doesn't exist. Ask for a new one.");
  if (invite.workspace.suspendedAt || invite.workspace.closedAt) throw new HttpError(403, TEAM_UNAVAILABLE_JOIN);
  if (invite.workspace.deleteAt) throw new HttpError(410, TEAM_CLOSED_JOIN);

  // An invite made out to an address only works for that address.
  if (invite.email) {
    if (me.email?.toLowerCase() !== invite.email.toLowerCase()) {
      throw new HttpError(403, `This invite is for ${invite.email}. Sign in with that address to accept it.`);
    }
  }
  const existing = await db.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId: invite.workspaceId } } });
  // The same person opening their link again (say, on a second device) gets the key again.
  const again = invite.acceptedAt && invite.acceptedById === userId;
  // Someone already on the team opening a link made out to nobody in particular (say, to try it)
  // gets the team key, but the invite stays free for the person it was meant for.
  const alreadyHere = !!existing && !invite.email;
  if (!again && !alreadyHere) {
    if (invite.acceptedAt) throw new HttpError(410, "This invite has already been used. Ask for a new one.");
    if (invite.expiresAt < new Date()) throw new HttpError(410, "This invite has expired. Ask for a new one.");
    await db.$transaction(async (tx) => {
      // One join at a time per team, so two people can't both take the last seat.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"seats:" + invite.workspaceId}))`;
      if (!existing) {
        // This invite already holds one of the seats it is counted against.
        const seats = await staffUsage(invite.workspace, tx);
        if (seats.members >= seats.limit) throw new HttpError(402, "This team has no free staff logins. Ask the owner to add one.");
      }
      const res = await tx.invite.updateMany({ where: { id: invite.id, acceptedAt: null }, data: { acceptedAt: new Date(), acceptedById: userId } });
      if (res.count === 0) throw new HttpError(410, "This invite has already been used. Ask for a new one.");
      if (!existing) await tx.membership.create({ data: { userId, workspaceId: invite.workspaceId, role: invite.role } });
    });
  }
  if (!existing && again) throw new HttpError(410, "You were removed from this team. Ask for a new invite.");
  await db.user.update({ where: { id: userId }, data: { activeWorkspaceId: invite.workspaceId } });
  return Response.json({ workspaceId: invite.workspaceId, workspaceName: invite.workspace.name, fingerprint: invite.workspace.keyFingerprint, teamKeyWrap: invite.teamKeyWrap });
});
