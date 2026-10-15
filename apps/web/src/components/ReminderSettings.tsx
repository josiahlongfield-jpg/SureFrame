"use client";

import { useEffect, useMemo, useState } from "react";
import { reminderEmail } from "@/lib/reminderEmail";
import { browserTimeZone, ruleLabel, sortRules, type ReminderRule } from "@/lib/schedule";
import { ReminderPicker } from "./ScheduleFields";

type Settings = {
  name: string;
  timezone: string | null;
  reminderDefaults: ReminderRule[];
  remindClientDefault: boolean;
  remindTeamDefault: boolean;
  reminderMessage: string;
  reminderReplyTo: string;
};

export default function ReminderSettings({ initial }: { initial: Settings }) {
  const [s, setS] = useState<Settings>(initial);
  const [zones, setZones] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string>();
  const set = (patch: Partial<Settings>) => {
    setS((cur) => ({ ...cur, ...patch }));
    setStatus("idle");
  };

  useEffect(() => {
    try {
      setZones((Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"));
    } catch {
      setZones([]);
    }
    if (!initial.timezone) setS((cur) => ({ ...cur, timezone: browserTimeZone() }));
  }, [initial.timezone]);

  const tz = s.timezone ?? "UTC";
  const preview = useMemo(() => {
    const now = new Date();
    const due = new Date(now.getTime() + 86_400_000);
    due.setHours(9, 0, 0, 0);
    return reminderEmail({
      business: s.name || "Your business",
      message: s.reminderMessage,
      due,
      now,
      tz,
      link: "#",
      unsubscribe: "#",
    });
  }, [s.name, s.reminderMessage, tz]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(undefined);
    const res = await fetch("/api/workspace/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...s, timezone: tz }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus("idle");
      return setError(data.error ?? "Could not save");
    }
    setStatus("saved");
  }

  const field = "rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none";

  return (
    <form onSubmit={save} className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="grid gap-6">
        <section className="grid gap-4 rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-semibold text-ink">Your business</h2>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-muted">Business name</span>
            <span className="text-xs text-dim">Shown to clients on their page and as the sender of reminder emails.</span>
            <input value={s.name} onChange={(e) => set({ name: e.target.value })} required maxLength={80} aria-label="Business name" className={field} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-muted">Time zone</span>
            <span className="text-xs text-dim">Reminders and repeats follow this clock, including daylight saving.</span>
            <select value={tz} onChange={(e) => set({ timezone: e.target.value })} aria-label="Time zone" className={field}>
              {(zones.length ? zones : [tz]).map((z) => (
                <option key={z} value={z}>{z.replace(/_/g, " ")}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-muted">Reply-to email</span>
            <span className="text-xs text-dim">If a client replies to a reminder or new-video email, it goes here. Left blank, those emails ask clients not to reply.</span>
            <input type="email" value={s.reminderReplyTo} onChange={(e) => set({ reminderReplyTo: e.target.value })} placeholder="you@yourbusiness.com" aria-label="Reply-to email" className={field} />
          </label>
        </section>

        <section className="grid gap-4 rounded-2xl border border-line bg-surface p-6">
          <div>
            <h2 className="font-semibold text-ink">Default reminders for new to-dos</h2>
            <p className="mt-1 text-xs text-dim">Pre-selected whenever you give a to-do a due date. Tap to turn on or off, or add your own.</p>
          </div>
          <ReminderPicker value={s.reminderDefaults} onChange={(reminderDefaults) => set({ reminderDefaults })} />
          <p className="text-xs text-dim">
            {s.reminderDefaults.length ? `Currently: ${sortRules(s.reminderDefaults).map(ruleLabel).join(", ")}.` : "No reminders by default."}
          </p>
          <div className="grid gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.remindClientDefault} onChange={(e) => set({ remindClientDefault: e.target.checked })} className="accent-primary" />
              Email the client for to-dos shared with them
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.remindTeamDefault} onChange={(e) => set({ remindTeamDefault: e.target.checked })} className="accent-primary" />
              Email whoever looks after the client too
            </label>
          </div>
        </section>

        <section className="grid gap-2 rounded-2xl border border-line bg-surface p-6">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-ink">Personal message</span>
            <span className="text-xs text-dim">Added to every reminder your clients get. For example how to reschedule, or a word of encouragement.</span>
            <textarea
              value={s.reminderMessage}
              onChange={(e) => set({ reminderMessage: e.target.value.slice(0, 500) })}
              rows={4}
              placeholder="See you soon! Reply to this email if you need to move things around."
              aria-label="Personal message"
              className={`resize-y ${field}`}
            />
            <span className="text-right text-xs text-dim">{s.reminderMessage.length}/500</span>
          </label>
        </section>

        <div className="flex items-center gap-3">
          <button disabled={status === "saving"} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50">
            {status === "saving" ? "Saving…" : "Save changes"}
          </button>
          {status === "saved" && <span role="status" className="text-sm text-ok-fg">Saved</span>}
          {error && <span role="alert" className="text-sm text-danger-fg">{error}</span>}
        </div>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-dim">What your client sees</p>
        <div data-theme="light" className="overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-sm">
          <div className="border-b border-line px-4 py-3 text-xs text-dim">
            <p><span className="text-dim">From:</span> {s.name || "Your business"}</p>
            <p className="mt-0.5 font-medium text-ink" data-testid="preview-subject">{preview.subject}</p>
          </div>
          <div className="text-left" data-testid="preview-body" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
        <p className="mt-3 text-xs text-dim">
          To-dos are end-to-end encrypted, so emails never include what the to-do says. Clients tap through to read it. Every email has a link to stop reminders.
        </p>
      </aside>
    </form>
  );
}
