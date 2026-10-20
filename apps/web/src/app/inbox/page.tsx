import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import ClientHeader from "@/components/ClientHeader";
import RecoverUploads from "@/components/RecoverUploads";
import MadeWith from "@/components/MadeWith";
import AiNotice from "@/components/AiNotice";
import { aiAssistActive } from "@/lib/plans";
import { brandOf, brandStyle } from "@/lib/branding";
import ClientKeyCapture, { HideKeyFromAddress } from "@/components/ClientKeyCapture";
import ClientPlanner from "@/components/ClientPlanner";
import CantOpen from "@/components/CantOpen";
import ForgetDevice from "@/components/ForgetDevice";
import { AskForLink, ClientKeyGate } from "@/components/LostKey";
import { db } from "@/lib/db";
import { unsubscribeUrl } from "@/lib/reminders";
import { zoned } from "@/lib/dates";
import { clientCookie, REMOVED_COOKIE, usableClientWhere } from "@/lib/access";
import { visibleReplies } from "@/lib/replies";
import { askForLink } from "@/lib/askForLink";
import { replacedLinks } from "@/lib/replacedLinks";
import { keyHeldCookie } from "@/lib/e2e/keyHeld";
import { helpForDevice } from "@/lib/support/clientHelp";
import { senderName } from "@/lib/team";

/** "jo@example.com" as "j•••@example.com": enough to recognise, without showing the whole address on screen. */
const masked = (email: string) => email.replace(/^(.)[^@]*/, "$1•••");

/** The client on this device for a business, by their cookie (never trusts an id from the page alone). */
async function clientOnDevice(clientId: string) {
  const tokens = (await cookies()).getAll().filter((c) => c.name.startsWith("fc_client_")).map((c) => c.value);
  return tokens.length ? db.client.findFirst({ where: { id: clientId, token: { in: tokens } } }) : null;
}

export const metadata: Metadata = { title: "Your videos" };

/** A client's view: every video their coach (or coaches) sent them. */
export default async function Inbox({
  searchParams,
}: {
  searchParams: Promise<{ invalid?: string; paused?: string; removed?: string; closed?: string; unavailable?: string; off?: string; replaced?: string; c?: string }>;
}) {
  const { invalid, paused, removed, closed, unavailable, off, replaced, c: arrivedAs } = await searchParams;
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
          videos: {
            where: { replyToId: null, status: { not: "RECORDING" } },
            orderBy: { createdAt: "desc" },
            // Whether they've replied (a reply not from the team) and whether they've opened it (only their opens are counted).
            include: { owner: { select: { name: true } }, _count: { select: { replies: { where: { ...visibleReplies, authorUserId: null } } } } },
          },
          },
        }),
        // Businesses that paused this person's access, so a bookmark doesn't just say "open your link".
        db.client.findMany({ where: { token: { in: tokens }, removedAt: null, pausedAt: { not: null }, linkDisabledAt: null, workspace: { ...live, deleteAt: null } }, select: { workspace: { select: { name: true } } } }),
      ])
    : [[], []];
  // Newest first by when each video reached the client, not when it was recorded.
  for (const c of clients) c.videos.sort((a, b) => +(b.sentAt ?? b.createdAt) - +(a.sentAt ?? a.createdAt));
  const pausedNames = [...new Set(pausedBy.map((p) => p.workspace.name))];
  // A client with a key is only listed on a device that holds it (lib/e2e/keyHeld.ts): one that only opened an
  // email link sees how to get the key here instead. Clients from before encryption have no key to hold.
  const keyless = clients.filter((c) => c.teamKeyWrap && !jar.get(keyHeldCookie(c.id))?.value);
  const listed = clients.filter((c) => !keyless.includes(c));
  // Links a key reset replaced (lib/replacedLinks.ts): this device's old one, or the old link just opened. Not
  // when that client's current link already works here.
  const replacedBy = (await replacedLinks(removedTokens)).filter((r) => !clients.some((c) => c.id === r.client.id));

  // Emails back on in one tap, landing on a page that says so (reminders/off).
  async function turnOn(formData: FormData) {
    "use server";
    const client = await clientOnDevice(String(formData.get("clientId")));
    if (!client) return;
    await db.client.update({ where: { id: client.id }, data: { remindersOff: false } });
    redirect(`/reminders/off${new URL(unsubscribeUrl(client.id)).search}&done=on`);
  }
  // "Remove from this device": this browser forgets the personal link for that business (nothing is deleted).
  async function forget(workspaceId: string, clientId: string) {
    "use server";
    const jar = await cookies();
    jar.delete(clientCookie(workspaceId));
    jar.delete(keyHeldCookie(clientId));
  }
  // "Ask for my link again" after a key reset replaced the link this device had (it no longer identifies them).
  async function askReplaced(clientId: string) {
    "use server";
    const jar = await cookies();
    const mine = [...jar.getAll().filter((c) => c.name.startsWith("fc_client_")).map((c) => c.value), jar.get(REMOVED_COOKIE)?.value].filter((t): t is string => !!t);
    const row = (await replacedLinks(mine)).find((r) => r.client.id === clientId);
    return row ? askForLink(row.client.id) : false;
  }

  // Why links on this device open nothing right now. The one just opened (from ?removed=1 and the like) is
  // explained in the same "can't open" card every dead end uses; anything else is a banner.
  type Why = "invalid" | "removed" | "closed" | "unavailable" | "off" | "paused" | "replaced";
  const arrived: Why | null = invalid
    ? "invalid"
    : removed
      ? "removed"
      : closed
        ? "closed"
        : unavailable
          ? "unavailable"
          : off
            ? "off"
            : paused
              ? "paused"
              : replaced
                ? "replaced"
                : null;
  const titles: Record<Why, string> = {
    invalid: "This link doesn't look right",
    replaced: "Your link was replaced",
    removed: "Your access has ended",
    closed: "This link no longer opens your videos",
    unavailable: "Unavailable right now",
    off: "This link has been turned off",
    paused: "Your access is paused",
  };
  const notices: { why: Why; key: string; testId: string; text: ReactNode }[] = [
    ...ended.map((r) => ({
      why: "removed" as const,
      key: `removed:${r.workspace.name}`,
      testId: "client-removed",
      text: (
        <>
          {r.workspace.name} has ended your access to your videos from them. If that&rsquo;s a mistake, contact them.
          {r.purgeAt && r.purgeAt > now && (
            <> They can restore it until {zoned(r.workspace.timezone).longDay(r.purgeAt)}, after which your videos, messages and shared to-dos with them are deleted.</>
          )}
        </>
      ),
    })),
    ...(removed && ended.length === 0
      ? [{ why: "removed" as const, key: "removed", testId: "client-removed", text: <>The business that sent you this link has ended your access, so it no longer opens your videos. If that&rsquo;s a mistake, contact them.</> }]
      : []),
    ...closedNames.map((name) => ({
      why: "closed" as const,
      key: `closed:${name}`,
      testId: "client-closed",
      text: <>{name} has closed their SureFrame account, so this link no longer opens your videos from them. If you need anything, contact them directly.</>,
    })),
    ...(closed && closedNames.length === 0
      ? [{ why: "closed" as const, key: "closed", testId: "client-closed", text: <>The business that sent you this link has closed their SureFrame account, so it no longer opens your videos. If you need anything, contact them directly.</> }]
      : []),
    ...unavailableNames.map((name) => ({ why: "unavailable" as const, key: `unavailable:${name}`, testId: "client-unavailable", text: <>Videos from {name} are unavailable right now.</> })),
    ...(unavailable && unavailableNames.length === 0
      ? [{ why: "unavailable" as const, key: "unavailable", testId: "client-unavailable", text: <>Videos from the business that sent you this link are unavailable right now.</> }]
      : []),
    ...offNames.map((name) => ({ why: "off" as const, key: `off:${name}`, testId: "client-link-off", text: <>This link has been turned off, so it no longer opens your videos from {name}.</> })),
    ...(off && offNames.length === 0 ? [{ why: "off" as const, key: "off", testId: "client-link-off", text: <>This link has been turned off.</> }] : []),
    ...(paused || pausedNames.length > 0
      ? [
          {
            why: "paused" as const,
            key: "paused",
            testId: "client-paused",
            text: (
              <>
                Your access {pausedNames.length > 0 ? <>to videos from {pausedNames.join(", ")} </> : ""}is paused because{" "}
                {pausedNames.length > 1 ? "these businesses changed their" : "this business changed its"} SureFrame plan. The pause doesn&rsquo;t delete anything, but videos are only kept for a limited
                time, so please contact them soon to have it restored.
              </>
            ),
          },
        ]
      : []),
  ];
  const inCard = notices.filter((n) => n.why === arrived);
  const banners = notices.filter((n) => n.why !== arrived);

  // With one business, the whole page wears its branding.
  const brand = clients.length === 1 ? brandOf(clients[0].workspace) : !clients.length && replacedBy.length === 1 ? brandOf(replacedBy[0].client.workspace) : null;
  const help = await helpForDevice();

  return (
    <div data-theme="fresh" className="min-h-screen bg-canvas text-ink" style={brandStyle(brand?.color ?? null)}>
      {/* For a client not yet known to have the key here, the gate below takes the key from the link instead. */}
      {arrivedAs && listed.some((c) => c.id === arrivedAs) && <ClientKeyCapture clientId={arrivedAs} />}
      <ClientHeader brand={brand} help={help.length ? { for: help, page: "inbox" } : undefined} />
      {/* A reply a closed page interrupted finishes uploading here too, then waits on its video page to be sent. */}
      <RecoverUploads />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {/* The link's key is no use on a page that couldn't open it, so it leaves the address bar too. */}
        {arrived && <HideKeyFromAddress />}
        {replacedBy.map((r) => (
          <div key={r.client.id} className="mb-8">
            <CantOpen
              title={titles.replaced}
              testId="client-replaced"
              action={<AskForLink business={r.client.workspace.name} action={askReplaced.bind(null, r.client.id)} unlocks="your videos" />}
            >
              <p>{r.business} replaced your personal link to keep your videos secure, so the old one no longer opens them. Nothing has been deleted.</p>
              <p>
                {r.emailed
                  ? "They've emailed you your new link: open it on this device and your videos and replies are all here."
                  : `Ask ${r.business} for your new link, then open it on this device.`}
              </p>
            </CantOpen>
          </div>
        ))}
        {arrived && (arrived !== "replaced" || replacedBy.length === 0) && (
          <div className="mb-8">
            <CantOpen title={titles[arrived]} testId="client-cant-open">
              {arrived === "invalid" && (
                <p data-testid="client-invalid">
                  It may be missing a few characters or have been mistyped. Open it again from the original message, making sure you use the whole link, or ask the
                  business that sent it for your personal link.
                </p>
              )}
              {arrived === "replaced" && <p data-testid="client-replaced">The business that sent you this link replaced it to keep your videos secure. Ask them for your new link.</p>}
              {inCard.map((n) => (
                <p key={n.key} data-testid={n.testId}>{n.text}</p>
              ))}
            </CantOpen>
          </div>
        )}
        {(listed.length > 0 || (!arrived && !keyless.length && !replacedBy.length)) && <h1 className="text-2xl font-semibold tracking-tight text-ink">Your videos</h1>}
        {banners.map((n) => (
          <p key={n.key} className="mt-4 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg" data-testid={n.testId}>{n.text}</p>
        ))}
        {keyless.map((c) => (
          // Only how to get the key here: no titles, email address or other details until this device has it.
          <div key={c.id} className="mt-6" data-testid="inbox-keyless">
            <ClientKeyGate clientId={c.id} business={c.workspace.name} unlocks="your videos" />
          </div>
        ))}
        {clients.length === 0 ? (
          notices.length > 0 || arrived || replacedBy.length ? null : (
            <div className="mt-6">
              <CantOpen title="No videos on this device yet" testId="inbox-empty" signInNext="/library">
                <p>Open the personal link you were sent, and your videos show here on this device.</p>
              </CantOpen>
            </div>
          )
        ) : (
          listed.map((c) => (
            <section key={c.id} className="mt-8">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-dim">From {c.workspace.name}</h2>
                <ForgetDevice clientId={c.id} business={c.workspace.name} workspaceId={c.workspaceId} forget={forget.bind(null, c.workspaceId, c.id)} />
              </div>
              {aiAssistActive(c.workspace) && <AiNotice className="mt-2" />}
              {c.videos.length === 0 ? (
                <p className="mt-3 text-sm text-dim">Nothing yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
                  {c.videos.map((v) => {
                    // Only the client's own opens are counted, so none means they haven't watched it yet.
                    const unwatched = v.viewCount === 0;
                    const replied = v._count.replies > 0;
                    return (
                      <li key={v.id}>
                        <Link href={`/v/${v.id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-hover" data-testid="inbox-video">
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              {unwatched && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />}
                              <span className={`line-clamp-2 text-ink [overflow-wrap:anywhere] ${unwatched ? "font-semibold" : "font-medium"}`}>{v.title}</span>
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dim">
                              {/* Who sent it, never their email: "Sam from Business", or a former team member's (lib/team.ts). */}
                              {(v.owner.name || v.formerStaffAt) && <span>{senderName(v, c.workspace.name, "client")}</span>}
                              {unwatched && <span className="rounded-full bg-primary-soft px-2 py-0.5 font-medium text-accent" data-testid="inbox-new">New</span>}
                              {replied && <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium text-muted" data-testid="inbox-replied">You replied</span>}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm text-dim">{zoned(c.workspace.timezone).day(v.sentAt ?? v.createdAt)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-4">
                <ClientPlanner clientId={c.id} title="Your to-dos & notes" />
              </div>
              {c.email && (
                <div className="mt-2 flex flex-wrap items-center gap-x-1 text-xs text-dim" data-testid="inbox-emails">
                  <span>
                    Reminder and new-video emails are {c.remindersOff ? "off" : "on"} <span className="whitespace-nowrap">(to {masked(c.email)})</span>.
                  </span>
                  {c.remindersOff ? (
                    <form action={turnOn}>
                      <input type="hidden" name="clientId" value={c.id} />
                      <button className="font-medium text-accent hover:underline">Turn on</button>
                    </form>
                  ) : (
                    <a href={unsubscribeUrl(c.id)} className="font-medium text-accent hover:underline">Turn off</a>
                  )}
                </div>
              )}
            </section>
          ))
        )}
      </main>
      <MadeWith />
    </div>
  );
}
