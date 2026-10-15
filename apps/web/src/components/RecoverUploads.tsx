"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { recoverInterrupted } from "@/lib/recorder/uploader";

/**
 * Finishes recordings a crash or closed tab left in this browser, from any
 * signed-in page. The recorder and the video page run their own recovery,
 * unless `always` is set (the record page when it shows no recorder).
 */
export default function RecoverUploads({ always = false }: { always?: boolean }) {
  const path = usePathname() ?? "";
  const router = useRouter();
  const [done, setDone] = useState<string[]>([]);
  const own = !always && (path.startsWith("/record") || path.startsWith("/v/"));

  useEffect(() => {
    if (own) return;
    recoverInterrupted((id, s) => {
      setDone((d) => [...d, s.replyTo ?? id]);
      router.refresh();
    }).catch(() => {});
  }, [own, router]);

  if (!done.length) return null;
  return (
    <div role="status" data-testid="recovered-uploads" className="border-t border-ok-line bg-ok-bg px-4 py-2 text-center text-sm text-ok-fg">
      Finished uploading {done.length === 1 ? "a recording that was interrupted" : `${done.length} recordings that were interrupted`}.{" "}
      {done.length === 1 ? (
        <Link className="font-medium underline" href={`/v/${done[0]}`}>View it</Link>
      ) : (
        <Link className="font-medium underline" href="/library">See your library</Link>
      )}
      <button onClick={() => setDone([])} className="ml-3 text-ok-fg hover:text-ok-fg" aria-label="Dismiss">✕</button>
    </div>
  );
}
