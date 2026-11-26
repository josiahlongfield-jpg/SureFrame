"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readyIn, recoverInterrupted } from "@/lib/recorder/uploader";
import { listLeftovers } from "@/lib/recorder/leftover";

/**
 * Finishes recordings a crash or closed tab left in this browser, from any
 * signed-in page and from a client's pages. The recorder and the video page
 * run their own recovery, unless `always` is set (the record page when it
 * shows no recorder). `client`: on a client's page, so "see them all" opens
 * their own list of videos, never the business's library (a sign-in page to them).
 */
export default function RecoverUploads({ always = false, client = false }: { always?: boolean; client?: boolean }) {
  const path = usePathname() ?? "";
  const router = useRouter();
  const [done, setDone] = useState<string[]>([]);
  const [waiting, setWaiting] = useState<number | null>(null);
  const own = !always && (path.startsWith("/record") || path.startsWith("/v/"));
  // Part of a recording the server finished early is kept in this browser: the Record page offers it as a file. Not
  // said there (the recorder says it) or on a client's pages.
  const [leftover, setLeftover] = useState(false);
  const askLeftover = !client && !path.startsWith("/record");

  useEffect(() => {
    const look = () => {
      if (askLeftover) void listLeftovers().then((l) => setLeftover(l.length > 0), () => {});
    };
    look();
    if (own) return;
    recoverInterrupted((id, s) => {
      setDone((d) => [...d, s.replyTo ?? id]);
      router.refresh();
    }, setWaiting)
      .catch(() => {})
      .finally(look);
  }, [own, router, askLeftover]);

  // Stopped moments ago somewhere else: the server finishes it once it's sure the recording isn't still going.
  if (waiting !== null && !done.length)
    return (
      <div role="status" data-testid="recovering-upload" className="border-t border-line bg-surface px-4 py-2 text-center text-sm text-muted">
        Finishing a recording that was interrupted. It&rsquo;ll be ready {readyIn(waiting)}.
      </div>
    );
  if (!done.length)
    return leftover ? (
      <div role="status" data-testid="leftover-upload" className="border-t border-warn-line bg-warn-bg px-4 py-2 text-center text-sm text-warn-fg">
        Part of a recording couldn&rsquo;t be added to your library and is kept in this browser.{" "}
        <Link className="font-medium underline" href="/record">Save it as a file</Link>
      </div>
    ) : null;
  return (
    <div role="status" data-testid="recovered-uploads" className="border-t border-ok-line bg-ok-bg px-4 py-2 text-center text-sm text-ok-fg">
      Finished uploading {done.length === 1 ? "a recording that was interrupted" : `${done.length} recordings that were interrupted`}.{" "}
      {done.length === 1 ? (
        <Link className="font-medium underline" href={`/v/${done[0]}`}>View it</Link>
      ) : (
        <Link className="font-medium underline" href={client ? "/inbox" : "/library"}>{client ? "See your videos" : "See your library"}</Link>
      )}
      <button onClick={() => setDone([])} className="ml-3 text-ok-fg hover:text-ok-fg" aria-label="Dismiss">✕</button>
    </div>
  );
}
