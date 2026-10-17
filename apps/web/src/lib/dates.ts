import { isTimeZone } from "@/lib/schedule";

/**
 * Dates as the business reads them, in the workspace's time zone. Pages and
 * emails are rendered on the server, which runs in UTC; without this an
 * Australian morning shows as the day before.
 */
export function zoned(timeZone: string | null | undefined) {
  const zone = timeZone && isTimeZone(timeZone) ? timeZone : "UTC";
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
