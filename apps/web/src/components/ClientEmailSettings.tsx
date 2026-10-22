"use client";

import Link from "next/link";
import { useState } from "react";
import { emailProblem, phoneProblem, CONTACT_EMAIL_MAX, CONTACT_PHONE_MAX } from "@/lib/clientContact";
import ClientContactLine from "./ClientContactLine";

const field = "mt-1 w-full max-w-md rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm";
const saveButton = "rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60";

async function patch(body: Record<string, unknown>) {
  const r = await fetch("/api/workspace/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  return { ok: !!r?.ok, data: d as Record<string, unknown> & { error?: string } };
}

/**
 * Settings > Branding: how the business's own clients can reach it (Decision 5). Optional email and phone, on every
 * plan. Shown on client pages, in the client help chat when it can't answer, and in emails to clients.
 */
export function ClientContactForm({ business, email: initialEmail, phone: initialPhone }: { business: string; email: string; phone: string }) {
  const [saved, setSaved] = useState({ email: initialEmail, phone: initialPhone });
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const emailError = emailProblem(email);
  const phoneError = phoneProblem(phone);
  const changed = email.trim() !== saved.email || phone.replace(/\s+/g, " ").trim() !== saved.phone;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (emailError || phoneError) return;
    setBusy(true);
    setMsg(undefined);
    const { ok, data } = await patch({ contactEmail: email.trim(), contactPhone: phone.trim() });
    setBusy(false);
    if (!ok) return setMsg({ ok: false, text: data.error ?? "Could not save. Check your connection and try again." });
    const next = { email: String(data.contactEmail ?? ""), phone: String(data.contactPhone ?? "") };
    setSaved(next);
    setEmail(next.email);
    setPhone(next.phone);
    setMsg({ ok: true, text: next.email || next.phone ? "Saved. Your clients see this now." : "Saved. No contact line is shown to your clients." });
  }

  const shown = { email: email.trim() && !emailError ? email.trim() : null, phone: phone.trim() && !phoneError ? phone.trim() : null };
  return (
    <form onSubmit={save} id="client-contact" className="mt-6 scroll-mt-6 rounded-2xl border border-line bg-surface p-6" data-testid="client-contact-form">
      <h2 className="font-semibold text-ink">How clients can reach you</h2>
      <p className="mt-1 text-sm text-muted">
        Optional. Shown to your clients on their pages, in their help chat when it can&apos;t answer, and in the emails we send them. Leave both blank to show nothing.
      </p>
      <div className="mt-4 grid gap-4">
        <label className="grid gap-0.5 text-sm">
          <span className="font-medium text-muted">Contact email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setMsg(undefined); }}
            maxLength={CONTACT_EMAIL_MAX}
            autoComplete="off"
            placeholder="hello@yourbusiness.com"
            aria-label="Contact email"
            aria-invalid={!!emailError}
            className={field}
          />
          {emailError && <span role="alert" className="text-sm text-danger-fg" data-testid="contact-email-error">{emailError}</span>}
        </label>
        <label className="grid gap-0.5 text-sm">
          <span className="font-medium text-muted">Contact phone</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setMsg(undefined); }}
            maxLength={CONTACT_PHONE_MAX}
            autoComplete="off"
            placeholder="+61 400 000 000"
            aria-label="Contact phone"
            aria-invalid={!!phoneError}
            className={field}
          />
          {phoneError && <span role="alert" className="text-sm text-danger-fg" data-testid="contact-phone-error">{phoneError}</span>}
        </label>
      </div>
      {(shown.email || shown.phone) && (
        <div className="mt-4 rounded-xl bg-surface-2 px-3 py-2" data-testid="contact-preview">
          <p className="text-xs font-semibold uppercase tracking-wide text-dim">Your clients see</p>
          <ClientContactLine business={business || "Your business"} contact={shown} className="mt-1" />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button disabled={busy || !changed || !!emailError || !!phoneError} className={saveButton}>
          {busy ? "Saving…" : "Save contact details"}
        </button>
        {msg && <p role="status" className={`text-sm ${msg.ok ? "text-ok-fg" : "text-danger-fg"}`}>{msg.text}</p>}
      </div>
    </form>
  );
}

/**
 * Settings > Branding > Client emails (Decision 13): the reply-to address and the personal message on the emails
 * clients get. The business's own settings, moved here from To-dos/Reminders; staff still set their own there.
 */
export function ClientEmailsForm({ replyTo: initialReplyTo, message: initialMessage }: { replyTo: string; message: string }) {
  const [saved, setSaved] = useState({ replyTo: initialReplyTo, message: initialMessage });
  const [replyTo, setReplyTo] = useState(initialReplyTo);
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const replyError = emailProblem(replyTo);
  const changed = replyTo.trim() !== saved.replyTo || message.trim() !== saved.message;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (replyError) return;
    setBusy(true);
    setMsg(undefined);
    const { ok, data } = await patch({ reminderReplyTo: replyTo.trim(), reminderMessage: message });
    setBusy(false);
    if (!ok) return setMsg({ ok: false, text: data.error ?? "Could not save. Check your connection and try again." });
    setSaved({ replyTo: replyTo.trim(), message: message.trim() });
    setReplyTo(replyTo.trim());
    setMessage(message.trim());
    setMsg({ ok: true, text: "Saved." });
  }

  return (
    <form onSubmit={save} id="client-emails" className="mt-6 scroll-mt-6 rounded-2xl border border-line bg-surface p-6" data-testid="client-emails">
      <h2 className="font-semibold text-ink">Client emails</h2>
      <p className="mt-1 text-sm text-muted">
        How the reminder and new-video emails your clients get read. Staff can set their own for the clients they look after, on To-dos/Reminders &gt; Reminder
        settings; where they don&apos;t, these apply.
      </p>
      <div className="mt-4 grid gap-4">
        <label className="grid gap-0.5 text-sm">
          <span className="font-medium text-muted">Reply-to email</span>
          <span className="text-xs text-dim">If a client replies to a reminder or new-video email, it goes here. Left blank, those emails ask clients not to reply.</span>
          <input
            type="email"
            value={replyTo}
            onChange={(e) => { setReplyTo(e.target.value); setMsg(undefined); }}
            maxLength={200}
            placeholder="you@yourbusiness.com"
            aria-label="Reply-to email"
            aria-invalid={!!replyError}
            className={field}
          />
          {replyError && <span role="alert" className="text-sm text-danger-fg">{replyError}</span>}
        </label>
        <label className="grid gap-0.5 text-sm">
          <span className="font-medium text-muted">Personal message</span>
          <span className="text-xs text-dim">Added to every reminder your clients get. For example how to reschedule, or a word of encouragement.</span>
          <textarea
            value={message}
            onChange={(e) => { setMessage(e.target.value.slice(0, 500)); setMsg(undefined); }}
            rows={4}
            placeholder="See you soon! Reply to this email if you need to move things around."
            aria-label="Personal message"
            className={`resize-y ${field}`}
          />
          <span className="max-w-md text-right text-xs text-dim">{message.length}/500</span>
        </label>
      </div>
      <p className="mt-2 text-xs text-dim">
        See a reminder email with your message on <Link href="/todos?tab=reminders" className="font-medium text-accent hover:underline">To-dos/Reminders &gt; Reminder settings</Link>.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button disabled={busy || !changed || !!replyError} className={saveButton}>
          {busy ? "Saving…" : "Save client emails"}
        </button>
        {msg && <p role="status" className={`text-sm ${msg.ok ? "text-ok-fg" : "text-danger-fg"}`}>{msg.text}</p>}
      </div>
    </form>
  );
}
