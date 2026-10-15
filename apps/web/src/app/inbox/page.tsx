import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import ClientHeader from "@/components/ClientHeader";
import MadeWith from "@/components/MadeWith";
import AiNotice from "@/components/AiNotice";
import { aiAssistActive } from "@/lib/plans";
import { brandOf, brandStyle } from "@/lib/branding";
import ClientKeyCapture from "@/components/ClientKeyCapture";
import ClientPlanner from "@/components/ClientPlanner";
import { db } from "@/lib/db";
import { unsubscribeUrl } from "@/lib/reminders";
import { zoned } from "@/lib/dates";
import { REMOVED_COOKIE, usableClientWhere } from "@/lib/access";

export const metadata: Metadata = { title: "Your videos" };

/** A client's view: every video their coach (or coaches) sent them. */
export default async function Inbox({ searchParams }: { searchParams: Promise<{ invalid?: string; paused?: string; removed?: string; closed?: string; unavailable?: string; off?: string; c?: string }> }) {
  const { invalid, paused, removed, closed, unavailable, off, c: arrivedAs } = await searchParams;
  const jar = await cookies();
  const tokens = jar
    .getAll()
    .filter((c) => c.name.startsWith("fc_client_"))
    .map((c) => c.value);
  // Businesses that ended this person's access or closed their account: from an old link just opened here (it sets
  // no client cookie), or links this device already had.
  const justOpened = jar.get(REMOVED_COOKIE)?.value;
  const removedTokens = justOpened ? [...tokens, justOpened] : tokens;
  const now = new Date();
  // Support suspended or closed the business's workspace (never called that here), or turned this link off (lib/support/admin.ts).
  const live = { suspendedAt: null, closedAt: null } as const;
  const [removedBy, closedBy, unavailableBy, offBy] = removedTokens.length
    ? await Promise.all([
        db.client.findMany({ where: { token: { in: removedTokens }, removedAt: { not: null } }, select: { purgeAt: true, workspace: { select: { name: true, timezone: true } } } }),
        db.client.findMany({ where: { token: { in: removedTokens }, removedAt: null, workspace: { ...live, deleteAt: { not: null } } }, select: { workspace: { select: { name: true } } } }),
        db.client.findMany({ where: { token: { in: removedTokens }, removedAt: null, workspace: { OR: [{ suspendedAt: { not: null } }, { closedAt: { not: null } }] } }, select: { workspace: { select: { name: true } } } }),
        db.client.findMany({ where: { token: { in: removedTokens }, removedAt: null, linkDisabledAt: { not: null }, workspace: { ...live, deleteAt: null } }, select: { workspace: { select: { name: true } } } }),
      ])
    : [[], [], [], []];
  const ended = [...new Map(removedBy.map((r) => [r.workspace.name, r])).values()];
  const closedNames = [...new Set(closedBy.map((c) => c.workspace.name))];
  const unavailableNames = [...new Set(unavailableBy.map((c) => c.workspace.name))];
  const offNames = [...new Set(offBy.map((c) => c.workspace.name))];
  const [clients, pausedBy] = tokens.length
    ? await Promise.all([
        db.client.findMany({
          where: { token: { in: tokens }, ...usableClientWhere },
        include: {
          workspace: { select: { id: true, name: true, plan: true, brandColor: true, brandLogoType: true, brandVersion: true, aiAssist: true, timezone: true } },
          videos: { where: { replyToId: null, status: { not: "RECORDING" } }, orderBy: { createdAt: "desc" }, include: { owner: { select: { name: true } } } },
          },
        }),
        // Businesses that paused this person's access, so a bookmark doesn't just say "open your link".
        db.client.findMany({ where: { token: { in: tokens }, removedAt: null, pausedAt: { not: null }, linkDisabledAt: null, workspace: { ...live, deleteAt: null } }, select: { workspace: { select: { name: true } } } }),
      ])
    : [[], []];
  // Newest first by when each video reached the client, not when it was recorded.
  for (const c of clients) c.videos.sort((a, b) => +(b.sentAt ?? b.createdAt) - +(a.sentAt ?? a.createdAt));
  const pausedNames = [...new Set(pausedBy.map((p) => p.workspace.name))];

  // With one business, the whole page wears its branding.
  const brand = clients.length === 1 ? brandOf(clients[0].workspace) : null;

  return (
    <div data-theme="navy" className="min-h-screen bg-canvas text-ink" style={brandStyle(brand?.color ?? null)}>
      {arrivedAs && clients.some((c) => c.id === arrivedAs) && <ClientKeyCapture clientId={arrivedAs} />}
      <ClientHeader brand={brand} />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Your videos</h1>
        {invalid && (
          <p className="mt-4 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg">
            That link is no longer active. Ask the person who sent it for a new one.
          </p>
        )}
        {ended.map((r) => (
          <p key={r.workspace.name} className="mt-4 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg" data-testid="client-removed">
            {r.workspace.name} has ended your access to your videos from them. If that&rsquo;s a mistake, contact them.
            {r.purgeAt && r.purgeAt > now && (
              <> They can restore it until {zoned(r.workspace.timezone).longDay(r.purgeAt)}, after which your videos, messages and shared to-dos with them are deleted.</>
            )}
          </p>
        ))}
        {removed && ended.length === 0 && (
          <p className="mt-4 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg" data-testid="client-removed">
            The business that sent you this link has ended your access, so it no longer opens your videos. If that&rsquo;s a mistake, contact them.
          </p>
        )}
        {closedNames.map((name) => (
          <p key={name} className="mt-4 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg" data-testid="client-closed">
            {name} has closed their SureFrame account, so this link no longer opens your videos from them. If you need anything, contact them directly.
          </p>
        ))}
        {closed && closedNames.length === 0 && (
          <p className="mt-4 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg" data-testid="client-closed">
            The business that sent you this link has closed their SureFrame account, so it no longer opens your videos. If you need anything, contact them directly.
          </p>
        )}
        {unavailableNames.map((name) => (
          <p key={name} className="mt-4 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg" data-testid="client-unavailable">
            Videos from {name} are unavailable right now.
          </p>
        ))}
        {unavailable && unavailableNames.length === 0 && (
          <p className="mt-4 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg" data-testid="client-unavailable">
            Videos from the business that sent you this link are unavailable right now.
          </p>
        )}
        {offNames.map((name) => (
          <p key={name} className="mt-4 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg" data-testid="client-link-off">
            This link has been turned off, so it no longer opens your videos from {name}.
          </p>
        ))}
        {off && offNames.length === 0 && (
          <p className="mt-4 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg" data-testid="client-link-off">
            This link has been turned off.
          </p>
        )}
        {(paused || pausedNames.length > 0) && (
          <p className="mt-4 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg" data-testid="client-paused">
            Your access {pausedNames.length > 0 ? <>to videos from {pausedNames.join(", ")} </> : ""}is paused because{" "}
            {pausedNames.length > 1 ? "these businesses changed their" : "this business changed its"} SureFrame plan. The pause doesn&rsquo;t delete anything, but videos are only kept for a limited time, so please contact{" "}
            them soon to have it restored.
          </p>
        )}
        {clients.length === 0 ? (
          pausedNames.length > 0 || removed || ended.length > 0 || closed || closedNames.length > 0 || unavailable || unavailableNames.length > 0 || off || offNames.length > 0 ? null : 
          <p className="mt-6 text-muted">Open the personal link you were sent to see your videos here.</p>
        ) : (
          clients.map((c) => (
            <section key={c.id} className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-dim">From {c.workspace.name}</h2>
              {aiAssistActive(c.workspace) && <AiNotice className="mt-2" />}
              {c.videos.length === 0 ? (
                <p className="mt-3 text-sm text-dim">Nothing yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
                  {c.videos.map((v) => (
                    <li key={v.id}>
                      <Link href={`/v/${v.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-hover">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{v.title}</span>
                          {/* Who sent it, never their email: "Sam from Business". */}
                          {v.owner.name && <span className="block text-xs text-dim">{v.owner.name} from {c.workspace.name}</span>}
                        </span>
                        <span className="shrink-0 pl-3 text-sm text-dim">{zoned(c.workspace.timezone).day(v.sentAt ?? v.createdAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4">
                <ClientPlanner clientId={c.id} title="Your to-dos & notes" />
              </div>
              {c.email && (
                <p className="mt-2 text-xs text-dim">
                  Reminder and new-video emails to {c.email} are {c.remindersOff ? "off" : "on"}.{" "}
                  <a href={unsubscribeUrl(c.id)} className="font-medium text-accent hover:underline">
                    {c.remindersOff ? "Turn on" : "Turn off"}
                  </a>
                </p>
              )}
            </section>
          ))
        )}
      </main>
      <MadeWith />
    </div>
  );
}
