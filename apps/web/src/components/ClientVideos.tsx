import Link from "next/link";
import DayFolder from "./DayFolder";
import ClientThumb from "./ClientThumb";
import { groupByAge, type Group } from "@/lib/libraryGroups";
import { zoned } from "@/lib/dates";

/** One video on a client's "Your videos" page. `createdAt` is when it reached them, so it's grouped by that. */
export type ClientVideo = {
  id: string;
  title: string;
  createdAt: Date;
  durationMs: number | null;
  encrypted: boolean;
  clientKeyWrap: string | null;
  hasThumb: boolean;
  unwatched: boolean;
  replied: boolean;
  /** They recorded a reply to it and haven't sent it yet. */
  unsent?: boolean;
  /** "Sam from Business" (lib/team.ts), or null to say nothing. */
  from: string | null;
};

const length = (ms: number | null) => {
  if (!ms) return "";
  // Whole seconds, as the player counts them.
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * A client's videos from one business, laid out like the business's own library
 * (src/app/library/page.tsx): folders by day, then week, then month, as tiles or a
 * list. The newest folder starts open.
 */
export default function ClientVideos({ clientId, videos, timezone, layout }: { clientId: string; videos: ClientVideo[]; timezone: string | null; layout: "tiles" | "list" }) {
  const dates = zoned(timezone);
  const tiles = layout !== "list";
  const still = (v: ClientVideo) =>
    v.encrypted ? (
      <ClientThumb clientId={clientId} videoId={v.id} wrap={v.clientKeyWrap} has={v.hasThumb} />
    ) : (
      <video src={`/api/videos/${v.id}/stream#t=0.5`} preload="metadata" muted className="h-full w-full object-cover" />
    );
  const badges = (v: ClientVideo) => (
    <>
      {v.unwatched && <span className="rounded-full bg-primary-soft px-2 py-0.5 font-medium text-accent" data-testid="inbox-new">New</span>}
      {v.replied && <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium text-muted" data-testid="inbox-replied">You replied</span>}
      {v.unsent && <span className="rounded-full bg-warn-bg px-2 py-0.5 font-medium text-warn-fg" data-testid="inbox-unsent">Unsent reply</span>}
    </>
  );
  const when = (v: ClientVideo, inDay: boolean) => (inDay ? dates.time(v.createdAt) : dates.shortDayTime(v.createdAt));

  const grid = (items: ClientVideo[], inDay: boolean) => (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:gap-6 lg:grid-cols-3">
      {items.map((v) => (
        <li key={v.id} className="min-w-0">
          <Link href={`/v/${v.id}`} className="group block" data-testid="inbox-video">
            <div className="relative aspect-video overflow-hidden rounded-xl bg-solid">
              {still(v)}
              {v.durationMs ? <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">{length(v.durationMs)}</span> : null}
            </div>
            <h3 className={`mt-3 line-clamp-2 text-ink [overflow-wrap:anywhere] group-hover:text-accent ${v.unwatched ? "font-semibold" : "font-medium"}`}>{v.title}</h3>
            {/* Wraps onto a second line rather than cutting the sender off mid-word (C12). */}
            <p className="line-clamp-2 text-xs text-dim [overflow-wrap:anywhere]" data-testid="inbox-byline">
              {when(v, inDay)}
              {v.from && <> · {v.from}</>}
            </p>
            <p className="mt-1 flex flex-wrap gap-1 text-xs empty:hidden">{badges(v)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
  const list = (items: ClientVideo[], inDay: boolean) => (
    <ul className="-my-2 divide-y divide-line" data-testid="video-list">
      {items.map((v) => (
        <li key={v.id}>
          <Link href={`/v/${v.id}`} className="group flex items-start gap-3 py-2" data-testid="inbox-video">
            <span className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-md bg-solid sm:w-28">
              {still(v)}
              {v.durationMs ? <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-xs leading-4 text-white">{length(v.durationMs)}</span> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm text-ink group-hover:text-accent ${v.unwatched ? "font-semibold" : "font-medium"}`}>{v.title}</span>
              <span className="block truncate text-xs text-dim">
                {when(v, inDay)}
                {v.from && <> · {v.from}</>}
              </span>
              <span className="mt-1 flex flex-wrap gap-1 text-xs empty:hidden">{badges(v)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
  const cards = (items: ClientVideo[], inDay: boolean) => (tiles ? grid(items, inDay) : list(items, inDay));
  const stack = (items: ClientVideo[], className: string) => (
    <span className={`relative aspect-video shrink-0 ${className}`}>
      {items.length > 2 && <span aria-hidden className="absolute inset-0 translate-x-2 -translate-y-2 rounded-lg border border-line bg-solid opacity-60" />}
      {items.length > 1 && <span aria-hidden className="absolute inset-0 translate-x-1 -translate-y-1 rounded-lg border border-line bg-solid opacity-80" />}
      <span className="absolute inset-0 overflow-hidden rounded-lg border border-line bg-solid">{still(items[0])}</span>
    </span>
  );
  const fresh = (items: ClientVideo[]) => items.filter((v) => v.unwatched).length;
  const count = (items: ClientVideo[]) => (
    <>
      <span data-testid="folder-count">{items.length} {items.length === 1 ? "video" : "videos"}</span>
      {fresh(items) > 0 && <span className="font-medium text-accent"> · {fresh(items)} new</span>}
    </>
  );
  const folderList = tiles ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" : "space-y-2";
  const folder = (g: Group<ClientVideo>, depth: 0 | 1 | 2, open: boolean) => (
    <DayFolder
      key={g.key}
      day={`${clientId}:${g.key}`}
      kind={g.kind}
      depth={depth}
      compact={!tiles}
      defaultOpen={open}
      summary={
        <>
          {stack(g.items, !tiles ? "w-14 sm:w-16" : depth === 0 ? "w-24 sm:w-36" : "w-16 sm:w-24")}
          <span className="min-w-0 flex-1">
            <span className={`block break-words text-ink ${depth === 0 ? "font-semibold" : "text-sm font-medium"}`} data-testid="folder-label">{g.label}</span>
            <span className={`block text-dim ${depth === 0 ? "text-sm" : "text-xs"}`}>{count(g.items)}</span>
          </span>
        </>
      }
      tile={
        tiles ? (
          <span className="block min-w-0">
            <span className="mr-2 mt-2 block">{stack(g.items, "block w-full")}</span>
            <span className="mt-2 block break-words text-sm font-semibold text-ink" data-testid="folder-label">{g.label}</span>
            <span className="block text-xs text-dim">{count(g.items)}</span>
          </span>
        ) : undefined
      }
    >
      {g.children ? <div className={folderList}>{g.children.map((c) => folder(c, (depth + 1) as 1 | 2, false))}</div> : cards(g.items, g.kind === "day")}
    </DayFolder>
  );
  return <div className={folderList} data-testid="client-videos">{groupByAge(videos, dates.zone, new Date()).map((g, i) => folder(g, 0, i === 0))}</div>;
}
