import type { Metadata } from "next";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import MemberPlanner from "@/components/MemberPlanner";
import ReminderSettingsSection from "@/components/ReminderSettingsSection";
import { db } from "@/lib/db";
import { dueTodos } from "@/lib/dueTodos";
import { accessOf } from "@/lib/permissions";
import { PLANS } from "@/lib/plans";
import { reminderDefaultsFor } from "@/lib/reminders";
import { requirePageUser } from "@/lib/session";

export const metadata: Metadata = { title: "To-dos/Reminders" };

/**
 * The menu's To-dos/Reminders: what's due (the team's own list here, and which clients have some due, since a
 * client's to-dos live on their page), and, on its own tab, when reminders go out and what they say.
 */
export default async function Todos({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const reminders = (await searchParams).tab === "reminders";
  const me = await requirePageUser(reminders ? "/todos?tab=reminders" : "/todos");
  const { user, workspace, role, membership } = me;
  const [due, teamSize] = await Promise.all([dueTodos(accessOf(me)), db.membership.count({ where: { workspaceId: workspace.id, pausedAt: null } })]);
  const tab = (active: boolean) => `rounded-t-lg px-3 py-2 ${active ? "border-b-2 border-primary font-medium text-ink" : "text-dim hover:text-ink"}`;
  return (
    <>
      <AppHeader email={user.email} plan={PLANS[workspace.plan].name} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">To-dos/Reminders</h1>
        <nav aria-label="To-dos or reminder settings" className="mt-4 flex gap-1 border-b border-line text-sm">
          <Link href="/todos" aria-current={!reminders ? "page" : undefined} className={tab(!reminders)} data-testid="tab-todos">
            To-dos{due.total ? ` (${due.total} due)` : ""}
          </Link>
          <Link href="/todos?tab=reminders" aria-current={reminders ? "page" : undefined} className={tab(reminders)} data-testid="tab-reminders">
            Reminder settings
          </Link>
        </nav>
        {reminders ? (
          <div className="mt-6">
            <ReminderSettingsSection workspace={workspace} role={role} membership={membership} />
          </div>
        ) : (
          <div className="mt-6 max-w-2xl">
            {due.total > 0 && (
              // A client's to-dos live on their page, so name the clients with some due.
              <div className="mb-4 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg" data-testid="due-todos">
                <p className="font-medium">
                  {due.total} {due.total === 1 ? "to-do is" : "to-dos are"} overdue or due within a day
                </p>
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {due.general > 0 && <li>Your list below ({due.general})</li>}
                  {due.clients.map((c) => (
                    <li key={c.id}>
                      <Link href={`/clients/${c.id}`} className="font-medium underline">{c.name}</Link> ({c.count})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mb-4 text-sm text-dim">
              To-dos about one client go on that client&apos;s page, where you can share them with the client. <Link href="/clients" className="font-medium text-accent hover:underline">Open Clients</Link>
            </p>
            {/* Items not about a client are one list for the whole team; say so when there is a team. */}
            <MemberPlanner
              workspaceId={workspace.id}
              fingerprint={workspace.keyFingerprint}
              defaults={{ ...reminderDefaultsFor(workspace, membership), remindTeam: true }}
              title="To-dos & notes"
              {...(teamSize > 1
                ? { note: "Not about one client. Everyone on your team can see and change these.", teamWho: { label: "Email the team", tag: "the team" } }
                : { note: "Not about one client. Only you see these for now; anyone you add to your team later will too." })}
            />
          </div>
        )}
      </main>
    </>
  );
}
