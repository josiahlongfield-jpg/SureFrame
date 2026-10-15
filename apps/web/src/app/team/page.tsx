import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { Delegations, NotifyPrefs, StaffReminderForm } from "@/components/TeamOverview";
import { db } from "@/lib/db";
import { duration, PERIODS, teamStats, type StaffStats } from "@/lib/monitoring";
import { permsOf } from "@/lib/permissions";
import { PLANS } from "@/lib/plans";
import { followTeamLink, requirePageUser } from "@/lib/session";
import { zoned } from "@/lib/dates";

export const metadata: Metadata = { title: "Team overview" };

/**
 * Owners and admins: staff and who looks after which clients, team emails,
 * reminders to staff, and how the whole business is keeping up with clients.
 * Staff never see this page or anyone else's numbers.
 */
export default async function TeamOverviewPage({ searchParams }: { searchParams: Promise<{ days?: string; stale?: string; ws?: string }> }) {
  await followTeamLink((await searchParams).ws, "/team");
  const { user, workspace, role, membership } = await requirePageUser("/team");
  const dates = zoned(workspace.timezone);
  if (role === "MEMBER") notFound();
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
  const nameOf = (id: string | null) => (id ? (staff.find((s) => s.userId === id)?.name ?? "Former staff") : "Unassigned");
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
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Team overview</h1>
        <p className="mt-1 text-sm text-dim">
          Who looks after which clients, what each staff member can do, and how the business is keeping up. Only owners and admins see this page.{" "}
          <Link href="/settings/team" className="font-medium text-accent hover:underline">Invite or remove staff</Link>
        </p>

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
          <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[40rem] text-sm" data-testid="team-stats">
              <thead className="text-left text-xs uppercase tracking-wide text-dim">
                <tr>
                  <th className="px-4 py-3 font-medium">Staff</th>
                  <th className="px-4 py-3 font-medium">Videos sent</th>
                  <th className="px-4 py-3 font-medium">Clients with no video in {staleDays}d</th>
                  <th className="px-4 py-3 font-medium">Unanswered replies</th>
                  <th className="px-4 py-3 font-medium">Avg reply time</th>
                  <th className="px-4 py-3 font-medium">Overdue to-dos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ id, r }) => (
                  <tr key={id} data-testid={`stats-${id}`} className={id === "all" ? "bg-canvas font-medium" : ""}>
                    <td className="px-4 py-2.5 text-ink">{r.name}</td>
                    <td className="px-4 py-2.5" data-col="sent">{id === "shared" ? "–" : r.videosSent}</td>
                    <td className="px-4 py-2.5" data-col="stale">{r.staleClients}</td>
                    <td className="px-4 py-2.5" data-col="unanswered">{r.unanswered}</td>
                    <td className="px-4 py-2.5" data-col="avg">{r.avgReplyMs === null ? "–" : duration(r.avgReplyMs)}</td>
                    <td className="px-4 py-2.5" data-col="overdue">{r.overdueTodos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-dim">
            Last {days} days. Videos sent counts videos sent to clients, by who recorded them. Reply time runs from a client&apos;s reply to the team&apos;s next reply in that conversation.
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
                      <Link href={`/v/${u.videoId}`} className="flex items-center justify-between gap-3 py-2 hover:text-accent">
                        <span className="min-w-0 truncate"><span className="font-medium">{u.clientName}</span> · {u.title}</span>
                        <span className="shrink-0 text-xs text-dim">{nameOf(u.staffId)} · {duration(now.getTime() - u.since.getTime())}</span>
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
                      <Link href={`/clients/${t.clientId}`} className="flex items-center justify-between gap-3 py-2 hover:text-accent">
                        <span><span className="font-medium">{t.clientName}</span> · to-do overdue</span>
                        <span className="shrink-0 text-xs text-dim">{nameOf(t.staffId)} · due {dates.shortDay(t.dueAt)}</span>
                      </Link>
                    </li>
                  ))}
                  {stats.stale.slice(0, 30).map((s) => (
                    <li key={s.clientId}>
                      <Link href={`/clients/${s.clientId}`} className="flex items-center justify-between gap-3 py-2 hover:text-accent">
                        <span><span className="font-medium">{s.clientName}</span> · {s.lastVideoAt ? `no video for ${duration(now.getTime() - s.lastVideoAt.getTime())}` : "no video yet"}</span>
                        <span className="shrink-0 text-xs text-dim">{nameOf(s.staffId)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-ink">Staff and clients</h2>
          <div className="mt-3">
            <Delegations meId={user.id} initialStaff={staff} initialClients={clients} />
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-ink">Emails to you</h2>
          <div className="mt-3">
            <NotifyPrefs
              meId={user.id}
              staff={staff}
              initial={{ replyNotify: membership.replyNotify, replyNotifyStaff: membership.replyNotifyStaff, sentNotify: membership.sentNotify, sentNotifyStaff: membership.sentNotifyStaff }}
            />
          </div>
        </section>

        <section className="mt-10">
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
      </main>
    </>
  );
}
