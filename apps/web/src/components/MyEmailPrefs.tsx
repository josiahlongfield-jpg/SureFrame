"use client";

import { useState } from "react";

/** A staff member's own team emails: whether they hear about their clients' replies. */
export default function MyEmailPrefs({ initial }: { initial: { replyEmails: boolean } }) {
  const [replyEmails, setReplyEmails] = useState(initial.replyEmails);
  const [note, setNote] = useState<string>();

  async function save(on: boolean) {
    setReplyEmails(on);
    setNote(undefined);
    const res = await fetch("/api/account/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ replyEmails: on }) });
    if (!res.ok) {
      setReplyEmails(!on);
      return setNote("Couldn't save. Try again.");
    }
    setNote("Saved.");
  }

  return (
    <div className="mt-4 grid gap-2 text-sm">
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={replyEmails} onChange={(e) => save(e.target.checked)} aria-label="Email me when my clients reply" className="mt-0.5 accent-primary" />
        <span>
          <span className="font-medium text-ink">Email me when my clients reply</span>
          <span className="block text-xs text-dim">Several replies within 15 minutes come as one email. Replies always show in the app either way.</span>
        </span>
      </label>
      <p className="text-xs text-dim">
        Reminder emails for your to-dos follow &ldquo;Email me too&rdquo; on each to-do (set your default under Reminders).
        Owners and admins choose their own team emails separately; this doesn&apos;t change what they see.
      </p>
      {note && <p role="status" className="text-sm text-muted">{note}</p>}
    </div>
  );
}
