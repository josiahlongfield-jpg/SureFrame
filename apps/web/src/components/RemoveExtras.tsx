"use client";

import { useState } from "react";
import ConfirmDialog, { DialogButtons, DialogShell, primaryButton } from "./ConfirmDialog";

/**
 * Lowers extra client seats or staff logins the owner bought. Only unused ones
 * can go; the unused time is credited on the next bill.
 */
export default function RemoveExtras({
  extra,
  spare,
  noun,
  endpoint,
  field,
  onError,
}: {
  /** How many extras are bought now. */
  extra: number;
  /** How many of them aren't in use. */
  spare: number;
  noun: { one: string; many: string; holder: string };
  endpoint: string;
  field: "extraSeats" | "extraStaff";
  onError: (message: string) => void;
}) {
  const removable = Math.min(extra, spare);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<number>();
  if (extra <= 0) return null;
  if (removable <= 0) {
    return <p className="w-full text-xs text-dim">To stop paying for extra {noun.many}, remove {noun.holder} first; every one is in use.</p>;
  }

  const n = Math.min(qty, removable);
  const what = (k: number) => `${k} extra ${k === 1 ? noun.one : noun.many}`;

  async function remove() {
    setBusy(true);
    setError(undefined);
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: extra - n }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setAsking(false);
      return onError(data.error ?? `Could not remove ${noun.many}`);
    }
    setAsking(false);
    setDone(n);
  }

  return (
    <span className="flex flex-wrap items-center gap-2" data-testid={`remove-${field}`}>
      <span className="text-muted">Fewer needed?</span>
      <select value={Math.min(qty, removable)} onChange={(e) => setQty(Number(e.target.value))} aria-label={`Extra ${noun.many} to remove`} className="rounded-lg border border-line-strong bg-surface px-2 py-1.5">
        {Array.from({ length: Math.min(removable, 50) }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>{n} {n === 1 ? noun.one : noun.many}</option>
        ))}
      </select>
      <button onClick={() => setAsking(true)} disabled={busy} className="whitespace-nowrap rounded-lg border border-line-strong px-3 py-1.5 font-medium text-ink hover:bg-hover disabled:opacity-60" data-testid={`remove-${field}-open`}>
        Remove {n} {n === 1 ? noun.one : noun.many}
      </button>
      {asking && (
        <ConfirmDialog
          title={`Remove ${what(n)}?`}
          body={<p>You stop paying for {n === 1 ? "it" : "them"} now, and the unused time is credited to your next bill.</p>}
          confirmLabel={`Remove ${what(n)}`}
          busy={busy}
          error={error}
          onConfirm={remove}
          onCancel={() => setAsking(false)}
          testId="remove-extras-confirm"
        />
      )}
      {done !== undefined && (
        // The page reloads on OK, so the counts above it are fresh.
        <DialogShell title="Done" testId="remove-extras-done">
          <p role="status" className="mt-3 text-sm text-ok-fg">
            {what(done)} removed. The unused time comes off your next bill.
          </p>
          <DialogButtons>
            <button onClick={() => window.location.reload()} className={primaryButton}>OK</button>
          </DialogButtons>
        </DialogShell>
      )}
    </span>
  );
}
