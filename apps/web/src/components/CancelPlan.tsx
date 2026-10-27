"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import ConfirmDialog from "./ConfirmDialog";

/**
 * Settings > Billing: cancel the plan at the end of the paid period, or undo that with "Keep my plan"
 * (api/billing/cancel). Dates come from the page, in the owner's own time zone.
 */
export default function CancelPlan({
  planName,
  periodEnd,
  cancelsOn,
  whatHappens,
}: {
  planName: string;
  /** When the paid period ends, e.g. "17 November 2026"; null if Stripe hasn't told us yet. */
  periodEnd: string | null;
  /** When the plan ends, if it's already cancelled. */
  cancelsOn: string | null;
  /** What moving to Free means for this workspace. */
  whatHappens: ReactNode;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  // Shown straight away after cancelling or keeping, while the refresh brings the rest of Billing up to date.
  const [ending, setEnding] = useState<string | null>(cancelsOn);
  useEffect(() => setEnding(cancelsOn), [cancelsOn]);
  const until = periodEnd ? `until ${periodEnd}` : "until the end of the period you've paid for";

  async function send(keep: boolean) {
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    const res = await fetch("/api/billing/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keep }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? (keep ? "Couldn't keep your plan. Try again, or choose Manage subscription." : "Couldn't cancel your plan. Try again, or choose Manage subscription."));
    setAsking(false);
    setEnding(keep ? null : (cancelsOn ?? periodEnd ?? "the end of the period you've paid for"));
    setDone(
      keep
        ? `Your ${planName} plan will keep renewing${periodEnd ? `. The next bill is on ${periodEnd}` : ""}.`
        : `Cancelled. Your ${planName} plan stays active ${until}, then your business moves to the Free plan. Changed your mind? Choose Keep my plan.`,
    );
    router.refresh();
  }

  return (
    <div id="cancel-plan" className="mt-6 scroll-mt-20 border-t border-line pt-4" data-testid="cancel-plan">
      {done && (
        <p role="status" className="mb-3 rounded-xl border border-ok-line bg-ok-bg p-3 text-sm text-ok-fg" data-testid="cancel-plan-done">
          {done}
        </p>
      )}
      {error && !asking && (
        <p role="alert" className="mb-3 rounded-xl border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg">
          {error}
        </p>
      )}
      {ending ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            Your {planName} plan is cancelled. It stays active until <span className="font-medium text-ink">{ending}</span>, then your business moves to the Free plan.
          </p>
          <button onClick={() => send(true)} disabled={busy} className="shrink-0 whitespace-nowrap rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60" data-testid="keep-plan">
            {busy ? "One moment…" : "Keep my plan"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">Cancelling stops your plan renewing. You keep {planName} {until}.</p>
          <button
            onClick={() => {
              setError(undefined);
              setAsking(true);
            }}
            className="shrink-0 self-start whitespace-nowrap rounded-xl border border-line-strong px-4 py-2 text-sm font-medium text-danger-fg hover:bg-hover sm:self-auto"
            data-testid="cancel-plan-open"
          >
            Cancel plan
          </button>
        </div>
      )}
      {asking && (
        <ConfirmDialog
          title={`Cancel your ${planName} plan?`}
          body={
            <>
              <p>
                It won&apos;t renew. You keep {planName} {until}, and you aren&apos;t charged again.
              </p>
              {whatHappens}
              <p>You can change your mind before then with Keep my plan.</p>
            </>
          }
          confirmLabel="Cancel plan"
          cancelLabel="Keep my plan"
          danger
          busy={busy}
          error={error}
          onConfirm={() => send(false)}
          onCancel={() => setAsking(false)}
          testId="cancel-confirm"
        />
      )}
    </div>
  );
}
