import type { Metadata } from "next";
import Link from "next/link";
import { isEmailBlocked } from "@/lib/blockedEmail";
import { db } from "@/lib/db";
import PowerForm from "../_console/PowerForm";
import { Badge, ConsoleNav, consoleAdmin, Done, planName, Section } from "../_console/ui";

export const metadata: Metadata = { title: "Look up an account", robots: { index: false } };

const insensitive = (q: string) => ({ contains: q, mode: "insensitive" as const });

/**
 * Support admins: find a login, workspace or client by email, workspace or
 * client name, video id, account id or Stripe id, then open its page for the
 * support powers.
 */
export default async function Lookup({ searchParams }: { searchParams: Promise<{ q?: string; done?: string }> }) {
  const { q: raw = "", done } = await searchParams;
  await consoleAdmin(`/support/lookup${raw ? `?q=${encodeURIComponent(raw)}` : ""}`);
  const q = raw.trim().slice(0, 200);
  const searching = q.length >= 2;
  const [users, workspaces, clients, video] = searching
    ? await Promise.all([
        db.user.findMany({
          where: { OR: [{ email: insensitive(q) }, { name: insensitive(q) }, { id: q }] },
          take: 20,
          orderBy: { createdAt: "desc" },
          select: { id: true, email: true, name: true, suspendedAt: true, closedAt: true, deleteAt: true },
        }),
        db.workspace.findMany({
          where: { OR: [{ name: insensitive(q) }, { id: q }, { stripeCustomerId: q }, { stripeSubscriptionId: q }] },
          take: 20,
          orderBy: { createdAt: "desc" },
          include: { members: { where: { role: "OWNER" }, include: { user: { select: { email: true } } } } },
        }),
        db.client.findMany({
          where: { OR: [{ email: insensitive(q) }, { name: insensitive(q) }, { id: q }] },
          take: 20,
          orderBy: { createdAt: "desc" },
          include: { workspace: { select: { id: true, name: true } } },
        }),
        db.video.findUnique({ where: { id: q }, select: { id: true, workspaceId: true, clientId: true, status: true, workspace: { select: { name: true } } } }),
      ])
    : [[], [], [], null];
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q);
  const email = q.toLowerCase();
  const blocked = isEmail && (await isEmailBlocked(email));
  const hasLogin = users.some((u) => u.email === email);
  const nothing = searching && !users.length && !workspaces.length && !clients.length && !video;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <ConsoleNav />
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Look up an account</h1>
      <Done id={done} />
      <form method="get" className="mt-6 flex flex-col gap-2 sm:flex-row">
        <input
          name="q"
          defaultValue={raw}
          type="search"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Email, client email, workspace name or video id"
          aria-label="Search"
          className="min-w-0 flex-1 rounded-xl border border-line-strong px-3 py-2 text-sm"
        />
        <button className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">Search</button>
      </form>
      <p className="mt-2 text-xs text-dim">Also finds account, workspace and client ids, and Stripe customer and subscription ids.</p>
      {raw && !searching && <p className="mt-6 text-sm text-muted">Type at least 2 characters.</p>}
      {nothing && (
        <p className="mt-6 text-sm text-muted" data-testid="no-results">
          Nothing matches &ldquo;{q}&rdquo;.
        </p>
      )}

      {users.length > 0 && (
        <Section title="Logins">
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface" data-testid="results-users">
            {users.map((u) => (
              <li key={u.id}>
                <Link href={`/support/users/${u.id}`} className="block p-4 hover:bg-hover">
                  <p className="break-all font-medium text-ink">{u.email}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                    {u.name && <span className="break-words">{u.name}</span>}
                    {u.closedAt ? <Badge tone="red">Closed by support</Badge> : u.suspendedAt && <Badge tone="red">Login suspended</Badge>}
                    {u.deleteAt && <Badge tone="amber">Deletion {u.deleteAt.toISOString().slice(0, 10)}</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {workspaces.length > 0 && (
        <Section title="Workspaces">
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface" data-testid="results-workspaces">
            {workspaces.map((w) => (
              <li key={w.id}>
                <Link href={`/support/workspaces/${w.id}`} className="block p-4 hover:bg-hover">
                  <p className="break-words font-medium text-ink">{w.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <span className="break-all">{w.members[0]?.user.email ?? "No owner"}</span>
                    <Badge>{planName(w.plan)}</Badge>
                    {w.closedAt ? <Badge tone="red">Closed</Badge> : w.suspendedAt && <Badge tone="red">Suspended</Badge>}
                    {w.legalHoldAt && <Badge tone="purple">Legal hold</Badge>}
                    {w.deleteAt && <Badge tone="amber">Deletion {w.deleteAt.toISOString().slice(0, 10)}</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {clients.length > 0 && (
        <Section title="Clients">
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface" data-testid="results-clients">
            {clients.map((c) => (
              <li key={c.id}>
                <Link href={`/support/workspaces/${c.workspace.id}#client-${c.id}`} className="block p-4 hover:bg-hover">
                  <p className="break-words font-medium text-ink">
                    {c.name} {c.email && <span className="break-all font-normal text-muted">&lt;{c.email}&gt;</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <span className="break-words">Client of {c.workspace.name}</span>
                    {c.removedAt && <Badge tone="amber">Removed</Badge>}
                    {c.linkDisabledAt && <Badge tone="red">Link off</Badge>}
                    {c.pausedAt && !c.removedAt && <Badge>Paused</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {video && (
        <Section title="Video">
          <Link
            href={`/support/workspaces/${video.workspaceId}`}
            className="block rounded-2xl border border-line bg-surface p-4 text-sm hover:bg-hover"
            data-testid="results-video"
          >
            <p className="break-all font-medium text-ink">{video.id}</p>
            <p className="mt-1 text-muted">
              In {video.workspace.name} · {video.status.toLowerCase()}
              {video.clientId ? " · sent to a client" : ""}
            </p>
          </Link>
        </Section>
      )}

      {isEmail && (
        <Section title="Email address">
          <div className="grid gap-3">
            <p className="text-sm text-muted" data-testid="blocked-state">
              {blocked ? (
                <>
                  <Badge tone="red">Blocked</Badge> <span className="break-all">{email}</span> can&rsquo;t sign in or sign up.
                </>
              ) : (
                <>
                  <span className="break-all">{email}</span> isn&rsquo;t blocked.
                </>
              )}
            </p>
            {blocked ? (
              <PowerForm
                power="unblockEmail"
                hidden={{ email }}
                title="Unblock this address"
                intro="It can sign in and sign up again."
                notify={`Email ${email} that it can be used again`}
                submit="Unblock"
              />
            ) : (
              <PowerForm
                power="blockEmail"
                hidden={{ email }}
                title="Block this address"
                intro={
                  hasLogin
                    ? "It can't sign in or sign up by any method until unblocked; a login already signed in stays signed in until you use Sign out everywhere on its page. Only a hash of the address is stored. Refused while a plan it owns still renews."
                    : "It can't sign up by any method until unblocked. Only a hash of the address is stored. Nobody is emailed: no login uses it."
                }
                category={hasLogin}
                notify={hasLogin ? `Email ${email} that the address is blocked, and why` : undefined}
                submit="Block"
                danger
              />
            )}
          </div>
        </Section>
      )}
    </main>
  );
}
