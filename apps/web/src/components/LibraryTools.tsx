"use client";

import { useEffect, useState } from "react";

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
