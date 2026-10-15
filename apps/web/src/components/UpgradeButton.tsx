"use client";

import { useState } from "react";
import { PLANS, type Interval, type PaidPlan } from "@/lib/plans";

type Preview = {
  mode: "change";
  dueToday: number;
  plan: number;
  addOns: number;
  credit: number;
  tax: number;
  discount: number;
  balance: number;
  leftover: number;
  currency: string;
  paymentMethod: string | null;
  cancelling?: boolean;
};

const money = (cents: number, currency: string) => {
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  // "US$" like every other price on the site, not a bare "$".
  return currency.toUpperCase() === "USD" ? amount.replace("$", "US$") : amount;
};

export default function UpgradeButton({ plan, interval = "month", featured = false }: { plan: PaidPlan; interval?: Interval; featured?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [confirm, setConfirm] = useState<Preview>();
  const name = PLANS[plan].name;
  const price = interval === "year" ? PLANS[plan].priceYearly : PLANS[plan].priceMonthly;

  async function post(path: string, body: object) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent("/pricing")}`;
      return null;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Something went wrong");
    return data;
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const goToCheckout = () =>
    run(async () => {
      const data = await post("/api/billing/checkout", { plan, interval });
      if (data?.url) window.location.href = data.url;
    });

  // Already subscribed? Show what changes and what's charged before doing it.
  const start = () =>
    run(async () => {
      const data = await post("/api/billing/preview", { plan, interval });
      if (!data) return;
      if (data.mode === "checkout") {
        const go = await post("/api/billing/checkout", { plan, interval });
        if (go?.url) window.location.href = go.url;
        return;
      }
      if (data.mode === "current") setNote(`You're already on ${name}${interval === "year" ? " yearly" : ""}.`);
      else setConfirm(data);
      setBusy(false);
    });

  const changeCard = () =>
    run(async () => {
      const data = await post("/api/billing/card", { back: "/pricing" });
      if (data?.url) window.location.href = data.url;
    });

  return (
    <>
      <button
        onClick={start}
        disabled={busy}
        className={`w-full rounded-xl px-4 py-3 font-semibold disabled:opacity-60 ${featured ? "bg-primary text-on-primary hover:bg-primary-hover" : "bg-solid text-on-solid hover:bg-solid-hover"}`}
      >
        {busy && !confirm ? "One moment…" : `Get ${name}`}
      </button>
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
      {error && !confirm && <p className="mt-2 text-sm text-danger-fg">{error}</p>}
      {confirm && (
        <div role="dialog" aria-modal="true" aria-labelledby={`confirm-${plan}`} className="fixed inset-0 z-50 flex items-center justify-center bg-solid/40 p-4" data-testid="plan-confirm">
          <div className="w-full max-w-md rounded-2xl bg-surface p-6 text-left shadow-xl">
            <h2 id={`confirm-${plan}`} className="text-lg font-semibold text-ink">
              Switch to {name}?
            </h2>
            <p className="mt-3 text-sm text-muted">
              {name} is US${price} a {interval}, plus any tax. Your extra clients, cloud backup and AI add-on carry over (the AI add-on moves to {name}&apos;s price). Extra
              staff logins are only on Studio and Agency.
            </p>
            <dl className="mt-4 space-y-1 rounded-xl bg-canvas p-4 text-sm text-muted" data-testid="due-today">
              <div className="flex justify-between gap-4">
                <dt>{name}, from today</dt>
                <dd>{money(confirm.plan, confirm.currency)}</dd>
              </div>
              {confirm.addOns > 0 && (
                <div className="flex justify-between gap-4">
                  <dt>Extra clients and add-ons, from today</dt>
                  <dd>{money(confirm.addOns, confirm.currency)}</dd>
                </div>
              )}
              {confirm.credit > 0 && (
                <div className="flex justify-between gap-4">
                  <dt>Unused time on your current plan</dt>
                  <dd>−{money(confirm.credit, confirm.currency)}</dd>
                </div>
              )}
              {confirm.discount > 0 && (
                <div className="flex justify-between gap-4">
                  <dt>Discount</dt>
                  <dd>−{money(confirm.discount, confirm.currency)}</dd>
                </div>
              )}
              {confirm.tax > 0 && (
                <div className="flex justify-between gap-4">
                  <dt>Tax</dt>
                  <dd>{money(confirm.tax, confirm.currency)}</dd>
                </div>
              )}
              {confirm.balance > 0 && (
                <div className="flex justify-between gap-4">
                  <dt>Credit already on your account</dt>
                  <dd>−{money(confirm.balance, confirm.currency)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4 border-t border-line pt-2 font-semibold text-ink">
                <dt>Due today</dt>
                <dd>{money(confirm.dueToday, confirm.currency)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm text-muted">
              {confirm.dueToday > 0 && <>Charged to {confirm.paymentMethod ? <strong>{confirm.paymentMethod}</strong> : "the card you subscribed with"}. </>}
              {confirm.leftover > 0 && <>The remaining {money(confirm.leftover, confirm.currency)} comes off your next bills. </>}
              {confirm.cancelling
                ? "Your subscription is still set to cancel, so it won't renew. To keep it going, choose Manage subscription on the Billing page and renew it."
                : `Your plan then renews on this date each ${interval}.`}
            </p>
            {error && <p className="mt-3 text-sm text-danger-fg">{error}</p>}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button onClick={goToCheckout} disabled={busy} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
                {busy ? "Switching…" : confirm.dueToday > 0 ? `Pay ${money(confirm.dueToday, confirm.currency)} and switch` : "Switch plan"}
              </button>
              {confirm.dueToday > 0 && (
                <button onClick={changeCard} disabled={busy} className="rounded-xl border border-line-strong px-4 py-2.5 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60">
                  Use a different card
                </button>
              )}
              <button onClick={() => { setConfirm(undefined); setError(undefined); }} disabled={busy} className="rounded-xl px-4 py-2.5 text-sm font-medium text-muted hover:text-ink disabled:opacity-60">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
