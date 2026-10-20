/**
 * How the library folds videos away as they get older (src/app/library/page.tsx):
 * the last 7 days one folder per day, the four weeks or so before that one
 * folder per week (Monday to Sunday), and anything older one folder per
 * month. A week holds its days and a month its weeks, so a year of daily
 * videos is a dozen rows, not hundreds. A folder with only one thing inside
 * shows that thing's videos straight away rather than another folder.
 */

/** How the library is laid out, remembered in this browser (components/LibraryTools.tsx LibraryViewSwitch). */
export const VIEW_COOKIE = "sf_lib_view";
export const LAYOUT_COOKIE = "sf_lib_layout";
/** The client's "Your videos" page keeps its own tiles or list choice (src/app/inbox/page.tsx). */
export const INBOX_LAYOUT_COOKIE = "sf_inbox_layout";

export type GroupKind = "day" | "week" | "month";
export type Group<T> = {
  /** Unique across the library, so a folder opened in this tab stays open (components/DayFolder.tsx). */
  key: string;
  kind: GroupKind;
  label: string;
  items: T[];
  /** The folders inside; none means its videos are shown directly. */
  children?: Group<T>[];
};

const DAY_MS = 86_400_000;

/** The calendar day a moment falls on in a time zone, as a whole number of days (days since 1 Jan 1970 there). */
export function localDay(d: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Math.floor(Date.UTC(n("year"), n("month") - 1, n("day")) / DAY_MS);
}

// A day number read back as a date: midnight UTC on that calendar day, so it's formatted in UTC.
const asDate = (day: number) => new Date(day * DAY_MS);
const fmt = (opts: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" });
  return (day: number) => f.format(asDate(day));
};
const shortWeekday = fmt({ weekday: "long", month: "short", day: "numeric" });
const monthDay = fmt({ month: "short", day: "numeric" });
const dayOnly = fmt({ day: "numeric" });
const monthYear = fmt({ month: "long", year: "numeric" });
const yearOf = (day: number) => asDate(day).getUTCFullYear();
const monthOf = (day: number) => asDate(day).getUTCMonth();
/** The Monday on or before a day. */
const mondayOf = (day: number) => day - ((asDate(day).getUTCDay() + 6) % 7);

/**
 * "Oct 12 to 18", "Sep 28 to Oct 4", with the year when it isn't this one. Cut to `from`..`to` where the
 * rest of the week is elsewhere (the days shown on their own, or another month).
 */
function weekLabel(monday: number, today: number, from: number, to: number) {
  const first = Math.max(monday, from);
  const last = Math.min(monday + 6, to);
  const range = first === last ? monthDay(first) : monthOf(first) === monthOf(last) ? `${monthDay(first)} to ${dayOnly(last)}` : `${monthDay(first)} to ${monthDay(last)}`;
  return yearOf(last) === yearOf(today) ? range : `${range}, ${yearOf(last)}`;
}

/** Runs of items (already newest first) that share a key, in order. */
function runs<T>(items: T[], keyOf: (item: T) => string | number) {
  const out: { key: string | number; items: T[] }[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const last = out[out.length - 1];
    if (last?.key === key) last.items.push(item);
    else out.push({ key, items: [item] });
  }
  return out;
}

/** A folder holding a single folder shows what that one holds instead. */
function flatten<T>(children: Group<T>[]): Group<T>[] | undefined {
  return children.length === 1 ? children[0].children : children;
}

/** Group videos (newest first) by age, in the viewer's time zone. */
export function groupByAge<T extends { createdAt: Date }>(items: T[], zone: string, now: Date): Group<T>[] {
  const today = localDay(now, zone);
  const dayCut = today - 6;
  const weekCut = mondayOf(today) - 28;
  const dayOf = (v: T) => localDay(v.createdAt, zone);

  const dayGroup = (day: number, list: T[]): Group<T> => ({
    key: `${asDate(day).toISOString().slice(0, 10)}`,
    kind: "day",
    // "Saturday, Oct 17", with the year only when it isn't this one.
    label: day === today ? "Today" : day === today - 1 ? "Yesterday" : yearOf(day) === yearOf(today) ? shortWeekday(day) : `${shortWeekday(day)}, ${yearOf(day)}`,
    items: list,
  });
  const weekGroup = (monday: number, list: T[], from = -Infinity, to = Infinity): Group<T> => ({
    key: `w${asDate(monday).toISOString().slice(0, 10)}`,
    kind: "week",
    label: weekLabel(monday, today, from, to),
    items: list,
    children: flatten(runs(list, dayOf).map((r) => dayGroup(r.key as number, r.items))),
  });

  const out: Group<T>[] = [];
  const recent = items.filter((v) => dayOf(v) >= dayCut);
  const weeks = items.filter((v) => dayOf(v) < dayCut && dayOf(v) >= weekCut);
  const older = items.filter((v) => dayOf(v) < weekCut);
  for (const r of runs(recent, dayOf)) out.push(dayGroup(r.key as number, r.items));
  for (const r of runs(weeks, (v) => mondayOf(dayOf(v)))) out.push(weekGroup(r.key as number, r.items, -Infinity, dayCut - 1));
  for (const r of runs(older, (v) => {
    const d = asDate(dayOf(v));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  })) {
    const first = dayOf(r.items[0]);
    // The month's first and last days, so a week across two months is named by its days in this one.
    const d = asDate(first);
    const start = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY_MS);
    const end = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY_MS) - 1;
    out.push({
      key: `m${r.key}`,
      kind: "month",
      label: monthYear(first),
      items: r.items,
      // A week that started last month is listed in both months, each with its own days.
      children: flatten(runs(r.items, (v) => mondayOf(dayOf(v))).map((w) => ({ ...weekGroup(w.key as number, w.items, start, Math.min(end, weekCut - 1)), key: `m${r.key}w${w.key}` }))),
    });
  }
  return out;
}

/** One folder per month, for the videos inside a client's folder; `prefix` keeps each client's remembered apart. */
export function groupByMonth<T extends { createdAt: Date }>(items: T[], zone: string, prefix: string): Group<T>[] {
  return runs(items, (v) => {
    const d = asDate(localDay(v.createdAt, zone));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }).map((r) => ({ key: `${prefix}m${r.key}`, kind: "month" as const, label: monthYear(localDay(r.items[0].createdAt, zone)), items: r.items }));
}
