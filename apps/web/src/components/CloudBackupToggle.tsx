"use client";

import { useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

export default function CloudBackupToggle({
  enabled,
  canEnable,
  price,
  yearlyPrice,
  days,
  needsSubscription = false,
}: {
  enabled: boolean;
  canEnable: boolean;
  price: number;
  yearlyPrice: number;
  days: number;
  /** On a free plan we gave: backup can be added once they start paying. */
  needsSubscription?: boolean;
}) {
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<string>();

  async function toggle() {
    setBusy(true);
    setDone(undefined);
    setError(undefined);
    const res = await fetch("/api/billing/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !on }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setAsking(false);
    if (data.url) return void (window.location.href = data.url);
    if (!res.ok) return setError(data.error ?? "Could not change cloud backup");
    setOn(data.cloudBackup);
    setDone(
      data.cloudBackup
        ? "Cloud backup is on. Our encrypted copies of your videos are now kept until you delete them."
        : `Cloud backup is off. Our encrypted copies of your videos will be deleted ${days} days from today, unless you save them to a device first.`,
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-line bg-surface p-6">
      {/* The switch sits beside the heading only; the description runs full width under both, so a phone has no empty column (D2). */}
      <div className="flex items-center justify-between gap-4">
        <p className="font-semibold text-ink">Cloud backup</p>
        <button
          role="switch"
          aria-checked={on}
          aria-label="Cloud backup"
          onClick={() => {
            setError(undefined);
            setAsking(true);
          }}
          disabled={busy || (!on && !canEnable)}
          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${on ? "bg-primary" : "bg-line-strong"}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-surface shadow transition ${on ? "left-6" : "left-1"}`} />
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">
        Your videos are end-to-end encrypted. We keep an encrypted copy so your clients can watch it, and delete it after {days} days. To keep your own copy,
        open a video and choose Save to device. Cloud backup keeps our encrypted copies until you delete them. We still can&apos;t open them.
      </p>
      <p className="mt-2 text-xs text-dim">
        Optional: US${price} a month (US${yearlyPrice} a year on yearly billing).
        {needsSubscription && " Available once you start a paid subscription."}
      </p>
      {!canEnable && !on && <p className="mt-3 text-sm text-muted">Available on paid plans.</p>}
      {error && <p role="alert" className="mt-3 rounded-xl border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg">{error}</p>}
      {done && <p role="status" className="mt-3 rounded-xl border border-ok-line bg-ok-bg p-3 text-sm text-ok-fg" data-testid="backup-done">{done}</p>}
      {asking && (
        <ConfirmDialog
          title={on ? "Turn off cloud backup?" : "Add cloud backup?"}
          body={
            on ? (
              <p>
                Our encrypted copies of your videos will be deleted {days} days from today, unless you save them to a device first. Unused time is credited to your
                next bill.
              </p>
            ) : (
              <p>
                US${price} a month (US${yearlyPrice} a year on yearly billing), plus any tax. You&apos;re charged today for the rest of this billing period, then it
                renews with your plan.
              </p>
            )
          }
          confirmLabel={on ? "Turn off cloud backup" : "Add cloud backup"}
          danger={on}
          busy={busy}
          onConfirm={toggle}
          onCancel={() => setAsking(false)}
          testId="backup-confirm"
        />
      )}
    </div>
  );
}
