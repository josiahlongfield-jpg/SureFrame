"use client";

import { useState } from "react";

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

  async function toggle() {
    if (!on && !confirm(`Add cloud backup for US$${price} a month (US$${yearlyPrice} a year on yearly billing), plus any tax? You're charged today for the rest of this billing period, then it renews with your plan.`)) return;
    if (on && !confirm(`Turn off cloud backup? Our encrypted copies of your videos will be deleted ${days} days from today, unless you save them to a device first. Unused time is credited to your next bill.`)) return;
    setBusy(true);
    setError(undefined);
    const res = await fetch("/api/billing/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !on }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (data.url) return void (window.location.href = data.url);
    if (!res.ok) return setError(data.error ?? "Could not change cloud backup");
    setOn(data.cloudBackup);
  }

  return (
    <div className="mt-6 rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-ink">Cloud backup</p>
          <p className="mt-1 text-sm text-muted">
            Your videos are end-to-end encrypted. We keep an encrypted copy so your clients can watch it, and delete it after {days} days. To keep your own copy,
            open a video and choose Save to device. Cloud backup keeps our encrypted copies until you delete them. We still can&apos;t open them.
          </p>
          <p className="mt-2 text-xs text-dim">
            Optional: US${price} a month (US${yearlyPrice} a year on yearly billing).
            {needsSubscription && " Available once you start a paid subscription."}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={on}
          aria-label="Cloud backup"
          onClick={toggle}
          disabled={busy || (!on && !canEnable)}
          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${on ? "bg-primary" : "bg-line-strong"}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-surface shadow transition ${on ? "left-6" : "left-1"}`} />
        </button>
      </div>
      {!canEnable && !on && <p className="mt-3 text-sm text-muted">Available on paid plans.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p>}
    </div>
  );
}
