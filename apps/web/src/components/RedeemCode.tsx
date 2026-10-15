"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Have a discount code?" on Settings > Billing. A subscriber's code is added
 * to their subscription; without one it's kept and comes off at checkout.
 * Hidden while a discount runs, except for the note confirming the one just
 * applied (it stays rendered so the note survives the page refresh).
 */
export default function RedeemCode({ subscribed, hasDiscount }: { subscribed: boolean; hasDiscount: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ applied: boolean; code: string; summary: string }>();

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const res = await fetch("/api/billing/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "That code couldn't be used. Try again.");
    setDone(data);
    if (data.applied) router.refresh();
  }

  if (done) {
    return (
      <p className="mt-4 rounded-xl border border-ok-line bg-ok-bg p-3 text-sm text-ok-fg" data-testid="code-done">
        {done.applied ? (
          <>
            {done.code} applied: {done.summary}. It comes off your next bill.
          </>
        ) : (
          <>
            {done.code} saved: {done.summary}. It comes off at checkout when you{" "}
            <Link href="/pricing" className="font-medium underline">
              choose a plan
            </Link>
            .
          </>
        )}
      </p>
    );
  }
  if (hasDiscount) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-4 text-sm font-medium text-accent hover:underline" data-testid="have-code">
        Have a discount code?
      </button>
    );
  }
  return (
    <form onSubmit={apply} className="mt-4 grid gap-2 sm:flex sm:items-start" data-testid="code-form">
      <label className="sr-only" htmlFor="discount-code">
        Discount code
      </label>
      <input
        id="discount-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Discount code"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={40}
        required
        className="w-full rounded-xl border border-line-strong px-3 py-2 text-sm uppercase sm:w-56"
      />
      <button disabled={busy || !code.trim()} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
        {busy ? "Checking…" : subscribed ? "Apply" : "Save for checkout"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger-fg sm:basis-full">
          {error}
        </p>
      )}
    </form>
  );
}
