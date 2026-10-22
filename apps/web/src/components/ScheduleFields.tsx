"use client";

import { useEffect, useState } from "react";
import { PRESET_REMINDERS, ruleLabel, sameRule, type ReminderRule, type Repeat } from "@/lib/schedule";

export type Schedule = {
  due: string; // datetime-local value, "" for none
  repeat: Repeat | null;
  reminders: ReminderRule[];
  remindClient: boolean;
  remindTeam: boolean;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ordinal = (n: number) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10] ?? "th");

/** "2026-10-12T09:00" for an ISO time, in this browser's time zone. */
export function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium transition ${on ? "border-primary bg-primary-soft text-accent" : "border-line-strong bg-surface text-muted hover:border-line-strong"}`;

/** Due date, repeat, reminders and who gets them, in one friendly block. */
export default function ScheduleFields({
  value,
  onChange,
  clientName,
  clientEmail,
  clientOptedOut,
  canShareReminders,
  teamLabel = "Email me",
}: {
  value: Schedule;
  onChange: (s: Schedule) => void;
  clientName?: string;
  clientEmail?: string | null;
  clientOptedOut?: boolean;
  /** The to-do is shared with a client, so the client can be reminded. */
  canShareReminders: boolean;
  /** What the team reminder checkbox says: "Email me", "Email the team"... */
  teamLabel?: string;
}) {
  const set = (patch: Partial<Schedule>) => onChange({ ...value, ...patch });
  const first = clientName?.split(" ")[0] ?? "client";

  return (
    <div className="grid gap-3 text-sm">
      <label className="flex flex-wrap items-center gap-2 text-muted">
        <span className="w-20 shrink-0">Due</span>
        <input
          type="datetime-local"
          value={value.due}
          onChange={(e) => set({ due: e.target.value, repeat: e.target.value ? follow(value.repeat, value.due, e.target.value) : null })}
          aria-label="Due date"
          className="rounded-lg border border-line-strong px-2 py-1 text-sm"
        />
        {value.due && (
          <button type="button" onClick={() => set({ due: "", repeat: null })} className="text-xs text-dim hover:text-ink">
            Clear
          </button>
        )}
      </label>
      {/* The browser's date box may show another country's order (mm/dd): the date in words, in this device's own style (O14). */}
      {value.due && <DueInWords due={value.due} />}
      {/* Repeat and reminders appear once there's a date to hang them on, rather than greyed with one looking chosen (O13, O74). */}
      {!value.due && <p className="text-xs text-dim" data-testid="schedule-extras-hint">Pick a due date to make it repeat or to get reminders.</p>}
      {value.due && <fieldset className="grid gap-3" data-testid="schedule-extras">
        <RepeatPicker due={value.due} value={value.repeat} onChange={(repeat) => set({ repeat })} />
        <div className="flex flex-wrap items-start gap-2 text-muted">
          <span className="w-20 shrink-0 pt-1">Remind</span>
          <div className="min-w-0 flex-1">
            <ReminderPicker value={value.reminders} onChange={(reminders) => set({ reminders })} />
            {value.reminders.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {canShareReminders && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={value.remindClient && !!clientEmail}
                      disabled={!clientEmail}
                      onChange={(e) => set({ remindClient: e.target.checked })}
                      className="accent-primary"
                    />
                    Email {first}
                    {!clientEmail && <span className="text-xs text-warn-fg">(add {first}&apos;s email first)</span>}
                    {clientEmail && clientOptedOut && <span className="text-xs text-warn-fg">({first} has emails turned off, so none go until they turn them back on)</span>}
                  </label>
                )}
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={value.remindTeam} onChange={(e) => set({ remindTeam: e.target.checked })} className="accent-primary" />
                  {teamLabel}
                </label>
              </div>
            )}
          </div>
        </div>
      </fieldset>}
    </div>
  );
}

/** "Thu, 29 Oct 2026, 10:00 am" (or "Thu, Oct 29, 2026, 10:00 AM"), as this device writes dates. */
function DueInWords({ due }: { due: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const d = new Date(due);
    if (Number.isNaN(d.getTime())) return setText("");
    try {
      setText(new Intl.DateTimeFormat(navigator.languages?.length ? [...navigator.languages] : undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d));
    } catch {
      setText(d.toString());
    }
  }, [due]);
  if (!text) return null;
  return (
    <p className="-mt-2 text-xs text-dim sm:pl-[5.5rem]" data-testid="due-words">
      Due {text}
    </p>
  );
}

type RepeatChoice = "none" | "day" | "weekdays" | "week" | "2week" | "month" | "custom";

/**
 * Moving the due date moves a repeat that was tied to it ("every month on the
 * 5th" becomes "on the 20th"), so the saved rule matches what the picker shows.
 */
function follow(r: Repeat | null, oldDue: string, newDue: string): Repeat | null {
  if (!r) return r;
  const was = oldDue ? new Date(oldDue) : null;
  const now = new Date(newDue);
  if (Number.isNaN(now.getTime())) return r;
  if (r.unit === "month" && (!was || r.monthDay === undefined || r.monthDay === was.getDate())) return { ...r, monthDay: now.getDate() };
  if (r.unit === "week" && was && r.weekdays?.length === 1 && r.weekdays[0] === was.getDay()) return { ...r, weekdays: [now.getDay()] };
  return r;
}

function choiceFor(r: Repeat | null, dueDay: number, dueDate: number): RepeatChoice {
  if (!r) return "none";
  const wd = r.weekdays ?? [];
  if (r.until) return "custom";
  if (r.unit === "day" && r.every === 1) return "day";
  if (r.unit === "week" && r.every === 1 && wd.join() === "1,2,3,4,5") return "weekdays";
  if (r.unit === "week" && (wd.length === 0 || (wd.length === 1 && wd[0] === dueDay))) return r.every === 1 ? "week" : r.every === 2 ? "2week" : "custom";
  if (r.unit === "month" && r.every === 1 && (r.monthDay ?? dueDate) === dueDate) return "month";
  return "custom";
}

function RepeatPicker({ due, value, onChange }: { due: string; value: Repeat | null; onChange: (r: Repeat | null) => void }) {
  const d = new Date(due);
  const dueDay = d.getDay();
  const dueDate = d.getDate();
  const [custom, setCustom] = useState(choiceFor(value, dueDay, dueDate) === "custom");
  const choice = custom ? "custom" : choiceFor(value, dueDay, dueDate);

  function pick(c: RepeatChoice) {
    setCustom(c === "custom");
    if (c === "none") onChange(null);
    else if (c === "day") onChange({ every: 1, unit: "day" });
    else if (c === "weekdays") onChange({ every: 1, unit: "week", weekdays: [1, 2, 3, 4, 5] });
    else if (c === "week") onChange({ every: 1, unit: "week", weekdays: [dueDay] });
    else if (c === "2week") onChange({ every: 2, unit: "week", weekdays: [dueDay] });
    else if (c === "month") onChange({ every: 1, unit: "month", monthDay: dueDate });
    else onChange(value ?? { every: 1, unit: "week", weekdays: [dueDay] });
  }

  return (
    <div className="flex flex-wrap items-start gap-2 text-muted">
      <span className="w-20 shrink-0 pt-1">Repeat</span>
      <div className="grid min-w-0 flex-1 gap-2">
        <select value={choice} onChange={(e) => pick(e.target.value as RepeatChoice)} aria-label="Repeat" className="w-fit rounded-lg border border-line-strong bg-surface px-2 py-1 text-sm">
          <option value="none">Doesn&apos;t repeat</option>
          <option value="day">Every day</option>
          <option value="weekdays">Every weekday (Mon to Fri)</option>
          <option value="week">Every week on {DAYS[dueDay]}</option>
          <option value="2week">Every 2 weeks on {DAYS[dueDay]}</option>
          <option value="month">Every month on the {ordinal(dueDate)}</option>
          <option value="custom">Custom…</option>
        </select>
        {choice === "custom" && value && (
          <div className="grid gap-2 rounded-lg bg-canvas p-3">
            <div className="flex flex-wrap items-center gap-2">
              Every
              <input
                type="number"
                min={1}
                max={365}
                value={value.every}
                onChange={(e) => onChange({ ...value, every: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
                aria-label="Repeat every"
                className="w-16 rounded-lg border border-line-strong px-2 py-1"
              />
              <select
                value={value.unit}
                onChange={(e) => {
                  const unit = e.target.value as Repeat["unit"];
                  onChange({ every: value.every, unit, until: value.until, ...(unit === "week" ? { weekdays: [dueDay] } : unit === "month" ? { monthDay: dueDate } : {}) });
                }}
                aria-label="Repeat unit"
                className="rounded-lg border border-line-strong bg-surface px-2 py-1"
              >
                <option value="day">{value.every === 1 ? "day" : "days"}</option>
                <option value="week">{value.every === 1 ? "week" : "weeks"}</option>
                <option value="month">{value.every === 1 ? "month" : "months"}</option>
              </select>
            </div>
            {value.unit === "week" && (
              <div className="flex flex-wrap gap-1" role="group" aria-label="Days of the week">
                {DAYS.map((name, i) => {
                  const on = (value.weekdays ?? [dueDay]).includes(i);
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={on}
                      aria-label={name}
                      onClick={() => {
                        const cur = value.weekdays ?? [dueDay];
                        const next = on ? cur.filter((x) => x !== i) : [...cur, i].sort();
                        if (next.length) onChange({ ...value, weekdays: next });
                      }}
                      className={`h-8 w-8 rounded-full text-xs font-semibold ${on ? "bg-primary text-on-primary" : "bg-surface text-muted ring-1 ring-line-strong"}`}
                    >
                      {name[0]}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              Ends
              <select
                value={value.until ? "on" : "never"}
                onChange={(e) => {
                  const { until: _drop, ...rest } = value;
                  void _drop;
                  onChange(e.target.value === "never" ? rest : { ...rest, until: due.slice(0, 10) });
                }}
                aria-label="Repeat ends"
                className="rounded-lg border border-line-strong bg-surface px-2 py-1"
              >
                <option value="never">Never</option>
                <option value="on">On a date</option>
              </select>
              {value.until && (
                <input
                  type="date"
                  value={value.until}
                  min={due.slice(0, 10)}
                  onChange={(e) => e.target.value && onChange({ ...value, until: e.target.value })}
                  aria-label="Repeat until"
                  className="rounded-lg border border-line-strong px-2 py-1"
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Tap the common choices, or build your own ("2 hours before", "3 days before at 7pm"). */
export function ReminderPicker({ value, onChange }: { value: ReminderRule[]; onChange: (r: ReminderRule[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState(2);
  const [unit, setUnit] = useState<ReminderRule["unit"]>("hour");
  const [useAt, setUseAt] = useState(false);
  const [at, setAt] = useState("09:00");
  const has = (r: ReminderRule) => value.some((v) => sameRule(v, r));
  const toggle = (r: ReminderRule) => onChange(has(r) ? value.filter((v) => !sameRule(v, r)) : [...value, r]);
  const customs = value.filter((v) => !PRESET_REMINDERS.some((p) => sameRule(p.rule, v)));
  const dayish = unit === "day" || unit === "week";

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Reminders">
        {PRESET_REMINDERS.map((p) => (
          <button key={p.label} type="button" aria-pressed={has(p.rule)} onClick={() => toggle(p.rule)} className={chip(has(p.rule))}>
            {p.rule.at ? `${p.label} (${ruleLabel(p.rule).replace("On the day at ", "")})` : p.label}
          </button>
        ))}
        {customs.map((r) => (
          <button key={ruleLabel(r)} type="button" aria-pressed onClick={() => toggle(r)} className={chip(true)} title="Remove">
            {ruleLabel(r)} ×
          </button>
        ))}
        {!adding && value.length < 10 && (
          <button type="button" onClick={() => setAdding(true)} className="rounded-full border border-dashed border-line-strong px-3 py-1 text-xs font-medium text-muted hover:border-line-strong">
            + Custom
          </button>
        )}
      </div>
      {adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas p-3">
          <input type="number" min={0} max={365} value={amount} onChange={(e) => setAmount(Math.max(0, Math.min(365, Number(e.target.value) || 0)))} aria-label="Reminder amount" className="w-16 rounded-lg border border-line-strong px-2 py-1" />
          <select value={unit} onChange={(e) => setUnit(e.target.value as ReminderRule["unit"])} aria-label="Reminder unit" className="rounded-lg border border-line-strong bg-surface px-2 py-1">
            <option value="minute">minutes</option>
            <option value="hour">hours</option>
            <option value="day">days</option>
            <option value="week">weeks</option>
          </select>
          before
          {dayish && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={useAt} onChange={(e) => setUseAt(e.target.checked)} className="accent-primary" />
              at
              <input type="time" value={at} disabled={!useAt} onChange={(e) => setAt(e.target.value)} aria-label="Reminder time" className="rounded-lg border border-line-strong px-2 py-1 disabled:opacity-50" />
            </label>
          )}
          <button
            type="button"
            onClick={() => {
              const r: ReminderRule = { amount, unit, ...(dayish && useAt ? { at } : {}) };
              if (!has(r)) onChange([...value, r]);
              setAdding(false);
            }}
            className="rounded-lg bg-solid px-3 py-1 text-xs font-medium text-white"
          >
            Add reminder
          </button>
          <button type="button" onClick={() => setAdding(false)} className="text-xs text-dim">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
