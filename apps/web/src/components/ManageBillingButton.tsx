"use client";

import { useState } from "react";

export default function ManageBillingButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function go() {
    setBusy(true);
    setError(undefined);
    const res = await fetch("/api/billing/portal", { method: "POST" }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) ?? {};
    setBusy(false);
    if (data.url) return void (window.location.href = data.url);
    setError(data.error ?? "Couldn't open Stripe's billing page. Check your connection and try again.");
  }
  return (
    <>
      <button onClick={go} disabled={busy} className="rounded-xl border border-line-strong px-4 py-2 text-sm font-medium hover:bg-hover disabled:opacity-60">
        {busy ? "One moment…" : "Manage subscription"}
      </button>
      {/* Its own line, after whatever sits beside the button. */}
      {error && (
        <p role="alert" className="order-last mt-2 w-full text-sm text-danger-fg">
          {error}
        </p>
      )}
    </>
  );
}
