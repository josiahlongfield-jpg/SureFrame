import type { Metadata } from "next";
import AppHeader from "@/components/AppHeader";
import ClientsManager from "@/components/ClientsManager";
import { db } from "@/lib/db";
import { clientLink, seatUsage } from "@/lib/clients";
import { EXTRA_SEAT_PRICE, EXTRA_SEAT_PRICE_YEARLY, PLANS } from "@/lib/plans";
import { followTeamLink, requirePageUser } from "@/lib/session";
import { accessOf, clientScopeWhere, effectivePerms } from "@/lib/permissions";
import { CLIENT_KEEP_DAYS, restorableWhere } from "@/lib/clientRemoval";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ ws?: string; removed?: string }> }) {
  const { ws, removed } = await searchParams;
  await followTeamLink(ws, removed ? "/clients?removed=1" : "/clients");
  const me = await requirePageUser("/clients");
  const { user, workspace, role } = me;
  const access = accessOf(me);
  const perms = effectivePerms(access);
  const plan = PLANS[workspace.plan];
  const yearly = workspace.billingInterval === "year";
  const canManage = role !== "MEMBER";
  const [clients, seats, members, removedClients] = await Promise.all([
    db.client.findMany({
      where: { ...clientScopeWhere(access), removedAt: null },
      orderBy: { name: "asc" },
      include: { _count: { select: { videos: true } } },
    }),
    seatUsage(workspace),
    db.membership.findMany({ where: { workspaceId: workspace.id }, include: { user: true }, orderBy: { id: "asc" } }),
    // Owners and admins can restore removed clients until they're deleted.
    canManage
      ? db.client.findMany({ where: { workspaceId: workspace.id, ...restorableWhere() }, orderBy: { removedAt: "desc" }, select: { id: true, name: true, email: true, removedAt: true, purgeAt: true } })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <AppHeader email={user.email} plan={plan.name} />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Clients</h1>
        {!perms.seeAllClients && (
          <p className="mt-1 text-sm text-dim">You see the clients assigned to you. The owner or an admin can assign more.</p>
        )}
        <p className="mt-1 text-sm text-dim">
          Clients watch and reply to the videos you send them for free. They don&apos;t need an account, just their personal link.
        </p>
        {clients.some((c) => c.pausedAt) && (
          <p className="mt-4 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg" data-testid="paused-clients-note">
            Your plan covers {seats.limit} {seats.limit === 1 ? "client" : "clients"}, so the clients marked Paused can&apos;t open their videos or be sent new ones.
            Pausing doesn&apos;t delete anything, though recordings still expire on the usual schedule. Upgrade or add seats, or remove clients you no longer need, and they&apos;re restored straight away (longest-standing first).
            Please let them know about the change.
          </p>
        )}
        {clients.some((c) => c.linkDisabledAt) && (
          <p className="mt-4 rounded-xl border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg" data-testid="link-off-clients-note">
            SureFrame support has turned off the personal link of the clients marked Link off. They can&apos;t open their videos or be sent new ones, and they still use a client seat.
            Contact support@sureframe.app about it.
          </p>
        )}
        <ClientsManager
          workspaceId={workspace.id}
          fingerprint={workspace.keyFingerprint}
          initialClients={clients.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            link: clientLink(c.token),
            teamKeyWrap: c.teamKeyWrap,
            videoCount: c._count.videos,
            assignedToId: c.assignedToId,
            paused: !!c.pausedAt,
            linkOff: !!c.linkDisabledAt,
            reached: !!c.linkOpenedAt,
          }))}
          initialRemoved={removedClients.map((c) => ({ id: c.id, name: c.name, email: c.email, removedAt: c.removedAt!.toISOString(), purgeAt: c.purgeAt?.toISOString() ?? null }))}
          keepDays={CLIENT_KEEP_DAYS}
          openRemoved={!!removed}
          timezone={workspace.timezone}
          cloudBackup={workspace.cloudBackup}
          initialSeats={seats}
          includedSeats={plan.clientSeats}
          extraSeats={workspace.extraClientSeats}
          seatPrice={yearly ? EXTRA_SEAT_PRICE_YEARLY : EXTRA_SEAT_PRICE}
          per={yearly ? "year" : "month"}
          canBuySeats={workspace.plan !== "FREE" && !!workspace.stripeSubscriptionId}
          complimentary={workspace.plan !== "FREE" && !workspace.stripeSubscriptionId}
          isOwner={role === "OWNER"}
          canManage={canManage}
          canAdd={perms.addClients}
          seesAll={perms.seeAllClients}
          meId={user.id}
          staff={members.map((m) => ({ id: m.userId, name: m.user.name ?? m.user.email.split("@")[0] }))}
          studioHint={workspace.plan === "SOLO" && !yearly ? { soloBase: PLANS.SOLO.priceMonthly, studioPrice: PLANS.STUDIO.priceMonthly, studioClients: PLANS.STUDIO.clientSeats } : undefined}
        />
      </main>
    </>
  );
}
