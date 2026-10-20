"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LAYOUT_COOKIE, VIEW_COOKIE } from "@/lib/libraryGroups";

/** One conversation about a recording: when each of the client's replies came, newest first. */
export type Conv = { id: string; fromClient: string[] };

/**
 * Reply and unread counts for a recording (all its conversations). "New" is
 * per device, like the conversation's own dot (components/WatchView.tsx, which
 * remembers when this device last had the conversation on screen): replies
 * from the client since then.
 */
export function ReplyBadges({ convs, onlyNew = false }: { convs: Conv[]; onlyNew?: boolean }) {
  const [fresh, setFresh] = useState(0);
  useEffect(() => {
    let n = 0;
    for (const c of convs) {
      let seenAt = "";
      try {
        seenAt = localStorage.getItem(`sureframe:seen-at:${c.id}`) ?? "";
      } catch {
        /* storage blocked: everything from the client counts as new */
      }
      n += c.fromClient.filter((at) => at > seenAt).length;
    }
    setFresh(n);
  }, [convs]);
  const replies = convs.reduce((n, c) => n + c.fromClient.length, 0);
  if (!replies || (onlyNew && !fresh)) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="reply-badges">
      {!onlyNew && (
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted" data-testid="reply-count">
          {replies} {replies === 1 ? "reply" : "replies"}
        </span>
      )}
      {fresh > 0 && (
        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-on-primary" data-testid="unread-count">
          {fresh} new
        </span>
      )}
    </span>
  );
}

/**
 * Search the library by title or client, and narrow it to one client. The
 * search is in the address, so Back returns to the same results; typing
 * searches as you go (after a short pause), like the client filter. Without
 * scripts it's a plain form with a Search button.
 */
export function LibrarySearch({ q, client, clients, keep }: { q: string; client: string; clients: { id: string; name: string }[]; keep: Record<string, string | undefined> }) {
  const router = useRouter();
  const kept = Object.entries(keep).filter((e): e is [string, string] => !!e[1]);
  const rest = new URLSearchParams(kept);
  const [text, setText] = useState(q);
  const box = useRef<HTMLInputElement>(null);
  // Back and Forward change the address under us: show what it searched for, unless they're typing.
  useEffect(() => {
    if (document.activeElement !== box.current) setText(q);
  }, [q]);
  const urlFor = (words: string, who: string) => {
    const p = new URLSearchParams(kept);
    if (words.trim()) p.set("q", words.trim());
    if (who) p.set("client", who);
    return p.size ? `/library?${p}` : "/library";
  };
  useEffect(() => {
    if (text.trim() === q) return;
    const t = setTimeout(() => router.replace(urlFor(text, client), { scroll: false }), 400);
    return () => clearTimeout(t);
    // urlFor only reads props that are already deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, q, client, router]);
  return (
    <form
      role="search"
      action="/library"
      className="mb-6 flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(urlFor(text, client), { scroll: false });
      }}
    >
      {kept.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input
        ref={box}
        type="search"
        name="q"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search titles and clients"
        aria-label="Search videos"
        data-testid="library-search"
        className="min-w-0 flex-1 basis-48 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
      />
      {clients.length > 0 && (
        <select
          name="client"
          value={client}
          onChange={(e) => router.push(urlFor(text, e.target.value), { scroll: false })}
          aria-label="Client"
          data-testid="library-client"
          className="min-w-0 max-w-full rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm"
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}
      <button className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-hover">Search</button>
      {(q || client) && (
        <Link href={rest.size ? `/library?${rest}` : "/library"} onClick={() => setText("")} className="px-2 py-2 text-sm text-dim hover:text-ink" data-testid="library-clear">
          Clear
        </Link>
      )}
    </form>
  );
}

/** "By date" or "By client", and big tiles or one line per video. */
export function LibraryViewSwitch({ view, layout, canGroupByClient, layoutCookie = LAYOUT_COOKIE }: { view: "date" | "client"; layout: "tiles" | "list"; canGroupByClient: boolean; layoutCookie?: string }) {
  const router = useRouter();
  const set = (name: string, value: string) => {
    document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  const pill = (active: boolean) => `flex items-center gap-1.5 rounded-md px-3 py-1.5 ${active ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
      {canGroupByClient ? (
        <div role="group" aria-label="Group videos" className="flex gap-1 rounded-lg bg-surface-2 p-1">
          {(["date", "client"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => set(VIEW_COOKIE, v)} className={pill(view === v)} data-testid={`view-${v}`}>
              {v === "date" ? "By date" : "By client"}
            </button>
          ))}
        </div>
      ) : (
        <span />
      )}
      <div role="group" aria-label="Layout" className="flex gap-1 rounded-lg bg-surface-2 p-1">
        {(["tiles", "list"] as const).map((l) => (
          <button key={l} type="button" aria-pressed={layout === l} onClick={() => set(layoutCookie, l)} className={pill(layout === l)} data-testid={`layout-${l}`}>
            <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {l === "tiles" ? (
                <>
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </>
              ) : (
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              )}
            </svg>
            {l === "tiles" ? "Tiles" : "List"}
          </button>
        ))}
      </div>
    </div>
  );
}
