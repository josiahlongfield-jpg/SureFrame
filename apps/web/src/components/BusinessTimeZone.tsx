"use client";

import { useEffect, useState } from "react";
import { browserTimeZone } from "@/lib/schedule";
import TimeZonePicker from "./TimeZonePicker";

const field = "w-full max-w-md rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm focus:border-primary";

/**
 * Settings > Account: the business's time zone (Decision 13, moved here from To-dos/Reminders). Owners and admins
 * change it; staff see it. Due dates, reminders and repeats follow it, including daylight saving.
 */
export default function BusinessTimeZone({ business, timezone, canEdit }: { business: string; timezone: string | null; canEdit: boolean }) {
  const [saved, setSaved] = useState(timezone);
  const [value, setValue] = useState(timezone ?? "UTC");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  // A business without one yet starts on this device's zone (as the reminders page did).
  useEffect(() => {
    if (!timezone) setValue(browserTimeZone());
  }, [timezone]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(undefined);
    const r = await fetch("/api/workspace/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timezone: value }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) return setMsg({ ok: false, text: d.error ?? "Could not save the time zone. Check your connection and try again." });
    setSaved(value);
    setMsg({ ok: true, text: "Saved. Upcoming reminders now follow this time zone." });
  }

  return (
    <section id="time-zone" className="mt-6 scroll-mt-6 rounded-2xl border border-line bg-surface p-6" data-testid="business-time-zone">
      <h2 className="font-semibold text-ink">{business}&apos;s time zone</h2>
      <p className="mt-1 text-sm text-muted">
        Due dates, to-do reminders and repeats follow this clock, including daylight saving. It&apos;s one time zone for the whole business.
        {!canEdit && " An owner or admin can change it here."}
      </p>
      {canEdit ? (
        <form onSubmit={save} className="mt-4 grid gap-3">
          <TimeZonePicker value={value} onChange={(z) => { setValue(z); setMsg(undefined); }} className={field} />
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={busy || value === saved} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
              {busy ? "Saving…" : "Save time zone"}
            </button>
            {msg && <p role="status" className={`text-sm ${msg.ok ? "text-ok-fg" : "text-danger-fg"}`}>{msg.text}</p>}
          </div>
        </form>
      ) : (
        <p className="mt-3 text-sm font-medium text-ink" data-testid="business-time-zone-value">{(timezone ?? "UTC").replace(/_/g, " ")}</p>
      )}
    </section>
  );
}
