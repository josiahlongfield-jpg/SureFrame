"use client";

import Link from "next/link";
import { senderName } from "@/lib/brand";
import { useEffect, useMemo, useState } from "react";
import { reminderEmail } from "@/lib/reminderEmail";
import { ruleLabel, sortRules, type ReminderRule } from "@/lib/schedule";
import { ReminderPicker } from "./ScheduleFields";

/** The business's name, time zone, reply-to and message are shown here but set elsewhere (Decision 13): the name and the
 * client emails on Settings > Branding, the time zone on Settings > Account. Only the default reminders are saved here. */
type Shown = { name: string; timezone: string | null; reminderMessage: string; reminderReplyTo: string };
type Settings = {
  reminderDefaults: ReminderRule[];
  remindClientDefault: boolean;
  remindTeamDefault: boolean;
};

export default function ReminderSettings({ initial }: { initial: Settings & Shown }) {
  const shown: Shown = { name: initial.name, timezone: initial.timezone, reminderMessage: initial.reminderMessage, reminderReplyTo: initial.reminderReplyTo };
  const [s, setS] = useState<Settings>({ reminderDefaults: initial.reminderDefaults, remindClientDefault: initial.remindClientDefault, remindTeamDefault: initial.remindTeamDefault });
  // The preview's dates depend on the clock and this device's zone, so it's drawn once the page is in the browser.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string>();
  const set = (patch: Partial<Settings>) => {
    setS((cur) => ({ ...cur, ...patch }));
    setStatus("idle");
  };

  const tz = shown.timezone ?? "UTC";
  const preview = useMemo(() => {
    if (!now) return null;
    const due = new Date(now.getTime() + 86_400_000);
    due.setHours(9, 0, 0, 0);
    return reminderEmail({
      business: shown.name || "Your business",
      message: shown.reminderMessage,
      due,
      now,
      tz,
      link: "#",
      unsubscribe: "#",
    });
  }, [now, shown.name, shown.reminderMessage, tz]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(undefined);
    const res = await fetch("/api/workspace/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // Only the default reminders: the name, client emails and time zone are saved on their own pages.
      body: JSON.stringify(s),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus("idle");
      return setError(data.error ?? "Could not save");
    }
    setStatus("saved");
  }

  return (
    <form onSubmit={save} className="mt-8 grid gap-6 lg:grid-cols-[1fr_23.75rem]">
      <div className="grid gap-6">
        <section className="grid gap-4 rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-semibold text-ink">Your business</h2>
          <p className="grid gap-1 text-sm" data-testid="reminders-business">
            <span className="font-medium text-muted">Business name</span>
            <span>
              <span className="text-ink">{shown.name}</span>{" "}
              <span className="text-dim">·</span> <Link href="/settings/branding" className="font-medium text-accent hover:underline">change it on the Branding page</Link>
            </span>
            <span className="text-xs text-dim">Shown to clients on their page and as the sender of reminder emails.</span>
          </p>
          {/* Set on Settings > Account (Decision 13): one place for it, linked from here. */}
          <p className="grid gap-1 text-sm" data-testid="reminders-time-zone">
            <span className="font-medium text-muted">Time zone</span>
            <span>
              <span className="text-ink">{tz.replace(/_/g, " ")}</span>{" "}
              <span className="text-dim">·</span> <Link href="/settings/account#time-zone" className="font-medium text-accent hover:underline">change it on the Account page</Link>
            </span>
            <span className="text-xs text-dim">Reminders and repeats follow this clock, including daylight saving.</span>
          </p>
          {/* Set on Settings > Branding > Client emails (Decision 13). */}
          <p className="grid gap-1 text-sm" data-testid="reminders-client-emails">
            <span className="font-medium text-muted">Reply-to email and personal message</span>
            <span>
              <span className="text-ink">{shown.reminderReplyTo || "No reply-to email"}</span>
              {shown.reminderMessage ? <span className="text-dim"> · a personal message is set</span> : null}{" "}
              <span className="text-dim">·</span> <Link href="/settings/branding#client-emails" className="font-medium text-accent hover:underline">change them in Branding, Client emails</Link>
            </span>
            <span className="text-xs text-dim">Where clients&apos; replies to reminder and new-video emails go, and the note added to every reminder.</span>
          </p>
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

        <div className="flex items-center gap-3">
          <button disabled={status === "saving"} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
            {status === "saving" ? "Saving…" : "Save changes"}
          </button>
          {status === "saved" && <span role="status" className="text-sm text-ok-fg">Saved</span>}
          {error && <span role="alert" className="text-sm text-danger-fg">{error}</span>}
        </div>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-dim">What your client sees</p>
        <div className="overflow-hidden rounded-2xl border border-line bg-surface text-ink">
          <div className="border-b border-line px-4 py-3 text-xs text-dim">
            <p data-testid="preview-from"><span className="text-dim">From:</span> {senderName(shown.name || "Your business")}</p>
            <p className="mt-0.5 font-medium text-ink" data-testid="preview-subject">{preview?.subject ?? "\u00a0"}</p>
          </div>
          <div className="min-h-40 text-left" data-testid="preview-body" dangerouslySetInnerHTML={{ __html: preview?.html ?? "" }} />
        </div>
        <p className="mt-3 text-xs text-dim">
          To-dos are end-to-end encrypted, so emails never include what the to-do says. Clients tap through to read it. Every email has a link to stop reminders.
        </p>
      </aside>
    </form>
  );
}
