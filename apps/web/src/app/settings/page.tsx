import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { db } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { requirePageUser } from "@/lib/session";
import { settingsPages } from "@/lib/settingsMenu";

export const metadata: Metadata = { title: "Settings" };

/** /settings itself: the settings pages this person can use, each with a line on what it's for. */
export default async function Settings() {
  const me = await requirePageUser("/settings", { allowPaused: true, allowTermsPending: true });
  // Paused staff, and anyone yet to agree to the current terms, can only use their Account page.
  if (me.paused || !me.agreed) redirect("/settings/account");
  const manager = me.role !== "MEMBER";
  const teamSize = manager ? await db.membership.count({ where: { workspaceId: me.workspace.id } }) : 1;
  const pages = settingsPages({ manager, teamSize, plan: me.workspace.plan, workspaces: me.user.memberships.length });
  return (
    <>
      <AppHeader email={me.user.email} plan={PLANS[me.workspace.plan].name} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Settings</h1>
        <ul className="mt-6 grid gap-3" data-testid="settings-index">
          {pages.map((p) => (
            <li key={p.href}>
              <Link href={p.href} className="block rounded-2xl border border-line bg-surface p-5 hover:bg-hover">
                <span className="font-semibold text-ink">{p.label}</span>
                <span className="mt-1 block text-sm text-muted">{p.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
