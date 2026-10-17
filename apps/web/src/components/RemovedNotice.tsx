"use client";

import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";

const DISMISSED = "sureframe.removedNotice";

/** Tells someone plainly that they were taken off a team, in the account of their own they're now in. */
export default function RemovedNotice({ teams }: { teams: { id: string; name: string }[] }) {
  const key = `${DISMISSED}:${teams.map((t) => t.id).join(",")}`;
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(!localStorage.getItem(key));
    } catch {
      setShow(true);
    }
  }, [key]);
  if (!show) return null;
  return (
    <div role="status" data-testid="removed-from-team" className="border-t border-warn-line bg-warn-bg">
      <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-sm text-warn-fg sm:px-6">
        <p className="min-w-0 flex-1">
          <span className="font-medium">You&apos;re no longer on {teams.map((t) => t.name).join(" or ")}&apos;s team.</span> An owner or admin removed you, so its videos and
          clients aren&apos;t here. This is your own {BRAND.name} account. If that&apos;s a mistake, ask them for a new invite link.
        </p>
        <button
          onClick={() => {
            try {
              localStorage.setItem(key, "1");
            } catch {}
            setShow(false);
          }}
          className="shrink-0 rounded-lg px-2 py-0.5 hover:bg-hover"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
