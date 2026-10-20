"use client";

import { useEffect, useState } from "react";
import { KEEP_DAYS, KEEP_NEXT_COOKIE } from "@/lib/activity";

/**
 * "Keep me signed in on this device", off by default. The choice is kept in
 * a cookie on this browser, so it applies to whichever way they sign in and
 * only when the sign-in finishes on this device (src/middleware.ts).
 */
export default function KeepSignedIn() {
  const [keep, setKeep] = useState(false);
  useEffect(() => {
    document.cookie = keep ? `${KEEP_NEXT_COOKIE}=1; path=/; max-age=86400; samesite=lax` : `${KEEP_NEXT_COOKIE}=; path=/; max-age=0`;
  }, [keep]);
  return (
    <label className="flex items-start gap-2.5 text-sm text-muted">
      <input type="checkbox" name="keep" value="1" checked={keep} onChange={(e) => setKeep(e.target.checked)} data-testid="keep-signed-in" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
      <span>
        Keep me signed in on this device
        <span className="block text-xs text-dim">For {KEEP_DAYS} days. Only on a device you don&apos;t share.</span>
      </span>
    </label>
  );
}
