import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import CopyClientLink from "@/components/CopyClientLink";
import MemberPlanner from "@/components/MemberPlanner";
import { db } from "@/lib/db";
import { clientLink } from "@/lib/clients";
import { PLANS } from "@/lib/plans";
import { followTeamLink, requirePageUser } from "@/lib/session";
import { reminderDefaultsFor } from "@/lib/reminders";
import ClientEmail from "@/components/ClientEmail";
import { accessOf, canSeeClient } from "@/lib/permissions";
import { zoned } from "@/lib/dates";
import { activeMember } from "@/lib/team";

export const metadata: Metadata = { title: "Client" };

/** One client's space: what was sent to them, plus their to-dos and notes. */
export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ws?: string }> }) {
  const { id } = await params;
  await followTeamLink((await searchParams).ws, `/clients/${id}`);
  const me = await requirePageUser(`/clients/${id}`);
  const { user, workspace } = me;
  const client = await db.client.findUnique({
    where: { id },
    include: { videos: { where: { replyToId: null }, orderBy: { createdAt: "desc" } } },
  });
  // Staff only open the clients they can see (lib/permissions.ts); others look like they don't exist.
  if (!client || client.removedAt || !canSeeClient(accessOf(me), client)) notFound();
  // Team reminders for a client's to-do go to whoever looks after the client (lib/reminders.ts).
  const team = await db.membership.findMany({ where: { workspaceId: workspace.id, ...activeMember }, include: { user: { select: { name: true, email: true } } } });
  const assigned = client.assignedToId ? team.find((m) => m.userId === client.assignedToId) : undefined;
  const assignedName = assigned ? (assigned.user.name ?? assigned.user.email.split("@")[0]) : null;
  const teamWho =
    team.length <= 1 || assigned?.userId === user.id ? undefined
    : assignedName ? { label: `Email ${assignedName}`, tag: assignedName }
    : { label: "Email the team", tag: "the team" };

  return (
    <>
      <AppHeader email={user.email} plan={PLANS[workspace.plan].name} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <Link href="/clients" className="text-sm text-dim hover:text-ink">← Clients</Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{client.name}</h1>
            <ClientEmail clientId={client.id} firstName={client.name.split(" ")[0]} initial={client.email} optedOut={client.remindersOff} />
          </div>
          {!client.linkDisabledAt && (
            <CopyClientLink workspaceId={workspace.id} fingerprint={workspace.keyFingerprint} clientId={client.id} link={clientLink(client.token)} teamKeyWrap={client.teamKeyWrap} />
          )}
        </div>
        {client.linkDisabledAt && (
          <p className="mt-4 rounded-xl border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg" data-testid="client-link-off-banner">
            SureFrame support has turned off {client.name}&apos;s personal link. They can&apos;t open their videos or be sent new ones until it&apos;s turned back on, and they
            still use a client seat. Contact support@sureframe.app about it.
          </p>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-semibold text-ink">Videos</h2>
            {client.videos.length === 0 ? (
              <p className="mt-3 text-sm text-dim">
                Nothing sent yet. Record a video, then choose {client.name.split(" ")[0]} under &ldquo;Send to&rdquo;.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {client.videos.map((v) => (
                  <li key={v.id}>
                    <Link href={`/v/${v.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-accent">
                      <span className="truncate font-medium">{v.title}</span>
                      <span className="shrink-0 text-xs text-dim">
                        {v.status === "EXPIRED" ? "Server copy expired · " : ""}
                        {zoned(workspace.timezone).day(v.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <MemberPlanner
            workspaceId={workspace.id}
            fingerprint={workspace.keyFingerprint}
            clientId={client.id}
            clientName={client.name}
            clientTeamKeyWrap={client.teamKeyWrap}
            client={{ email: client.email, remindersOff: client.remindersOff }}
            defaults={reminderDefaultsFor(workspace, me.membership)}
            title="To-dos & notes"
            teamWho={teamWho}
          />
        </div>
      </main>
    </>
  );
}
