"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { setComplimentary, setComplimentaryAi, type CompResult } from "./actions";

/** Sent by hand, not with <form action>, so a refusal doesn't clear what was typed. */
const sendWith = (action: (data: FormData) => void) => (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  startTransition(() => action(data));
};

/** The internal reason for the support log, and whether the owner is emailed. */
function ReasonAndNotice({ focus = false }: { focus?: boolean }) {
  return (
    <>
      <label className="mt-3 grid gap-1 text-sm text-muted">
        Reason, needed (internal: kept in the support log, never shown to the customer)
        <textarea name="reason" maxLength={500} rows={2} autoFocus={focus} className="rounded-xl border border-line-strong px-3 py-2 text-sm" />
      </label>
      <label className="mt-3 flex items-start gap-2 text-sm text-muted">
        <input type="checkbox" name="notify" defaultChecked className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Email the owner what changed</span>
      </label>
    </>
  );
}

/** Shown after a refusal because it's the support person's own business (actions.ts ownWorkspace). */
function OwnBox({ result }: { result: CompResult }) {
  if (!result?.own) return null;
  return (
    <label className="mt-3 flex items-start gap-2 text-sm font-medium text-ink" data-testid="comp-own">
      <input type="checkbox" name="own" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>Yes, my own business</span>
    </label>
  );
}

function Result({ result }: { result: CompResult }) {
  if (!result) return null;
  return (
    <p role={result.ok ? "status" : "alert"} className={`mt-3 rounded-xl p-3 text-sm ${result.ok ? "bg-ok-bg text-ok-fg" : "bg-danger-bg text-danger-fg"}`}>
      {result.message}
    </p>
  );
}

/**
 * Gives or ends a free plan. Nothing is chosen until the plan is picked, so it can't go out as the wrong one by accident;
 * "End" on the Currently free list fills in the email and Back to Free. Missing fields are said in the page, not in the
 * browser's own pop-ups.
 */
export default function CompForm({ plans, email = "", plan = "", ending }: { plans: { id: string; name: string }[]; email?: string; plan?: string; ending?: string | null }) {
  const [result, action, pending] = useActionState(setComplimentary, null);
  return (
    <form onSubmit={sendWith(action)} noValidate id="comp" className="mt-4 scroll-mt-6 rounded-2xl border border-line bg-surface p-6" data-testid="comp-form">
      {ending && !result && (
        // "End" on the Currently free list only fills this in: say so, and what's left to do (P22).
        <p role="status" className="mb-3 rounded-xl bg-warn-bg p-3 text-sm text-warn-fg" data-testid="comp-ending">
          {ending}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input name="email" type="email" defaultValue={email} placeholder="Their sign-in email" aria-label="Their sign-in email" className="rounded-xl border border-line-strong px-3 py-2 text-sm" />
        <select name="plan" defaultValue={plan} aria-label="Complimentary plan" className="rounded-xl border border-line-strong px-3 py-2 text-sm">
          <option value="" disabled>
            Choose a plan…
          </option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === "FREE" ? "Back to Free" : p.name}
            </option>
          ))}
        </select>
        <button disabled={pending} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <ReasonAndNotice focus={!!ending} />
      <OwnBox result={result} />
      <Result result={result} />
    </form>
  );
}

/** Founder-only: switch the AI summaries add-on on for free, for a workspace with a complimentary plan. */
export function CompAiForm() {
  const [result, action, pending] = useActionState(setComplimentaryAi, null);
  return (
    <form onSubmit={sendWith(action)} noValidate className="mt-4 rounded-2xl border border-line bg-surface p-6" data-testid="comp-ai">
      <p className="text-sm text-muted">
        AI transcripts and summaries, free. Only for workspaces on a free paid plan above. Tell them first: their clients will see a note that they use AI summaries.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input name="email" type="email" placeholder="Their sign-in email" aria-label="Their sign-in email" className="rounded-xl border border-line-strong px-3 py-2 text-sm" />
        <select name="ai" defaultValue="on" className="rounded-xl border border-line-strong px-3 py-2 text-sm" aria-label="AI summaries">
          <option value="on">AI summaries on</option>
          <option value="off">AI summaries off</option>
        </select>
        <button disabled={pending} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
          {pending ? "Saving…" : "Save AI"}
        </button>
      </div>
      <ReasonAndNotice />
      <OwnBox result={result} />
      <Result result={result} />
    </form>
  );
}
