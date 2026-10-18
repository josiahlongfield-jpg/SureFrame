import type { Metadata } from "next";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import MemberPlanner from "@/components/MemberPlanner";
import StorageStatus from "@/components/StorageStatus";
import LibraryThumb from "@/components/LibraryThumb";
import DayFolder from "@/components/DayFolder";
import { LibrarySearch, ReplyBadges, type Conv } from "@/components/LibraryTools";
import FirstSteps from "@/components/FirstSteps";
import { LibraryUnlock } from "@/components/TeamKeyGate";
import { dueTodos } from "@/lib/dueTodos";
import { firstStepsFor } from "@/lib/firstSteps";
import { db } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { followTeamLink, requirePageUser } from "@/lib/session";
import { reminderDefaultsFor } from "@/lib/reminders";
import { accessOf, clientScopeWhere, effectivePerms, isManager, libraryWhere, seesAllClients } from "@/lib/permissions";
import type { Prisma } from "@prisma/client";
import { zoned } from "@/lib/dates";
import { videosUsed } from "@/lib/videoAllowance";
import { RETENTION_DAYS } from "@/lib/retention";
import { visibleReplies } from "@/lib/replies";
import { senderName } from "@/lib/team";

export const metadata: Metadata = { title: "Library" };

const fmt = (ms: number | null) => {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** A card warns about its server copy being deleted only from this close (the "Deleting soon" filter's week). */
const NEAR_MS = 7 * 86_400_000;

export default async function Library({ searchParams }: { searchParams: Promise<{ show?: string; filter?: string; ws?: string; restored?: string; q?: string; client?: string }> }) {
  const { show, filter, ws, restored, q: rawQ, client: rawClient } = await searchParams;
  const q = (rawQ ?? "").trim().slice(0, 100);
  await followTeamLink(ws, filter ? `/library?filter=${encodeURIComponent(filter)}` : "/library");
  // Kept the "restored" note through /agree, for a kept account that has to agree to new terms first.
  const me = await requirePageUser(restored ? `/library?restored=${encodeURIComponent(restored)}` : "/library");
  const { user, workspace } = me;
  const access = accessOf(me);
  const plan = PLANS[workspace.plan];
  // Staff who only see their own clients have nothing else to switch to.
  const teamSize = await db.membership.count({ where: { workspaceId: workspace.id, pausedAt: null } });
  const team = seesAllClients(access) && teamSize > 1;
  // On a team, "Mine" is what I recorded plus anything for the clients I look after.
  // Staff start on "Mine"; owners and admins on everything.
  const mine = team && (show === "mine" || (!isManager(access) && show !== "all"));
  const scope: Prisma.VideoWhereInput = { ...libraryWhere(access), ...(mine ? { OR: [{ ownerId: user.id }, { client: { assignedToId: user.id } }, { copies: { some: { client: { assignedToId: user.id } } } }] } : {}) };
  // "Deleting soon": server copies deleted within a week (no cloud backup), soonest first.
  const soonWhere: Prisma.VideoWhereInput = { ...scope, AND: [{ purgeAt: { not: null, lte: new Date(Date.now() + 7 * 86_400_000) } }, { status: { notIn: ["EXPIRED", "RECORDING"] } }] };
  const soon = filter === "soon";
  const clients = await db.client.findMany({ where: { ...clientScopeWhere(access), removedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const clientId = clients.some((c) => c.id === rawClient) ? rawClient! : "";
  const searching = !!q || !!clientId;
  // By title, or by who it was sent to (the copies sent to other clients count too).
  const contains = { contains: q, mode: "insensitive" as const };
  const search: Prisma.VideoWhereInput[] = [
    ...(q ? [{ OR: [{ title: contains }, { client: { name: contains } }, { copies: { some: { client: { name: contains } } } }] }] : []),
    ...(clientId ? [{ OR: [{ clientId }, { copies: { some: { clientId } } }] }] : []),
  ];
  const [videos, soonCount, allowance, due] = await Promise.all([
    // Copies sent to other clients count their views and replies towards the original, and name who it went to.
    db.video.findMany({
      where: { AND: [soon ? soonWhere : scope, ...search] },
      orderBy: soon ? { purgeAt: "asc" } : { createdAt: "desc" },
      include: {
        copies: { select: { id: true, viewCount: true, client: { select: { name: true, assignedToId: true } } } },
        client: { select: { name: true, removedAt: true, purgeAt: true } },
        thumb: { select: { videoId: true } },
        source: { select: { thumb: { select: { videoId: true } } } },
      },
    }),
    db.video.count({ where: soonWhere }),
    plan.maxVideos !== null ? videosUsed(workspace.id) : null,
    dueTodos(access),
  ]);
  // The client's replies in each conversation (the team's own aren't news), newest first, with when they came,
  // so each device can tell which it hasn't seen (components/LibraryTools.tsx). Held and uploading replies don't count yet.
  const convIds = videos.flatMap((v) => [v.id, ...v.copies.map((c) => c.id)]);
  const clientReplies = convIds.length
    ? await db.reply.findMany({ where: { videoId: { in: convIds }, authorUserId: null, ...visibleReplies }, orderBy: { createdAt: "desc" }, select: { videoId: true, createdAt: true } })
    : [];
  const fromClients = new Map<string, string[]>();
  for (const r of clientReplies) fromClients.set(r.videoId, [...(fromClients.get(r.videoId) ?? []), r.createdAt.toISOString()]);
  const convsOf = (v: { id: string; copies: { id: string }[] }): Conv[] =>
    [v.id, ...v.copies.map((c) => c.id)].map((id) => ({ id, fromClient: fromClients.get(id) ?? [] }));
  // A new owner's first steps (components/FirstSteps.tsx) include the clients step; staff get "Start here" below.
  const steps = await firstStepsFor(me);
  // A new business starts on its clients: once they're in, sending a video is picking them from a list.
  const startHere = clients.length === 0 && videos.length === 0 && !soon && !searching && effectivePerms(access).addClients && !steps;
  // Staff usually have clients assigned to them rather than adding their own: their first screen says so.
  const staffStart = !isManager(access) && clients.length === 0 && videos.length === 0 && !soon && !searching;
  const canAddClients = effectivePerms(access).addClients;
  // Free: videos in total for the life of the workspace, deleted ones included.
  const freeLeft = allowance && plan.maxVideos !== null ? Math.max(0, plan.maxVideos - allowance.used) : null;
  const withParams = (p: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString();
    return q ? `/library?${q}` : "/library";
  };
  const showParam = (m: boolean) => (isManager(access) ? (m ? "mine" : undefined) : m ? undefined : "all");
  const tabs = [
    { href: withParams({ show: showParam(false), filter: soon ? "soon" : undefined }), label: "All", active: !mine },
    { href: withParams({ show: showParam(true), filter: soon ? "soon" : undefined }), label: "Mine", active: mine },
  ];
  const filters = [
    { href: withParams({ show: team ? showParam(mine) : undefined }), label: "All videos", active: !soon },
    { href: withParams({ show: team ? showParam(mine) : undefined, filter: "soon" }), label: `Deleting soon${soonCount ? ` (${soonCount})` : ""}`, active: soon },
  ];
  const dates = zoned(workspace.timezone);
  const now = new Date();
  const views = (v: (typeof videos)[number]) => v.viewCount + v.copies.reduce((n, c) => n + c.viewCount, 0);
  type Item = (typeof videos)[number];
  // Who it went to. Staff who only see their own clients aren't shown the others' names.
  const seesAll = seesAllClients(access);
  const sentTo = (v: Item) => [v.client?.name, ...v.copies.filter((c) => seesAll || c.client?.assignedToId === user.id).map((c) => c.client?.name)].filter((n): n is string => !!n);
  const recipients = (v: Item) => {
    const names = sentTo(v);
    if (!names.length) return "Not sent yet";
    return `To ${names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`}`;
  };
  // Recordings with the same title (the date-made default, recorded in the same minute) also show the seconds.
  const titles = new Map<string, number>();
  for (const v of videos) titles.set(v.title, (titles.get(v.title) ?? 0) + 1);
  const seconds = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: dates.zone });
  const when = (v: Item, inDay: boolean) => {
    if ((titles.get(v.title) ?? 0) > 1) return inDay ? seconds.format(v.createdAt) : `${dates.shortDay(v.createdAt)}, ${seconds.format(v.createdAt)}`;
    return inDay ? dates.time(v.createdAt) : dates.shortDayTime(v.createdAt);
  };
  // The deletion date is said once at the top; a card only warns when it's near (or in the "Deleting soon" list).
  const nearDeletion = (v: Item) => !workspace.cloudBackup && !!v.purgeAt && v.purgeAt.getTime() - now.getTime() < NEAR_MS;
  // The library still: a sealed one for encrypted recordings (made on this device if missing), else the video itself.
  const still = (v: Item) =>
    v.thumbnailUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={v.thumbnailUrl} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
    ) : v.encrypted ? (
      // Staff who look after a client see that client's copy here; it uses the original's still.
      <LibraryThumb videoId={v.id} teamKeyWrap={v.teamKeyWrap} workspaceId={workspace.id} fingerprint={workspace.keyFingerprint} has={v.status !== "EXPIRED" && !!(v.thumb ?? v.source?.thumb)} canMake={v.status === "UPLOADED" || v.status === "PROCESSING" || v.status === "READY"} rawUrl={`/api/videos/${v.id}/stream`} mimeType={v.mimeType} />
    ) : v.status !== "RECORDING" ? (
      <video src={`/api/videos/${v.id}/stream#t=0.5`} preload="metadata" muted className="h-full w-full object-cover" />
    ) : null;
  // Inside a day's folder the time says when; in "Deleting soon" the date does.
  const grid = (items: Item[], inDay: boolean) => (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((v) => (
        <li key={v.id}>
          <Link href={`/v/${v.id}`} className="group block">
            <div className="relative aspect-video overflow-hidden rounded-xl bg-solid">
              {still(v)}
              {v.status === "EXPIRED" && (
                <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">Deleted from our servers</span>
              )}
              {v.status === "RECORDING" && (
                <span className="absolute inset-0 grid place-items-center text-sm text-dim">Incomplete upload</span>
              )}
              {v.durationMs ? (
                <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">{fmt(v.durationMs)}</span>
              ) : null}
            </div>
            <h3 className="mt-3 truncate font-medium text-ink group-hover:text-accent">{v.title}</h3>
            <p className="text-xs text-dim">
              <span data-testid="video-time">{when(v, inDay)}</span> · {views(v)} {views(v) === 1 ? "view" : "views"}
            </p>
            <p className="truncate text-xs text-muted" data-testid="video-recipients" title={sentTo(v).join(", ") || undefined}>{recipients(v)}</p>
            {/* Kept by the business after its recorder left: not shown as the owner's (lib/team.ts). */}
            {v.formerStaffAt && <p className="truncate text-xs text-dim" data-testid="video-former">{senderName({ ...v, owner: { name: null } }, workspace.name, "team")}</p>}
            <span className="mt-1 block empty:hidden">
              <ReplyBadges convs={convsOf(v)} />
            </span>
            {soon || v.status === "EXPIRED" || nearDeletion(v) ? (
              <StorageStatus status={v.status} purgeAt={v.purgeAt?.toISOString() ?? null} cloudBackup={workspace.cloudBackup} />
            ) : (
              // Search results have no day row to carry the date.
              !inDay && !workspace.cloudBackup && v.purgeAt && v.status !== "RECORDING" && <p className="text-xs text-dim" data-testid="card-deletes">Deletes from our servers {dates.shortDay(v.purgeAt)}</p>
            )}
            {v.client?.removedAt && (
              <p className="text-xs text-warn-fg" data-testid="client-removed-badge">
                Client removed{v.client.purgeAt && v.client.purgeAt > now ? ` · conversation deleted ${dates.shortDay(v.client.purgeAt)}` : ""}
              </p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
  // Days in the workspace's time zone; videos are already newest first.
  const today = dates.day(now);
  const yesterday = dates.day(new Date(now.getTime() - 86_400_000));
  const days: { key: string; label: string; items: Item[] }[] = [];
  for (const v of videos) {
    const key = dates.day(v.createdAt);
    const last = days[days.length - 1];
    if (last?.key === key) last.items.push(v);
    else days.push({ key, label: key === today ? "Today" : key === yesterday ? "Yesterday" : dates.weekdayDay(v.createdAt), items: [v] });
  }
  // When a day's recordings leave our servers: said once on the day's row rather than on every card.
  const dayDeletes = (items: Item[]) => {
    if (workspace.cloudBackup) return null;
    const at = items.flatMap((v) => (v.purgeAt && v.status !== "EXPIRED" && v.status !== "RECORDING" ? [v.purgeAt.getTime()] : [])).sort((a, b) => a - b)[0];
    return at ? new Date(at) : null;
  };
  const pill = (active: boolean) => `rounded-md px-3 py-1.5 ${active ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`;

  return (
    <>
      <AppHeader email={user.email} plan={plan.name} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {restored && (
          // Just kept their closed account (app/account/restore).
          <p role="status" className="mb-6 max-w-2xl rounded-xl border border-ok-line bg-ok-bg p-3 text-sm text-ok-fg" data-testid="account-restored">
            Your account is open again and won&apos;t be deleted.
            {restored === "ended" && (
              <>
                {" "}Your subscription ended while it was closed. Subscribe again to get your paid features back; until then, clients your current plan doesn&apos;t cover stay paused.{" "}
                <Link href="/settings/billing" className="font-medium text-ok-fg underline">Open Billing</Link>
              </>
            )}
          </p>
        )}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{team ? "Team videos" : "Your videos"}</h1>
            <p className="mt-1 text-sm text-dim">
              {soon ? `${videos.length} deleting from our servers within 7 days` : (
                <>
                  {videos.length} {videos.length === 1 ? "video" : "videos"}
                  {allowance && plan.maxVideos !== null && (
                    <span data-testid="free-videos-used">{` · ${Math.min(allowance.used, plan.maxVideos)} of ${plan.maxVideos} free videos used`}</span>
                  )}
                </>
              )}
            </p>
            {freeLeft !== null && freeLeft === 0 ? (
              <p className="mt-2 max-w-xl rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn-fg" data-testid="free-videos-note">
                You&apos;ve used all {plan.maxVideos} free videos. Upgrade to record more. Your existing videos, replies and clients carry on as normal.{" "}
                <Link href="/pricing" className="font-medium text-warn-fg underline">See plans</Link>
              </p>
            ) : freeLeft !== null && freeLeft <= 5 ? (
              <p className="mt-2 text-sm text-warn-fg" data-testid="free-videos-note">
                {freeLeft} free {freeLeft === 1 ? "video" : "videos"} left. Deleting a video doesn&apos;t give its place back.{" "}
                <Link href="/pricing" className="font-medium text-accent hover:underline">See plans</Link>
              </p>
            ) : null}
            {videos.length > 0 && !soon && (
              <p className="mt-2 max-w-2xl text-sm text-dim" data-testid="deletion-note">
                {workspace.cloudBackup
                  ? "Cloud backup is on, so your recordings aren't deleted from our servers on a schedule."
                  : `Each recording's encrypted copy is deleted from our servers ${RETENTION_DAYS} days after it's recorded. To keep one, open it and choose Save to device. A video shows a warning in its last week.`}
              </p>
            )}
            {plan.showsPromo && (
              <p className="mt-2 text-sm text-dim" data-testid="promo-note">
                Your clients see a short SureFrame intro the first time they open your videos on a device. Paid plans remove it.{" "}
                <Link href="/pricing" className="font-medium text-accent hover:underline">See plans</Link>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {(!workspace.cloudBackup || soonCount > 0 || soon) && (
              <nav aria-label="Filter videos" className="flex gap-1 rounded-lg bg-surface-2 p-1 text-sm">
                {filters.map(({ href, label, active }) => (
                  <Link key={href} href={href} aria-current={active ? "page" : undefined} className={pill(active)}>{label}</Link>
                ))}
              </nav>
            )}
            {team && (
              <nav aria-label="Which videos" className="flex gap-1 rounded-lg bg-surface-2 p-1 text-sm">
                {tabs.map(({ href, label, active }) => (
                  <Link key={label} href={href} aria-current={active ? "page" : undefined} className={pill(active)}>{label}</Link>
                ))}
              </nav>
            )}
          </div>
        </div>
        {/* A new device meets the unlock box first, not below the locked tiles. */}
        <LibraryUnlock workspaceId={workspace.id} fingerprint={workspace.keyFingerprint} />
        {steps && !soon && <FirstSteps steps={steps} workspaceId={workspace.id} fingerprint={workspace.keyFingerprint} business={workspace.name} />}
        {(videos.length > 0 || searching) && !startHere && (
          <LibrarySearch q={q} client={clientId} clients={clients} keep={{ show, filter }} />
        )}
        {searching && (
          <p className="-mt-3 mb-4 text-sm text-muted" data-testid="search-summary">
            {videos.length} {videos.length === 1 ? "video" : "videos"}
            {q && <> matching &ldquo;{q}&rdquo;</>}
            {clientId && <> sent to {clients.find((c) => c.id === clientId)?.name}</>}
          </p>
        )}
        {soon && (
          <p className="-mt-4 mb-6 max-w-2xl text-sm text-muted">
            {workspace.cloudBackup
              ? "Cloud backup is on, so nothing here is due to be deleted."
              : "These recordings' encrypted copies are deleted from our servers within 7 days. After that they can't be watched from their links. Open one and choose Save to device to keep your own copy."}
          </p>
        )}
        {videos.length === 0 && searching ? (
          <div className="rounded-2xl border border-dashed border-line-strong p-10 text-center sm:p-16">
            <h2 className="font-semibold text-ink">No videos match</h2>
            <p className="mt-1 text-sm text-dim">Try another word, or clear the search to see everything.</p>
          </div>
        ) : videos.length === 0 && soon ? (
          <div className="rounded-2xl border border-dashed border-line-strong p-16 text-center">
            <h2 className="font-semibold text-ink">Nothing deleting soon</h2>
            <p className="mt-1 text-sm text-dim">No recordings are due to be deleted from our servers in the next 7 days.</p>
          </div>
        ) : staffStart ? (
          <div className="rounded-2xl border border-line bg-surface p-8 sm:p-10" data-testid="staff-start">
            <p className="font-mono text-xs uppercase tracking-widest text-accent">Welcome to {workspace.name}</p>
            <h2 className="mt-2 text-xl font-semibold text-ink">Your clients will show here</h2>
            <p className="mt-2 max-w-xl text-sm text-muted">
              The owner or an admin assigns clients to you. Once they have, record a video and pick those clients to send it to.
              {canAddClients && " You can also add clients of your own: they're assigned to you."}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Link href="/team" className="rounded-xl bg-primary px-5 py-2.5 font-semibold text-on-primary hover:bg-primary-hover">See your team</Link>
              {canAddClients && <Link href="/clients" className="text-sm text-dim hover:text-ink">Add a client of your own</Link>}
            </div>
          </div>
        ) : startHere ? (
          <div className="rounded-2xl border border-line bg-surface p-8 sm:p-10" data-testid="start-here">
            <p className="font-mono text-xs uppercase tracking-widest text-accent">Start here</p>
            <h2 className="mt-2 text-xl font-semibold text-ink">Add your clients first</h2>
            <p className="mt-2 max-w-xl text-sm text-muted">
              Put in the clients you&apos;ll send videos to, with their email addresses. You can paste a whole list at once.
              Then, when a video is ready, you just pick them from a list and press Send.
            </p>
            <ol className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
              {["Add your clients", "Record a video", "Pick clients and send"].map((step, i) => (
                <li key={step} className={`rounded-xl border px-4 py-3 ${i === 0 ? "border-primary text-ink" : "border-line text-dim"}`}>
                  <span className="mr-2 font-mono text-xs">{i + 1}</span>{step}
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Link href="/clients" className="rounded-xl bg-primary px-5 py-2.5 font-semibold text-on-primary hover:bg-primary-hover">Add your clients</Link>
              <Link href="/record" className="text-sm text-dim hover:text-ink">Record first instead</Link>
            </div>
          </div>
        ) : videos.length === 0 && !steps ? (
          <div className="rounded-2xl border border-dashed border-line-strong p-16 text-center">
            <h2 className="font-semibold text-ink">No videos yet</h2>
            <p className="mt-1 text-sm text-dim">Record your first video and it will show up here.</p>
            <Link href="/record" className="mt-6 inline-block rounded-xl bg-primary px-5 py-2.5 font-semibold text-on-primary hover:bg-primary-hover">Record a video</Link>
          </div>
        ) : (
          soon || searching ? (
            grid(videos, false)
          ) : (
            // One folder per day something was recorded, newest first; opening it shows that day's videos.
            <div className="space-y-4">
              {days.map(({ key, label, items }, i) => (
                <DayFolder
                  key={key}
                  day={key}
                  // The newest day starts open, so the latest videos are on screen straight away.
                  defaultOpen={i === 0}
                  summary={
                    <>
                      <span className="relative aspect-video w-24 shrink-0 sm:w-36">
                        {/* A stack of cards: the day's newest still in front. */}
                        {items.length > 2 && <span aria-hidden className="absolute inset-0 translate-x-2 -translate-y-2 rounded-lg border border-line bg-solid opacity-60" />}
                        {items.length > 1 && <span aria-hidden className="absolute inset-0 translate-x-1 -translate-y-1 rounded-lg border border-line bg-solid opacity-80" />}
                        <span className="absolute inset-0 overflow-hidden rounded-lg border border-line bg-solid">{still(items[0])}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-ink" data-testid="day-label">{label}</span>
                        <span className="block text-sm text-dim">
                          <span data-testid="day-count">{items.length} {items.length === 1 ? "video" : "videos"}</span>
                          {dayDeletes(items) && <span data-testid="day-deletes"> · deletes from our servers {dates.shortDay(dayDeletes(items)!)}</span>}
                        </span>
                        <span className="mt-1 block empty:hidden">
                          <ReplyBadges convs={items.flatMap(convsOf)} onlyNew />
                        </span>
                      </span>
                    </>
                  }
                >
                  {grid(items, true)}
                </DayFolder>
              ))}
            </div>
          )
        )}
        <div id="todos" className="mt-12 max-w-2xl scroll-mt-6">
          {due.total > 0 && (
            // The menu's "To-dos" comes here: client to-dos live on each client's page, so name the clients with some due.
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
          {/* Items not about a client are one list for the whole team; say so when there is a team. */}
          <MemberPlanner
            lockedNote={<p className="rounded-2xl border border-line bg-surface p-5 text-sm text-dim">Your to-dos and notes open once this browser is unlocked. <a href="#unlock" className="font-medium text-accent hover:underline">Unlock at the top of the page</a></p>}
            workspaceId={workspace.id}
            fingerprint={workspace.keyFingerprint}
            defaults={{ ...reminderDefaultsFor(workspace, me.membership), remindTeam: true }}
            title="To-dos & notes"
            {...(teamSize > 1
              ? { note: "Not about one client. Everyone on your team can see and change these. Client to-dos go on each client's page.", teamWho: { label: "Email the team", tag: "the team" } }
              : { note: "Not about one client. Only you see these for now; anyone you add to your team later will too. Client to-dos go on each client's page." })}
          />
        </div>
      </main>
    </>
  );
}
