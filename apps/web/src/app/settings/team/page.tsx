import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import TeamManager from "@/components/TeamManager";
import { db } from "@/lib/db";
import { EXTRA_STAFF_PRICE, EXTRA_STAFF_PRICE_YEARLY, PLANS, TEAM_PLANS } from "@/lib/plans";
import { followTeamLink, requirePageUser } from "@/lib/session";
import { staffUsage, switchableBusinesses } from "@/lib/team";
import { DEFAULT_STAFF_PERMS, permsOf } from "@/lib/permissions";

export const metadata: Metadata = { title: "Team and staff" };

export default async function TeamSettings({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  await followTeamLink((await searchParams).ws, "/settings/team");
  const { user, workspace, role } = await requirePageUser("/settings/team");
  const plan = PLANS[workspace.plan];
  const [members, invites, mine, seats] = await Promise.all([
    db.membership.findMany({ where: { workspaceId: workspace.id }, include: { user: true }, orderBy: { id: "asc" } }),
    role === "MEMBER"
      ? []
      : db.invite.findMany({ where: { workspaceId: workspace.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "asc" } }),
    db.membership.findMany({ where: { userId: user.id }, include: { workspace: true }, orderBy: { id: "asc" } }).then((list) => switchableBusinesses(list, workspace.id)),
    staffUsage(workspace),
  ]);
  const isTeamPlan = TEAM_PLANS.includes(workspace.plan);
  // Staff have their own Team page; this one only switches between the businesses they're on.
  if (role === "MEMBER" && mine.length < 2) redirect("/team");
  const teamName = isTeamPlan || members.length > 1 ? "Team and staff" : "Invite staff";

  return (
    <>
      <AppHeader email={user.email} plan={plan.name} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{role === "MEMBER" ? "Your businesses" : teamName}</h1>
        <p className="mt-1 text-sm text-dim">
          {role === "MEMBER" ? (
            <>
              You&apos;re on the team of more than one business.{" "}
              <Link href="/team" className="font-medium text-accent hover:underline">Your team</Link> shows who you look after in {workspace.name} and what you can do there.
              {!user.memberships.some((m) => m.role === "OWNER") && (
                <>
                  {" "}Want a business of your own?{" "}
                  <Link href="/start" className="font-medium text-accent hover:underline" data-testid="switch-start-own">Start your own business</Link> on a paid plan.
                </>
              )}
            </>
          ) : (
            "You choose who looks after each client. Members see only the clients assigned to them, unless you let them see all clients. Clients see the name of the person who sent their video, never their email."
          )}
        </p>
        {role !== "MEMBER" && (members.length > 1 || isTeamPlan) && (
          <p className="mt-2 text-sm">
            <Link href="/team" className="font-medium text-accent hover:underline">Open the Team page</Link>
            <span className="text-dim"> to reassign clients in bulk, remind staff and see how everyone is keeping up.</span>
          </p>
        )}
        {!isTeamPlan && role === "OWNER" && (
          <div className="mt-6 rounded-2xl border border-primary-line bg-primary-soft p-5 text-sm text-ink">
            <p className="font-medium">Working with others?</p>
            <p className="mt-1">
              Studio includes 3 staff logins and Agency includes 10 (yours counts as one), with more at US${EXTRA_STAFF_PRICE}/month each. Everyone records, replies and keeps track of their own clients.
            </p>
            <Link href="/pricing" className="mt-3 inline-block font-medium underline">See plans</Link>
          </div>
        )}
        {members.some((m) => m.pausedAt) && (
          <p className="mt-6 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg" data-testid="paused-staff-note">
            Your plan covers {seats.limit} staff {seats.limit === 1 ? "login" : "logins"}, so the people marked Paused can&apos;t sign in to your team. Nothing has been
            deleted. Upgrade or add staff logins, or remove people you no longer need, and they&apos;re restored straight away. Please let them know about the change.
          </p>
        )}
        <TeamManager
          workspaceId={workspace.id}
          fingerprint={workspace.keyFingerprint}
          role={role}
          meId={user.id}
          initialSeats={seats}
          includedStaff={plan.staffSeats}
          extraStaff={workspace.extraStaffSeats}
          canBuyStaff={isTeamPlan && role === "OWNER" && !!workspace.stripeSubscriptionId}
          staffPrice={workspace.billingInterval === "year" ? EXTRA_STAFF_PRICE_YEARLY : EXTRA_STAFF_PRICE}
          per={workspace.billingInterval === "year" ? "year" : "month"}
          initialMembers={members.map((m) => ({ userId: m.userId, name: m.user.name ?? m.user.email.split("@")[0], email: m.user.email, role: m.role, perms: permsOf(m), paused: !!m.pausedAt }))}
          initialInvites={invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }))}
          keyResetNeeded={role === "MEMBER" ? null : workspace.keyResetNeeded}
          teamPlan={isTeamPlan}
          workspaces={mine.map((m) => ({ id: m.workspaceId, name: m.workspace.name, active: m.workspaceId === workspace.id }))}
          timezone={workspace.timezone}
          business={workspace.name}
          defaultPerms={DEFAULT_STAFF_PERMS}
        />
      </main>
    </>
  );
}
