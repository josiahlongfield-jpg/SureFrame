"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const DISMISSED = "framecast.repliesScopeHint.dismissed";

/**
 * On the Team page, while an owner or admin is emailed only about their own clients' replies (the default, S66):
 * says so once, so staff clients' replies aren't missed without knowing. Gone once dismissed in this browser,
 * or once the setting is changed (the page only shows it while it's "Only my own clients").
 */
export default function RepliesScopeHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(!localStorage.getItem(DISMISSED));
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      /* private mode: it just shows again next time */
    }
    setShow(false);
  };
  return (
    <p role="status" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-primary-line bg-primary-soft p-3 text-sm text-ink" data-testid="replies-scope-hint">
      <span>You&apos;re only emailed about replies from your own clients, not your staff&apos;s.</span>
      <Link href="/settings/account#emails" className="font-medium underline">Change</Link>
      <button type="button" onClick={dismiss} className="text-accent hover:text-ink">Got it</button>
    </p>
  );
}
