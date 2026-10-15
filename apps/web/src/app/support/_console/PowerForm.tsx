"use client";

import { useSearchParams } from "next/navigation";
import { startTransition, useActionState, type ReactNode } from "react";
import type { NoticeReason } from "@/lib/support/admin";
import { runPower } from "./actions";

/** The reason categories, as the admin picks them (the email words them in full: lib/support/admin.ts NOTICE_REASONS). */
const CATEGORIES = [
  ["terms", "Breach of the Terms of Service"],
  ["unlawful", "Unlawful or harmful use"],
  ["fraud", "Fraud, payment fraud or false information"],
  ["law", "The law requires it"],
  ["safety", "To protect people from harm"],
  ["security", "To protect the account's security"],
  ["request", "The account holder asked"],
] as const satisfies readonly (readonly [NoticeReason, string])[];

const field = "w-full rounded-xl border border-line-strong px-3 py-2 text-sm";

type Props = {
  power: string;
  hidden: Record<string, string>;
  title: string;
  intro?: ReactNode;
  submit: string;
  danger?: boolean;
  /** Ask for the reason category the customer's email gives. */
  category?: boolean;
  /** What the admin has to type to confirm. */
  confirm?: string;
  /** The "Email …" checkbox's label; ticked by default. Omitted when the power emails nobody. */
  notify?: string;
  children?: ReactNode;
  testId?: string;
};

/**
 * One support power: collapsed to its title until opened (the console is used
 * on a phone), then its own fields, the reason category the email gives, the
 * internal reason, the typed confirmation for destructive ones, and "Email
 * the owner" ticked by default. Errors show here and keep what was typed;
 * success reloads the page with a "Done" banner and starts every form afresh.
 */
export default function PowerForm(props: Props) {
  return <Power key={useSearchParams().get("done") ?? ""} {...props} />;
}

function Power({ power, hidden, title, intro, submit, danger = false, category = false, confirm, notify, children, testId }: Props) {
  const [state, action, pending] = useActionState(runPower, null);
  return (
    <details className={`group rounded-2xl border bg-surface ${danger ? "border-danger-line" : "border-line"}`} data-testid={testId ?? `power-${power}`}>
      <summary className={`cursor-pointer list-none p-4 text-sm font-semibold ${danger ? "text-danger-fg" : "text-ink"}`}>
        <span className="mr-2 inline-block text-dim transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>
        {title}
      </summary>
      <form
        className="grid gap-3 border-t border-line p-4"
        // Sent by hand, not with <form action>, so a refusal doesn't clear the reason the admin typed.
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => action(data));
        }}
      >
        <input type="hidden" name="power" value={power} />
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {intro && <div className="text-sm text-muted">{intro}</div>}
        {children}
        {category && (
          <label className="grid gap-1 text-sm text-muted">
            Reason the email gives
            <select name="category" required defaultValue="" className={field}>
              <option value="" disabled>
                Choose…
              </option>
              {CATEGORIES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="grid gap-1 text-sm text-muted">
          Reason (internal: kept in the support log, never shown to the customer)
          <textarea name="reason" required maxLength={500} rows={2} className={field} />
        </label>
        {confirm && (
          <label className="grid gap-1 text-sm text-muted">
            <span>
              Type <code className="break-all rounded bg-surface-2 px-1 font-semibold text-ink">{confirm}</code> to confirm
            </span>
            <input name="confirm" required autoComplete="off" autoCapitalize="none" spellCheck={false} className={field} />
          </label>
        )}
        {notify && (
          <label className="flex items-start gap-2 text-sm text-muted">
            <input type="checkbox" name="notify" defaultChecked className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {notify}
              <span className="block text-xs text-dim">Untick only where the law or someone&rsquo;s safety requires it.</span>
            </span>
          </label>
        )}
        <button
          disabled={pending}
          className={`justify-self-start rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${danger ? "bg-red-600 hover:bg-red-700" : "bg-primary hover:bg-primary-hover"}`}
        >
          {pending ? "Working…" : submit}
        </button>
        {state && !state.ok && (
          <p role="alert" className="rounded-xl bg-danger-bg p-3 text-sm text-danger-fg">
            {state.message}
          </p>
        )}
      </form>
    </details>
  );
}

/** An extra checkbox inside a power's form. */
export function Check({ name, label, hint, defaultChecked = false }: { name: string; label: string; hint?: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-start gap-2 text-sm text-muted">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {label}
        {hint && <span className="block text-xs text-dim">{hint}</span>}
      </span>
    </label>
  );
}
