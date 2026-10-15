"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const DISMISSED = "framecast.namePrompt.dismissed";

/** Asks once, without blocking anything, for the name clients see on videos. */
export default function NamePrompt() {
  const path = usePathname() ?? "";
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(!localStorage.getItem(DISMISSED));
    } catch {
      setShow(true);
    }
  }, []);
  if (!show || path.startsWith("/settings/account")) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      /* private mode: it just shows again next time */
    }
    setShow(false);
  };
  return (
    <div role="status" data-testid="name-prompt" className="border-t border-primary-line bg-primary-soft">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-ink sm:px-6">
        <p>Add your name so clients see who sent their videos, like &ldquo;Sam from your business&rdquo;.</p>
        <div className="flex items-center gap-3">
          <Link href="/settings/account#name" onClick={dismiss} className="font-medium underline">Add your name</Link>
          <button onClick={dismiss} className="text-accent hover:text-ink" aria-label="Dismiss">Not now</button>
        </div>
      </div>
    </div>
  );
}
