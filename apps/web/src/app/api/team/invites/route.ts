import { z } from "zod";
import { db } from "@/lib/db";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";
import { appUrl } from "@/lib/stripe";
import { rateLimit } from "@/lib/rateLimit";
import { hashToken, INVITE_DAYS, newInviteToken, staffUsage } from "@/lib/team";
import { sendMail } from "@/lib/mail";
import { inviteEmail } from "@/lib/staffEmails";
import { brandOf } from "@/lib/branding";
import { isEmailBlocked } from "@/lib/blockedEmail";

const Body = z.object({
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  /**
   * The team key, wrapped on the inviter's device with a one-off key that
   * travels only in the invite link's #fragment. We never see either key.
   */
  teamKeyWrap: z.string().min(40).max(200),
});

/**
 * Invite someone to the team. Returns the link without its #fragment; the
 * inviter's browser appends the one-off key before showing it. An invite made
 * out to an email also tells that person to expect the link (never the link).
 */
export const POST = handle(async (req: Request) => {
  const me = await requireUser();
  requireRole(me, "OWNER", "ADMIN");
  const { user, workspace } = me;
  const body = Body.safeParse(await req.json());
  await rateLimit(`invite:${workspace.id}`, 30, 3600);
  if (!body.success) throw new HttpError(400, "Enter a valid email, or leave it blank");
  const seats = await staffUsage(workspace);
  if (seats.used >= seats.limit) {
    throw new HttpError(
      402,
      seats.limit === 1
        ? "Team logins come with Studio and Agency. Upgrade to invite staff."
        : `All ${seats.limit} staff logins are in use. The owner can add more on this page, or remove someone first.`,
    );
  }
  const token = newInviteToken();
  const invite = await db.invite.create({
    data: {
      ...body.data,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000),
      workspaceId: workspace.id,
      invitedById: user.id,
    },
  });
  let emailed = false;
  if (invite.email && !(await isEmailBlocked(invite.email))) {
    const brand = brandOf(workspace, appUrl(""));
    const mail = inviteEmail({ business: workspace.name, inviter: user.name ?? user.email, admin: invite.role === "ADMIN", logoUrl: brand.logoUrl, color: brand.color });
    emailed = await sendMail({ to: invite.email, ...mail, fromName: workspace.name }).then(
      () => true,
      (err) => (console.error("invite email failed", err), false),
    );
  }
  return Response.json({ invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt }, link: appUrl(`/join/${token}`), emailed }, { status: 201 });
});
