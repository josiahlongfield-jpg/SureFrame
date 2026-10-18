"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * "Have a discount code?" on Settings > Billing. Without a subscription the
 * code is kept and comes off at checkout when they choose a plan. A running
 * subscription takes a code only when moving up a plan, so for a subscriber
 * (`subscribed`) the code is checked and the reply says how to use it.
 */
export default function RedeemCode({ subscribed = false }: { subscribed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ code: string; summary: string; subscribed?: boolean; biggest?: boolean }>();

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const res = await fetch("/api/billing/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "That code couldn't be used. Try again.");
    setDone(data);
  }

  if (done?.subscribed) {
    return (
      <p className="mt-4 rounded-xl border border-ok-line bg-ok-bg p-3 text-sm text-ok-fg" data-testid="code-done">
        {done.code} works: {done.summary}.{" "}
        {done.biggest ? (
          <>
            On a running plan, codes only come off when you move up to a bigger plan, and you&apos;re already on the biggest one, so it can&apos;t be used here.
            Questions? Ask in Help.
          </>
        ) : (
          <>
            On a running plan, codes come off when you move up to a bigger plan:{" "}
            <Link href="/pricing" className="font-medium underline">
              choose it on Pricing
            </Link>{" "}
            and enter the code in the switch box.
          </>
        )}
      </p>
    );
  }
  if (done) {
    return (
      <p className="mt-4 rounded-xl border border-ok-line bg-ok-bg p-3 text-sm text-ok-fg" data-testid="code-done">
        {done.code} saved: {done.summary}. It comes off at checkout when you{" "}
        <Link href="/pricing" className="font-medium underline">
          choose a plan
        </Link>
        .
      </p>
    );
  }
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
        {busy ? "Checking…" : subscribed ? "Check code" : "Save for checkout"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger-fg sm:basis-full">
          {error}
        </p>
      )}
    </form>
  );
}
