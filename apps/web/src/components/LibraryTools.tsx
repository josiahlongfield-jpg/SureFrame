"use client";

import { useEffect, useState } from "react";

/** One conversation about a recording: its replies, and how many came from the client. */
export type Conv = { id: string; total: number; fromClient: number };

/**
 * Reply and unread counts for a recording (all its conversations). "New" is
 * per device, like the conversation's own bubble (components/WatchView.tsx):
 * replies from the client this device hasn't had on screen yet.
 */
export function ReplyBadges({ convs, onlyNew = false }: { convs: Conv[]; onlyNew?: boolean }) {
  const [fresh, setFresh] = useState(0);
  useEffect(() => {
    let n = 0;
    for (const c of convs) {
      let seen = 0;
      try {
        seen = Number(localStorage.getItem(`sureframe:seen-replies:${c.id}`)) || 0;
      } catch {
        /* storage blocked: everything from the client counts as new */
      }
      n += Math.min(c.fromClient, Math.max(0, c.total - seen));
    }
    setFresh(n);
  }, [convs]);
  const replies = convs.reduce((n, c) => n + c.fromClient, 0);
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
 * Search the library by title or client, and narrow it to one client. A plain
 * form: the search is in the address, so Back returns to the same results.
 */
export function LibrarySearch({ q, client, clients, keep }: { q: string; client: string; clients: { id: string; name: string }[]; keep: Record<string, string | undefined> }) {
  const kept = Object.entries(keep).filter((e): e is [string, string] => !!e[1]);
  const rest = new URLSearchParams(kept);
  return (
    <form role="search" action="/library" className="mb-6 flex flex-wrap gap-2">
      {kept.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder="Search titles and clients"
        aria-label="Search videos"
        data-testid="library-search"
        className="min-w-0 flex-1 basis-48 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
      />
      {clients.length > 0 && (
        <select
          name="client"
          defaultValue={client}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
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
        // A full load, like the form itself.
        <a href={rest.size ? `/library?${rest}` : "/library"} className="px-2 py-2 text-sm text-dim hover:text-ink" data-testid="library-clear">
          Clear
        </a>
      )}
    </form>
  );
}
