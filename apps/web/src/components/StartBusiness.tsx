"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PAID_PLANS, PLANS, type Interval, type PaidPlan } from "@/lib/plans";

/**
 * The paid plans someone can start their own business on from /start (Decision 4): staff from an invite don't get a
 * Free business of their own, so Free isn't offered here. Each button opens Stripe Checkout
 * (api/billing/start-business); the business is made once it's paid.
 */
export default function StartBusiness({ picked }: { picked?: PaidPlan | null }) {
  const [interval, setPeriod] = useState<Interval>("month");
  const [busy, setBusy] = useState<PaidPlan | null>(null);
  const [error, setError] = useState<string>();

  async function start(plan: PaidPlan) {
    setBusy(plan);
    setError(undefined);
    try {
      const res = await fetch("/api/billing/start-business", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, interval }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data.code === "TERMS_REQUIRED") {
        window.location.assign(`/agree?next=${encodeURIComponent("/start")}`);
        return;
      }
      if (!res.ok || !data.url) throw new Error(data.error ?? "Something went wrong. Try again in a moment.");
      window.location.assign(data.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="mt-6" data-testid="start-business">
      <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-xl border border-line-strong p-1 text-sm">
        {(["month", "year"] as const).map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={interval === i}
            onClick={() => setPeriod(i)}
            className={`rounded-lg px-3 py-1.5 font-medium ${interval === i ? "bg-primary text-on-primary" : "text-muted hover:bg-hover"}`}
          >
            {i === "month" ? "Monthly" : "Yearly (2 months free)"}
          </button>
        ))}
      </div>
      <ul className="mt-4 grid gap-3">
        {PAID_PLANS.map((plan) => {
          const p = PLANS[plan];
          const price = interval === "year" ? `US$${p.priceYearly} a year` : `US$${p.priceMonthly} a month`;
          return (
            <li
              key={plan}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-surface p-4 ${picked === plan ? "border-primary" : "border-line"}`}
              data-testid={`start-plan-${plan}`}
            >
              <div className="min-w-0">
                <p className="font-semibold text-ink">
                  {p.name} <span className="font-normal text-muted">· {price}</span>
                </p>
                <p className="text-sm text-muted">
                  {p.clientSeats} clients included · {p.staffSeats === 1 ? "just you" : `${p.staffSeats} staff logins (yours included)`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => start(plan)}
                disabled={!!busy}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60"
                data-testid={`start-${plan}`}
              >
                {busy === plan ? "Opening checkout…" : `Start on ${p.name}`}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-dim">Prices are in US dollars, plus any tax. <a href="/pricing" className="font-medium text-accent hover:underline">See everything each plan includes</a></p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}

/** After paying: the business is made when Stripe tells us (lib/newBusiness.ts), so this page looks again until it's there. */
export function WaitForBusiness() {
  const router = useRouter();
  useEffect(() => {
    const t = window.setInterval(() => router.refresh(), 2500);
    return () => window.clearInterval(t);
  }, [router]);
  return null;
}
