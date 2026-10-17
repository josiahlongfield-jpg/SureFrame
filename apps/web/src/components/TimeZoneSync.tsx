"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { TZ_COOKIE } from "@/lib/dates";
import { browserTimeZone } from "@/lib/schedule";

/**
 * Tells the server this browser's time zone, so signed-in pages show times
 * in the viewer's own zone (lib/dates.ts), and redraws once if the page was
 * drawn in another. A business with no time zone yet gets this one, for its
 * reminders and emails (owners and admins only); keepalive, so moving on
 * to another page straight away doesn't cancel it.
 */
export default function TimeZoneSync({ shownZone, setWorkspace }: { shownZone: string; setWorkspace: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const tz = browserTimeZone();
    const saved = document.cookie.split("; ").find((c) => c.startsWith(`${TZ_COOKIE}=`))?.slice(TZ_COOKIE.length + 1);
    if (saved !== encodeURIComponent(tz)) document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
    if (tz !== shownZone) router.refresh();
    if (setWorkspace) {
      void fetch("/api/workspace/settings", { method: "PATCH", keepalive: true, headers: { "Content-Type": "application/json", "x-sf-background": "1" }, body: JSON.stringify({ timezone: tz }) }).catch(() => {});
    }
  }, [shownZone, setWorkspace, router]);
  return null;
}
