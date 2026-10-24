"use client";

import { useState } from "react";

/**
 * "Emails to you": whether they hear about their clients' replies. Staff
 * members set it for themselves; an owner working alone sets it here too
 * (owners and admins on a team choose more on the same page, NotifyPrefs).
 */
export default function MyEmailPrefs({ initial, owner = false }: { initial: { replyEmails: boolean }; owner?: boolean }) {
  const [replyEmails, setReplyEmails] = useState(initial.replyEmails);
  const [note, setNote] = useState<string>();

  async function save(on: boolean) {
    setReplyEmails(on);
    setNote(undefined);
    const res = owner
      ? await fetch("/api/team/prefs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ replyNotify: on ? "MINE" : "OFF" }) })
      : await fetch("/api/account/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ replyEmails: on }) });
    if (!res.ok) {
      setReplyEmails(!on);
      return setNote("Couldn't save. Try again.");
    }
    setNote(on ? "Saved. You're emailed when clients reply." : "Saved. Reply emails are off; replies still show in the app.");
  }

  return (
    <div className="mt-4 grid gap-2 text-sm">
      {/* A switch beside the words, like the other on/off settings, so it reads as something to press, not a label and a status (S56). */}
      <div className="flex items-start justify-between gap-4">
        <span>
          <span className="font-medium text-ink" id="reply-emails-label">{owner ? "Email me when clients reply" : "Email me when my clients reply"}</span>
          <span className="block text-xs text-dim">Several replies within 15 minutes come as one email. Replies always show in the app either way.</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-dim" data-testid="reply-emails-state">{replyEmails ? "On" : "Off"}</span>
          <button
            type="button"
            role="switch"
            aria-checked={replyEmails}
            aria-labelledby="reply-emails-label"
            onClick={() => void save(!replyEmails)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${replyEmails ? "bg-primary" : "bg-line-strong"}`}
            data-testid="reply-emails"
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-surface shadow transition ${replyEmails ? "left-6" : "left-1"}`} />
          </button>
        </span>
      </div>
      {owner ? (
        <div className="text-xs text-dim" data-testid="always-sent">
          <p>These always come, as they&apos;re about losing something or about your account:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>about 24 hours before a recording is deleted from our servers (without cloud backup)</li>
            <li>when a client asks you for their personal link again</li>
            <li>sign-in links, and notices about your account, plan and our Terms</li>
          </ul>
          <p className="mt-1">Payment receipts and invoices come from Link, Stripe&apos;s payment service.</p>
        </div>
      ) : (
        <p className="text-xs text-dim">
          Reminder emails for your to-dos follow &ldquo;Email me too&rdquo; on each to-do (set your default under To-dos/Reminders &gt; Reminder settings).
          Owners and admins choose their own team emails separately; this doesn&apos;t change what they see.
        </p>
      )}
      {note && <p role="status" className="text-sm text-muted">{note}</p>}
    </div>
  );
}
