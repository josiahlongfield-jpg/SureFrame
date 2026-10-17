import { cache } from "react";
import { isTimeZone } from "@/lib/schedule";

/**
 * The viewer's own time zone, from their browser (components/TimeZoneSync.tsx
 * keeps this cookie up to date). Signed-in pages show times in it, on the
 * server and in the browser alike, so a phone and a computer agree and the
 * page the server sent matches what the browser draws.
 */
export const TZ_COOKIE = "sf_tz";

/** This request's viewer zone on the server. Outside a page render (emails, crons) it's always empty. */
const viewer = cache(() => ({ zone: null as string | null }));

/** Set once per request from the cookie (lib/session.ts currentUser). */
export function setViewerZone(zone: string | null | undefined) {
  viewer().zone = zone && isTimeZone(zone) ? zone : null;
}

function viewerZone(): string | null {
  if (typeof document !== "undefined") {
    const raw = document.cookie.split("; ").find((c) => c.startsWith(`${TZ_COOKIE}=`))?.slice(TZ_COOKIE.length + 1);
    const zone = raw ? decodeURIComponent(raw) : null;
    return zone && isTimeZone(zone) ? zone : null;
  }
  return viewer().zone;
}

/**
 * Dates as the viewer reads them: in their own time zone when we know it
 * (signed-in pages), else the workspace's. Pages and emails are rendered on
 * the server, which runs in UTC; without this an Australian morning shows as
 * the day before.
 */
export function zoned(timeZone: string | null | undefined) {
  const zone = viewerZone() ?? (timeZone && isTimeZone(timeZone) ? timeZone : "UTC");
  const f = (opts: Intl.DateTimeFormatOptions) => {
    const fmt = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: zone });
    return (d: Date) => fmt.format(d);
  };
  return {
    zone,
    /** Oct 10, 2026 */
    day: f({ dateStyle: "medium" }),
    /** October 10, 2026 */
    longDay: f({ dateStyle: "long" }),
    /** Oct 10 */
    shortDay: f({ month: "short", day: "numeric" }),
    /** Saturday, October 10, 2026 */
    weekdayDay: f({ weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    /** 9:30 AM */
    time: f({ hour: "numeric", minute: "2-digit" }),
    /** Oct 10, 9:30 AM */
    shortDayTime: f({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    /** Oct 10, 2026, 9:30 AM */
    dayTime: f({ dateStyle: "medium", timeStyle: "short" }),
    /** "AEST" or "GMT+10": the zone's short name at that date. */
    zoneName: (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? zone,
  };
}
