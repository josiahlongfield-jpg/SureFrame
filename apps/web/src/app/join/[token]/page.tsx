import type { Metadata } from "next";
import Logo from "@/components/Logo";
import JoinTeam from "@/components/JoinTeam";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ACCOUNT_CLOSED_JOIN, hashToken, TEAM_CLOSED_JOIN, TEAM_UNAVAILABLE_JOIN } from "@/lib/team";
import { ACCOUNT_CLOSED_BY_SUPPORT, ACCOUNT_SUSPENDED, pendingDeletion } from "@/lib/session";
import { EMAIL_BLOCKED, isEmailBlocked } from "@/lib/blockedEmail";

export const metadata: Metadata = { title: "Join your team", robots: { index: false } };

/**
 * Where an invite link lands. Doesn't call currentUser(): someone who only
 * came to join a team shouldn't get a personal workspace made for them.
 */
export default async function Join({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [session, invite, closed] = await Promise.all([
    auth(),
    db.invite.findUnique({ where: { tokenHash: hashToken(token) }, include: { workspace: true, invitedBy: true } }),
    pendingDeletion(),
  ]);
  const userId = session?.user?.id;
  const me = userId ? await db.user.findUnique({ where: { id: userId }, select: { email: true, suspendedAt: true, closedAt: true } }) : null;
  // Support's actions on this login (lib/support/admin.ts): only support can help, not whoever sent the invite.
  const bySupport = me?.closedAt ? ACCOUNT_CLOSED_BY_SUPPORT : me?.suspendedAt ? ACCOUNT_SUSPENDED : me && (await isEmailBlocked(me.email)) ? EMAIL_BLOCKED : null;
  const problem = !invite || invite.revokedAt
    ? "This invite was cancelled or doesn't exist."
    : invite.workspace.suspendedAt || invite.workspace.closedAt
      ? TEAM_UNAVAILABLE_JOIN
    : invite.workspace.deleteAt
      ? TEAM_CLOSED_JOIN
      : bySupport
        ? bySupport
      : closed
        ? ACCOUNT_CLOSED_JOIN
        : invite.acceptedAt && invite.acceptedById !== userId
          ? "This invite has already been used."
          : !invite.acceptedAt && invite.expiresAt < new Date()
            ? "This invite has expired."
            : null;

  return (
    <main data-theme="navy" className="flex min-h-screen items-center justify-center navy-glow text-ink px-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <Logo tone="dark" />
        {problem || !invite ? (
          <>
            <h1 className="mt-6 text-xl font-semibold text-ink">{problem}</h1>
            {closed && problem === ACCOUNT_CLOSED_JOIN ? (
              <a href={closed.fresh ? "/account/restore" : "/login?next=/account/restore"} className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
                Keep my account
              </a>
            ) : bySupport && problem === bySupport ? null : (
              <p className="mt-2 text-sm text-muted">Ask whoever invited you to send a new link.</p>
            )}
          </>
        ) : (
          <>
            <h1 className="mt-6 text-xl font-semibold text-ink">Join {invite.workspace.name}</h1>
            <p className="mt-2 text-sm text-muted">
              {invite.invitedBy.name ?? invite.invitedBy.email} invited you to record and reply to clients on SureFrame
              {invite.role === "ADMIN" ? " as an admin" : ""}.
            </p>
            <JoinTeam token={token} signedIn={!!userId} />
          </>
        )}
      </div>
    </main>
  );
}
