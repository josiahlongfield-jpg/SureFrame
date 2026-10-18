/**
 * Dates on the support pages and in support's emails: always Queensland time, written one way
 * ("18 Oct 2026", "18 Oct 2026, 9:40 am AEST"), so support quotes the customer the same day their
 * email shows. Queensland has no daylight saving, so it's AEST all year.
 */
export const SUPPORT_ZONE = "Australia/Brisbane";

const dayFmt = new Intl.DateTimeFormat("en-AU", { timeZone: SUPPORT_ZONE, day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-AU", { timeZone: SUPPORT_ZONE, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

/** 18 Oct 2026 */
export const qldDay = (d: Date | string | null | undefined) => (d ? dayFmt.format(new Date(d)) : "");
/** 18 Oct 2026, 9:40 am AEST */
export const qldTime = (d: Date | string | null | undefined) => (d ? timeFmt.format(new Date(d)) : "");
