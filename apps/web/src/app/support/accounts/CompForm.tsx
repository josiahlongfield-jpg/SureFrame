"use client";

import { useActionState } from "react";
import { setComplimentary, setComplimentaryAi } from "./actions";

/** The internal reason for the support log, and whether the owner is emailed. */
function ReasonAndNotice() {
  return (
    <>
      <label className="mt-3 grid gap-1 text-sm text-muted">
        Reason (internal: kept in the support log, never shown to the customer)
        <textarea name="reason" required maxLength={500} rows={2} className="rounded-xl border border-line-strong px-3 py-2 text-sm" />
      </label>
      <label className="mt-3 flex items-start gap-2 text-sm text-muted">
        <input type="checkbox" name="notify" defaultChecked className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Email the owner what changed</span>
      </label>
    </>
  );
}

export default function CompForm({ plans }: { plans: { id: string; name: string }[] }) {
  const [result, action, pending] = useActionState(setComplimentary, null);
  return (
    <form action={action} className="mt-4 rounded-2xl border border-line bg-surface p-6">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input name="email" type="email" required placeholder="Their sign-in email" aria-label="Their sign-in email" className="rounded-xl border border-line-strong px-3 py-2 text-sm" />
        <select name="plan" defaultValue="STUDIO" aria-label="Complimentary plan" className="rounded-xl border border-line-strong px-3 py-2 text-sm">
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === "FREE" ? "Back to Free" : p.name}
            </option>
          ))}
        </select>
        <button disabled={pending} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <ReasonAndNotice />
      {result && <p className={`mt-3 text-sm ${result.ok ? "text-ok-fg" : "text-danger-fg"}`}>{result.message}</p>}
    </form>
  );
}

/** Founder-only: switch the AI summaries add-on on for free, for a workspace with a complimentary plan. */
export function CompAiForm() {
  const [result, action, pending] = useActionState(setComplimentaryAi, null);
  return (
    <form action={action} className="mt-4 rounded-2xl border border-line bg-surface p-6" data-testid="comp-ai">
      <p className="text-sm text-muted">
        AI transcripts and summaries, free. Only for workspaces on a free paid plan above. Tell them first: their clients will see a note that they use AI summaries.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input name="email" type="email" required placeholder="Their sign-in email" aria-label="Their sign-in email" className="rounded-xl border border-line-strong px-3 py-2 text-sm" />
        <select name="ai" defaultValue="on" className="rounded-xl border border-line-strong px-3 py-2 text-sm" aria-label="AI summaries">
          <option value="on">AI summaries on</option>
          <option value="off">AI summaries off</option>
        </select>
        <button disabled={pending} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
          {pending ? "Saving…" : "Save AI"}
        </button>
      </div>
      <ReasonAndNotice />
      {result && <p className={`mt-3 text-sm ${result.ok ? "text-ok-fg" : "text-danger-fg"}`}>{result.message}</p>}
    </form>
  );
}
