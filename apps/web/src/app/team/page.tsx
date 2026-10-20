import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { Delegations, StaffReminderForm } from "@/components/TeamOverview";
import { PermChecks } from "@/components/StaffPerms";
import { db } from "@/lib/db";
import { duration, PERIODS, teamStats, type StaffStats } from "@/lib/monitoring";
import { accessOf, clientScopeWhere, permsOf } from "@/lib/permissions";
import { PLANS, TEAM_PLANS } from "@/lib/plans";
import { followTeamLink, requirePageUser } from "@/lib/session";
import { zoned } from "@/lib/dates";
import { FORMER_MEMBER } from "@/lib/team";

export const metadata: Metadata = { title: "Team" };

/**
 * Owners and admins: staff and who looks after which clients, reminders to
 * staff, and how the whole business is keeping up with clients. Staff get
 * their own page instead (StaffTeam), never anyone else's numbers. A business
 * of one has no team page unless it's on a team plan (the overview still
 * covers the owner's own clients): inviting staff is under Settings.
 */

/** A number cell: a labelled line on phones (the label comes from data-label), a plain cell from tablets up. */
const CELL = "flex justify-between gap-3 py-0.5 before:text-dim before:content-[attr(data-label)] md:table-cell md:px-4 md:py-2.5 md:before:content-none";
export default async function TeamOverviewPage({ searchParams }: { searchParams: Promise<{ days?: string; stale?: string; ws?: string }> }) {
  await followTeamLink((await searchParams).ws, "/team");
  const me = await requirePageUser("/team");
  const { user, workspace, role } = me;
  const dates = zoned(workspace.timezone);
  if (role === "MEMBER") return <StaffTeam me={me} />;
  const [teamSize, waiting] = await Promise.all([
    db.membership.count({ where: { workspaceId: workspace.id } }),
    db.invite.count({ where: { workspaceId: workspace.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  const alone = teamSize === 1 && !waiting;
  if (alone && !TEAM_PLANS.includes(workspace.plan)) redirect("/settings/team");
  const q = await searchParams;
  const days = PERIODS.find((p) => String(p) === q.days) ?? 30;
  const staleDays = Math.min(365, Math.max(1, Number.parseInt(q.stale ?? "", 10) || 14));

  const [members, clients, videos, notices, stats] = await Promise.all([
    db.membership.findMany({ where: { workspaceId: workspace.id }, include: { user: true }, orderBy: { id: "asc" } }),
    db.client.findMany({ where: { workspaceId: workspace.id, removedAt: null }, select: { id: true, name: true, assignedToId: true }, orderBy: { name: "asc" } }),
    db.video.findMany({ where: { workspaceId: workspace.id, replyToId: null, sourceId: null }, select: { id: true, title: true }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.staffNotice.findMany({ where: { workspaceId: workspace.id }, include: { from: { select: { name: true, email: true } }, to: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
    teamStats(workspace.id, { days, staleDays }),
  ]);
  const display = (u: { name: string | null; email: string }) => u.name ?? u.email.split("@")[0];
  const staff = members.map((m) => ({
    userId: m.userId, name: display(m.user), email: m.user.email, role: m.role, perms: permsOf(m),
    own: {
      replyEmails: m.replyNotify !== "OFF",
      ownDefaults: m.myReminderDefaults != null || m.myRemindClientDefault != null || m.myRemindTeamDefault != null,
      message: !!m.myReminderMessage,
      replyTo: m.myReminderReplyTo,
    },
  }));
  const nameOf = (id: string | null) => (id ? (staff.find((s) => s.userId === id)?.name ?? FORMER_MEMBER) : "Unassigned");
  const now = new Date();
  const rows: { id: string; r: StaffStats }[] = [
    ...stats.staff.map((r) => ({ id: r.userId!, r })),
    ...(stats.shared.staleClients || stats.shared.unanswered || stats.shared.overdueTodos ? [{ id: "shared", r: stats.shared }] : []),
    { id: "all", r: stats.overall },
  ];
  const q2 = (o: { days?: number; stale?: number }) => `/team?days=${o.days ?? days}&stale=${o.stale ?? staleDays}#monitoring`;

  return (
    <>
      <AppHeader email={user.email} plan={PLANS[workspace.plan].name} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Team</h1>
        <p className="mt-1 text-sm text-dim">
          Who looks after which clients, what each staff member can do, and how the business is keeping up. Only owners and admins see this page.{" "}
          <Link href="/settings/team" className="font-medium text-accent hover:underline">Invite or remove staff</Link>
          {" · "}
          <a href="#remind" className="font-medium text-accent hover:underline">Remind staff</a>
          {" · "}
          <Link href="/settings/account#emails" className="font-medium text-accent hover:underline">Emails to you</Link>
        </p>
        {alone && (
          <p className="mt-4 rounded-xl border border-primary-line bg-primary-soft p-3 text-sm text-ink" data-testid="team-alone">
            You&apos;re the only one on the team right now, so this covers your own clients. Your sent reminders stay below.{" "}
            <Link href="/settings/team" className="font-medium underline">Invite staff</Link>
          </p>
        )}

        <section id="monitoring" className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">How the team is doing</h2>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <nav aria-label="Period" className="flex gap-1 rounded-lg bg-surface-2 p-1">
                {PERIODS.map((p) => (
                  <Link key={p} href={q2({ days: p })} aria-current={p === days ? "page" : undefined}
                    className={`rounded-md px-3 py-1 ${p === days ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
                    {p} days
                  </Link>
                ))}
              </nav>
              <form action="/team" className="flex items-center gap-1.5">
                <input type="hidden" name="days" value={days} />
                <label className="text-muted" htmlFor="stale">No video in</label>
                <input id="stale" name="stale" type="number" min={1} max={365} defaultValue={staleDays} className="w-16 rounded-lg border border-line-strong px-2 py-1" />
                <span className="text-muted">days</span>
                <button className="rounded-lg border border-line-strong px-2 py-1 hover:bg-hover">Update</button>
              </form>
            </div>
          </div>
          {/* A table from tablets up; on phones each person is a small card with the column names beside the numbers. */}
          <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface md:overflow-x-auto">
            <table className="block w-full text-sm md:table md:min-w-[40rem]" data-testid="team-stats">
              <thead className="hidden text-left text-xs uppercase tracking-wide text-dim md:table-header-group">
                <tr>
                  <th className="px-4 py-3 font-medium">Staff</th>
                  <th className="px-4 py-3 font-medium">Videos sent</th>
                  <th className="px-4 py-3 font-medium">Clients with no video in {staleDays}d</th>
                  <th className="px-4 py-3 font-medium">Unanswered replies</th>
                  <th className="px-4 py-3 font-medium">Avg reply time</th>
                  <th className="px-4 py-3 font-medium">Overdue to-dos</th>
                </tr>
              </thead>
              <tbody className="block divide-y divide-line md:table-row-group">
                {rows.map(({ id, r }) => (
                  <tr key={id} data-testid={`stats-${id}`} className={`block px-4 py-3 md:table-row md:p-0 ${id === "all" ? "bg-canvas font-medium" : ""}`}>
                    <td className="block pb-1 font-medium text-ink md:table-cell md:px-4 md:py-2.5 md:font-normal">{r.name}</td>
                    <td className={CELL} data-label="Videos sent" data-col="sent">{id === "shared" ? "–" : r.videosSent}</td>
                    <td className={CELL} data-label={`Clients with no video in ${staleDays}d`} data-col="stale">{r.staleClients}</td>
                    <td className={CELL} data-label="Unanswered replies" data-col="unanswered">{r.unanswered}</td>
                    <td className={CELL} data-label="Avg reply time" data-col="avg">{r.avgReplyMs === null ? "–" : duration(r.avgReplyMs)}</td>
                    <td className={CELL} data-label="Overdue to-dos" data-col="overdue">{r.overdueTodos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-dim">
            Last {days} days. Videos sent counts videos sent to clients, by who recorded them (a former team member&apos;s count only towards the whole business). Reply time runs from a client&apos;s reply to the team&apos;s next reply in that conversation.
            Worked out from dates only; nothing encrypted is read.
          </p>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-5">
              <h3 className="font-semibold text-ink">Waiting for an answer</h3>
              {stats.unanswered.length === 0 ? (
                <p className="mt-2 text-sm text-dim">No client is waiting for a reply.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line text-sm" data-testid="unanswered">
                  {stats.unanswered.slice(0, 50).map((u) => (
                    <li key={u.videoId}>
                      <Link href={`/v/${u.videoId}`} className="flex flex-col gap-0.5 py-2 hover:text-accent sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <span className="min-w-0 sm:truncate"><span className="font-medium">{u.clientName}</span> · {u.title}</span>
                        <span className="text-xs text-dim sm:shrink-0">{nameOf(u.staffId)} · {duration(now.getTime() - u.since.getTime())}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-2xl border border-line bg-surface p-5">
              <h3 className="font-semibold text-ink">Overdue and quiet</h3>
              {stats.overdue.length === 0 && stats.stale.length === 0 ? (
                <p className="mt-2 text-sm text-dim">Nothing overdue, and every client had a video in the last {staleDays} days.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line text-sm" data-testid="overdue">
                  {stats.overdue.slice(0, 30).map((t) => (
                    <li key={t.itemId}>
                      <Link href={`/clients/${t.clientId}`} className="flex flex-col gap-0.5 py-2 hover:text-accent sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <span><span className="font-medium">{t.clientName}</span> · to-do overdue</span>
                        <span className="text-xs text-dim sm:shrink-0">{nameOf(t.staffId)} · due {dates.shortDay(t.dueAt)}</span>
                      </Link>
                    </li>
                  ))}
                  {stats.stale.slice(0, 30).map((s) => (
                    <li key={s.clientId}>
                      <Link href={`/clients/${s.clientId}`} className="flex flex-col gap-0.5 py-2 hover:text-accent sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <span><span className="font-medium">{s.clientName}</span> · {s.lastVideoAt ? `no video for ${duration(now.getTime() - s.lastVideoAt.getTime())}` : "no video yet"}</span>
                        <span className="text-xs text-dim sm:shrink-0">{nameOf(s.staffId)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section id="remind" className="mt-10 scroll-mt-6">
          <h2 className="text-lg font-semibold text-ink">Remind staff</h2>
          <div className="mt-3">
            <StaffReminderForm meId={user.id} staff={staff} clients={clients} videos={videos} />
          </div>
          {notices.length > 0 && (
            <div className="mt-4 rounded-2xl border border-line bg-surface p-5">
              <h3 className="font-semibold text-ink">Sent reminders</h3>
              <ul className="mt-2 divide-y divide-line text-sm" data-testid="notice-history">
                {notices.map((n) => (
                  <li key={n.id} className="py-2">
                    <p className="text-ink">{n.message}</p>
                    <p className="text-xs text-dim">
                      {display(n.from)} to {display(n.to)} · {dates.shortDayTime(n.createdAt)}
                      {n.linkLabel && ` · ${n.linkLabel}`} · {n.dismissedAt ? "Seen and dismissed" : "Not dismissed yet"}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-ink">Staff and clients</h2>
          <div className="mt-3">
            <Delegations meId={user.id} initialStaff={staff} initialClients={clients} />
          </div>
        </section>
      </main>
    </>
  );
}

/** A staff member's page: their business, who's on the team, what they can do and where their own settings are. */
async function StaffTeam({ me }: { me: Awaited<ReturnType<typeof requirePageUser>> }) {
  const { user, workspace, membership } = me;
  const [members, clients] = await Promise.all([
    db.membership.findMany({ where: { workspaceId: workspace.id }, include: { user: { select: { name: true, email: true } } }, orderBy: { id: "asc" } }),
    db.client.count({ where: { ...clientScopeWhere(accessOf(me)), removedAt: null } }),
  ]);
  const display = (u: { name: string | null; email: string }) => u.name ?? u.email.split("@")[0];
  const ROLE = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" } as const;
  return (
    <>
      <AppHeader email={user.email} plan={PLANS[workspace.plan].name} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6" data-testid="staff-team">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Your team</h1>
        <p className="mt-1 text-sm text-dim">You record, send and reply for {workspace.name}. The owner or an admin chooses who you look after and what else you can do.</p>

        <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-semibold text-ink">Your clients</h2>
          <p className="mt-1 text-sm text-muted">
            You look after {clients} {clients === 1 ? "client" : "clients"}.{" "}
            <Link href="/clients" className="font-medium text-accent hover:underline">Open Clients</Link>
          </p>
          <div className="mt-4">
            <PermChecks name={display(user)} email={user.email} perms={permsOf(membership)} self editable={false} />
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-semibold text-ink">Who&apos;s on the team</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-ink">{display(m.user)}{m.userId === user.id && " (you)"}</span>
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">{ROLE[m.role]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-dim">Need access to more clients, or something changed? Ask the owner or an admin.</p>
        </section>

        <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-semibold text-ink">Your own settings</h2>
          <ul className="mt-2 grid gap-1 text-sm">
            <li><Link href="/settings/account" className="font-medium text-accent hover:underline">Account</Link><span className="text-dim">: your name, emails to you, recovery key, keeping you signed in on this device, and your data</span></li>
            <li><Link href="/todos?tab=reminders" className="font-medium text-accent hover:underline">To-dos/Reminders</Link><span className="text-dim">: your reminder defaults and message for your clients</span></li>
          </ul>
        </section>
      </main>
    </>
  );
}
