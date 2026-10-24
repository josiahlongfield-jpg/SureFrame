import type { Metadata } from "next";
import AppHeader from "@/components/AppHeader";
import ClientsManager from "@/components/ClientsManager";
import { db } from "@/lib/db";
import { clientLink, seatUsage } from "@/lib/clients";
import { EXTRA_SEAT_PRICE, EXTRA_SEAT_PRICE_YEARLY, PLANS } from "@/lib/plans";
import { followTeamLink, requirePageUser } from "@/lib/session";
import { accessOf, clientScopeWhere, effectivePerms } from "@/lib/permissions";
import { clientConvs } from "@/lib/clientReplies";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ ws?: string; seats?: string }> }) {
  const { ws, seats: seatsParam } = await searchParams;
  await followTeamLink(ws, "/clients");
  const me = await requirePageUser("/clients");
  const { user, workspace, role } = me;
  const access = accessOf(me);
  const perms = effectivePerms(access);
  const plan = PLANS[workspace.plan];
  const yearly = workspace.billingInterval === "year";
  const canManage = role !== "MEMBER";
  const [clients, seats, members] = await Promise.all([
    db.client.findMany({
      where: { ...clientScopeWhere(access), removedAt: null },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { videos: true } },
        // A key reset in the last 30 days gave them a new link (lib/rekey.ts): said on their row.
        replacedLinks: { where: { createdAt: { gt: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, emailed: true } },
      },
    }),
    seatUsage(workspace),
    db.membership.findMany({ where: { workspaceId: workspace.id }, include: { user: true }, orderBy: { id: "asc" } }),
  ]);
  const convs = await clientConvs(clients.map((c) => c.id));

  return (
    <>
      <AppHeader email={user.email} plan={plan.name} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Clients</h1>
        {!perms.seeAllClients && (
          <p className="mt-1 text-sm text-dim">You see the clients assigned to you. The owner or an admin can assign more.</p>
        )}
        <p className="mt-1 text-sm text-dim">
          Clients watch and reply to the videos you send them for free. They don&apos;t need an account, just the link to your video.
        </p>
        <p className="mt-1 text-sm text-dim" data-testid="links-explained">
          Each client has one personal link (Copy link) that opens every video you send them, and the link to a single video from its Send box holds the same key: whichever
          they open first sets up their phone or computer, and after that every video opens there.
        </p>
        <p className="mt-1 text-sm text-dim" data-testid="client-page-hint">
          Open a client by their name to send their link from your email or with a message, see their videos, and keep to-dos and notes
          {plan.staffSeats > 1 ? ", and to choose who on your team looks after them" : ". On Studio and Agency you can also choose who on your team looks after each client"}.
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
          business={workspace.name}
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
            linkSent: !!c.linkSentAt,
            convs: convs.get(c.id) ?? [],
            replaced: c.replacedLinks[0] ? { at: c.replacedLinks[0].createdAt.toISOString(), emailed: c.replacedLinks[0].emailed } : null,
          }))}
          timezone={workspace.timezone}
          seatsAdded={Math.max(0, Math.min(1000, Number(seatsParam) || 0)) || undefined}
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
