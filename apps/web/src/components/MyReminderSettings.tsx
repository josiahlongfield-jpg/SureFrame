"use client";

import { useMemo, useState } from "react";
import { reminderEmail } from "@/lib/reminderEmail";
import { ruleLabel, sortRules, type ReminderRule } from "@/lib/schedule";
import { ReminderPicker } from "./ScheduleFields";

type Defaults = { reminders: ReminderRule[]; remindClient: boolean; remindTeam: boolean };

type Props = {
  business: { name: string; timezone: string | null; reminderMessage: string; reminderReplyTo: string; defaults: Defaults };
  /** Whether the member has their own defaults (else the business's apply). */
  ownDefaults: boolean;
  /** Their effective defaults. */
  defaults: Defaults;
  reminderMessage: string;
  reminderReplyTo: string;
};

/**
 * A staff member's own reminder settings for the clients they look after.
 * Blank fields and "Use the business's defaults" fall back to what the owner
 * or an admin set for the business.
 */
export default function MyReminderSettings({ business, ...initial }: Props) {
  const [own, setOwn] = useState(initial.ownDefaults);
  const [d, setD] = useState<Defaults>(initial.defaults);
  const [message, setMessage] = useState(initial.reminderMessage);
  const [replyTo, setReplyTo] = useState(initial.reminderReplyTo);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string>();
  const touch = () => setStatus("idle");
  const setDefaults = (patch: Partial<Defaults>) => {
    setOwn(true);
    setD((cur) => ({ ...cur, ...patch }));
    touch();
  };

  const tz = business.timezone ?? "UTC";
  const preview = useMemo(() => {
    const now = new Date();
    const due = new Date(now.getTime() + 86_400_000);
    due.setHours(9, 0, 0, 0);
    return reminderEmail({ business: business.name, message: message.trim() || business.reminderMessage, due, now, tz, link: "#", unsubscribe: "#" });
  }, [business.name, business.reminderMessage, message, tz]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(undefined);
    const res = await fetch("/api/account/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reminderDefaults: own ? d.reminders : null,
        remindClientDefault: own ? d.remindClient : null,
        remindTeamDefault: own ? d.remindTeam : null,
        reminderMessage: message,
        reminderReplyTo: replyTo.trim(),
      }),
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
    <form onSubmit={save} className="mt-8 grid gap-6 lg:grid-cols-[1fr_23.75rem]">
      <div className="grid gap-6">
        <section className="grid gap-3 rounded-2xl border border-line bg-surface p-6" data-testid="business-settings">
          <h2 className="font-semibold text-ink">Your business</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-dim">Business name</dt><dd className="font-medium text-ink">{business.name}</dd></div>
            <div><dt className="text-xs text-dim">Time zone</dt><dd className="font-medium text-ink">{tz.replace(/_/g, " ")}</dd></div>
          </dl>
          <p className="text-xs text-dim">Set by an owner or admin. Reminders and repeats follow this clock.</p>
        </section>

        <section className="grid gap-4 rounded-2xl border border-line bg-surface p-6">
          <div>
            <h2 className="font-semibold text-ink">Default reminders for your new to-dos</h2>
            <p className="mt-1 text-xs text-dim">Pre-selected whenever you give a to-do a due date. You can still change them on any to-do.</p>
          </div>
          <ReminderPicker value={d.reminders} onChange={(reminders) => setDefaults({ reminders })} />
          <p className="text-xs text-dim">
            {d.reminders.length ? `Currently: ${sortRules(d.reminders).map(ruleLabel).join(", ")}.` : "No reminders by default."}
          </p>
          <div className="grid gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={d.remindClient} onChange={(e) => setDefaults({ remindClient: e.target.checked })} className="accent-primary" />
              Email the client for to-dos shared with them
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={d.remindTeam} onChange={(e) => setDefaults({ remindTeam: e.target.checked })} className="accent-primary" />
              Email me too
            </label>
          </div>
          <p className="text-xs text-dim" data-testid="defaults-source">
            {own ? "Your own defaults." : "Using your business's defaults."}{" "}
            {own && (
              <button type="button" onClick={() => { setOwn(false); setD(business.defaults); touch(); }} className="font-medium text-accent hover:underline">
                Use the business&apos;s defaults
              </button>
            )}
          </p>
        </section>

        <section className="grid gap-4 rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-semibold text-ink">Emails to your clients</h2>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-muted">Reply-to email</span>
            <span className="text-xs text-dim">
              If one of your clients replies to a reminder or a new-video email, it goes here.
              {business.reminderReplyTo ? ` Leave blank to use the business's (${business.reminderReplyTo}).` : " Leave blank to use the business's setting (none yet)."}
            </span>
            <input type="email" value={replyTo} onChange={(e) => { setReplyTo(e.target.value); touch(); }} placeholder={business.reminderReplyTo || "you@yourbusiness.com"} aria-label="Your reply-to email" className={field} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-muted">Personal message</span>
            <span className="text-xs text-dim">Added to every reminder your clients get. Leave blank to use the business&apos;s message.</span>
            <textarea
              value={message}
              onChange={(e) => { setMessage(e.target.value.slice(0, 500)); touch(); }}
              rows={4}
              placeholder={business.reminderMessage || "See you soon! Reply to this email if you need to move things around."}
              aria-label="Your personal message"
              className={`resize-y ${field}`}
            />
            <span className="text-right text-xs text-dim">{message.length}/500</span>
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
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-dim">What your clients see</p>
        <div className="overflow-hidden rounded-2xl border border-line bg-surface text-ink">
          <div className="border-b border-line px-4 py-3 text-xs text-dim">
            <p><span className="text-dim">From:</span> {business.name}</p>
            <p className="mt-0.5 font-medium text-ink" data-testid="preview-subject">{preview.subject}</p>
          </div>
          <div className="text-left" data-testid="preview-body" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
        <p className="mt-3 text-xs text-dim">
          These apply to the clients assigned to you. To-dos are end-to-end encrypted, so emails never include what the to-do says. Every email has a link to stop reminders.
        </p>
      </aside>
    </form>
  );
}
