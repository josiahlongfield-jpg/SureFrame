/**
 * Repeating to-dos and reminder rules. Pure functions, safe in the browser
 * and on the server. All calendar maths happens in the business's time zone
 * so "every Sunday at 9am" stays 9am across daylight-saving changes.
 */

export type Repeat = {
  every: number;
  unit: "day" | "week" | "month";
  /** For weekly repeats: days of the week, 0 = Sunday. */
  weekdays?: number[];
  /** For monthly repeats: the day of the month to aim for (kept even after a short month). */
  monthDay?: number;
  /** Last date (YYYY-MM-DD, inclusive) an occurrence may fall on. */
  until?: string;
};

/**
 * A reminder `amount` `unit`s before the due time. With `at` (HH:MM, days or
 * weeks only) it goes out at that clock time on the day instead, so
 * {amount: 0, unit: "day", at: "09:00"} is "on the day at 9am".
 * Validation lives in scheduleSchema.ts (server only, keeps zod out of the browser bundle).
 */
export type ReminderRule = { amount: number; unit: "minute" | "hour" | "day" | "week"; at?: string };

export const PRESET_REMINDERS: { label: string; rule: ReminderRule }[] = [
  { label: "1 week before", rule: { amount: 1, unit: "week" } },
  { label: "3 days before", rule: { amount: 3, unit: "day" } },
  { label: "1 day before", rule: { amount: 1, unit: "day" } },
  { label: "On the day", rule: { amount: 0, unit: "day", at: "08:00" } },
  { label: "1 hour before", rule: { amount: 1, unit: "hour" } },
  { label: "At due time", rule: { amount: 0, unit: "minute" } },
];
export const DEFAULT_REMINDERS: ReminderRule[] = [{ amount: 1, unit: "day" }];

export const sameRule = (a: ReminderRule, b: ReminderRule) => a.amount === b.amount && a.unit === b.unit && (a.at ?? "") === (b.at ?? "");

/**
 * Roughly how long before the due time a rule fires, for listing reminders
 * earliest first. A clock-time rule counts from the end of that day, so
 * "On the day at 8am" lists before "2 hours before".
 */
const leadMinutes = (r: ReminderRule) =>
  r.amount * { minute: 1, hour: 60, day: 1440, week: 10080 }[r.unit] + (r.at ? 1440 - (Number(r.at.slice(0, 2)) * 60 + Number(r.at.slice(3))) : 0);
export const sortRules = (rules: ReminderRule[]) => [...rules].sort((a, b) => leadMinutes(b) - leadMinutes(a));

export function formatClock(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

export function ruleLabel(r: ReminderRule) {
  const at = r.at ? ` at ${formatClock(r.at)}` : "";
  if (r.amount === 0) return r.at ? `On the day${at}` : "At due time";
  if (r.amount === 1 && r.unit === "day" && r.at) return `Day before${at}`;
  return `${r.amount} ${r.unit}${r.amount === 1 ? "" : "s"} before${at}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ordinal = (n: number) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10] ?? "th");

export function repeatLabel(r: Repeat, dueLocalDay?: number) {
  const n = r.every;
  let base: string;
  if (r.unit === "day") base = n === 1 ? "Every day" : `Every ${n} days`;
  else if (r.unit === "week") {
    const days = r.weekdays?.length ? [...r.weekdays].sort().map((d) => DAY_NAMES[d]).join(", ") : "";
    base = (n === 1 ? "Every week" : `Every ${n} weeks`) + (days ? ` on ${days}` : "");
  } else {
    const day = r.monthDay ?? dueLocalDay;
    base = (n === 1 ? "Every month" : `Every ${n} months`) + (day ? ` on the ${ordinal(day)}` : "");
  }
  if (r.until) base += ` until ${new Date(r.until + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
  return base;
}

// ---- Time zone maths (no dependencies; uses Intl) ----

type Local = { y: number; m: number; d: number; h: number; mi: number };

export function localParts(date: Date, tz: string): Local & { wd: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd: DAY_NAMES.indexOf(p.weekday) };
}

/** The instant a wall-clock time in `tz` happens. */
export function fromLocal({ y, m, d, h, mi }: Local, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offset = (t: number) => {
    const l = localParts(new Date(t), tz);
    return Date.UTC(l.y, l.m - 1, l.d, l.h, l.mi) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t); // settle across a DST change
  return new Date(t);
}

/** Calendar arithmetic on a local date (normalises overflow, e.g. Jan 32 → Feb 1). */
function addDays(l: Local, days: number): Local {
  const t = new Date(Date.UTC(l.y, l.m - 1, l.d + days));
  return { ...l, y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
const weekday = (l: Local) => new Date(Date.UTC(l.y, l.m - 1, l.d)).getUTCDay();
const ymd = (l: Local) => `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;

/** When the next occurrence is due, or null when the repeat has ended. */
export function nextOccurrence(due: Date, r: Repeat, tz: string): Date | null {
  const l = localParts(due, tz);
  let next: Local;
  if (r.unit === "day") next = addDays(l, r.every);
  else if (r.unit === "week") {
    const days = r.weekdays?.length ? [...new Set(r.weekdays)].sort() : [weekday(l)];
    const today = weekday(l);
    const later = days.find((d) => d > today);
    // Another chosen day later this week, else the first chosen day `every` weeks on.
    next = later !== undefined ? addDays(l, later - today) : addDays(l, 7 * r.every - today + days[0]);
  } else {
    const total = l.m - 1 + r.every;
    const y = l.y + Math.floor(total / 12);
    const m = (total % 12) + 1;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    next = { ...l, y, m, d: Math.min(r.monthDay ?? l.d, lastDay) };
  }
  if (r.until && ymd(next) > r.until) return null;
  return fromLocal(next, tz);
}

const UNIT_MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 };

/** When a reminder rule fires for a to-do due at `due`. */
export function reminderTime(due: Date, rule: ReminderRule, tz: string): Date {
  if (rule.unit === "day" || rule.unit === "week") {
    // Calendar days, so "1 day before" a 6pm to-do is 6pm the day before even across a clock change.
    const l = localParts(due, tz);
    const day = addDays(l, -rule.amount * (rule.unit === "week" ? 7 : 1));
    const [h, mi] = rule.at ? rule.at.split(":").map(Number) : [l.h, l.mi];
    return fromLocal({ ...day, h, mi }, tz);
  }
  return new Date(due.getTime() - rule.amount * UNIT_MS[rule.unit]);
}

/**
 * Whether a rule's reminder for a to-do due at `due` can still go out: its time is still to come (one already past
 * when the to-do is saved is never scheduled) and not more than an hour after the due time (those are dropped as
 * late). The rules the reminders job applies (lib/reminders.ts), so the to-do form and list don't promise a reminder
 * that won't be sent. A time zone this browser doesn't know counts as still coming.
 */
export function reminderStillComing(due: Date, rule: ReminderRule, tz: string, now = Date.now()) {
  try {
    const at = reminderTime(due, rule, tz).getTime();
    return at > now && at - due.getTime() <= 3_600_000;
  } catch {
    return true;
  }
}

export const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
