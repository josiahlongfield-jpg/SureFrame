"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";

/**
 * The one-off "what we changed this month" note for owners and admins who agreed to our terms before this month's
 * wording updates (decision 6): those updates kept the same versions, so nobody is asked to agree again, but this says
 * they happened and links to the list on /legal/archive. Dismissed once per person in this browser (localStorage,
 * keyed by their account), and shown until MONTHLY_CHANGES.until (lib/legal.ts) at the latest. AppHeader decides who sees it.
 */
export default function ChangesNotice({ userId, month, monthKey }: { userId: string; month: string; monthKey: string }) {
  const key = `sureframe.changesNotice:${monthKey}:${userId}`;
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
    <div role="status" data-testid="changes-notice" className="border-t border-line bg-surface-2">
      <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-sm text-ink sm:px-6">
        <p className="min-w-0 flex-1">
          <span className="font-medium">What we changed in {month}:</span> we reworded parts of our Terms, Privacy Policy and Data Processing Agreement
          to explain more of what {BRAND.name} already does. Nothing is taken away, so there&apos;s nothing new to agree to.{" "}
          <Link href="/legal/archive#wording-updates" className="font-medium underline" data-testid="changes-notice-link">
            See what changed
          </Link>
        </p>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(key, "1");
            } catch {}
            setShow(false);
          }}
          className="shrink-0 rounded-lg px-2 py-0.5 text-muted hover:bg-hover hover:text-ink"
          data-testid="changes-notice-dismiss"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
