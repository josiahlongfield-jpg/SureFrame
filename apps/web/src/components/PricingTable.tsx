"use client";

import Link from "next/link";
import { useState } from "react";
import UpgradeButton from "@/components/UpgradeButton";
import { PLANS, storageLine, type Interval, type PaidPlan } from "@/lib/plans";
import type { Plan } from "@prisma/client";

const ORDER = ["FREE", "SOLO", "STUDIO", "AGENCY"] as const;
const FEATURED = "STUDIO";

/** The signed-in workspace's plan, so its card is marked and its buttons say what they'd really do. */
export type CurrentPlan = {
  plan: Plan;
  /** Billed monthly or yearly; null without a subscription (Free, or a plan we gave). */
  interval: Interval | null;
  /** Only the owner can change the plan. */
  owner: boolean;
};

const staticBox = "block rounded-xl border border-line px-4 py-3 text-center text-sm font-semibold text-muted";
const outline = "block rounded-xl border border-line-strong px-4 py-3 text-center font-semibold text-ink hover:bg-hover";

export default function PricingTable({
  current,
  signedIn,
  retentionDays,
  start,
}: {
  current: CurrentPlan | null;
  signedIn: boolean;
  retentionDays: number;
  /** Back from signing in after choosing a paid plan: that plan's checkout starts straight away. */
  start?: { plan: PaidPlan; interval: Interval } | null;
}) {
  const [interval, setInterval] = useState<Interval>(start?.interval ?? current?.interval ?? "month");
  const subscribed = !!current?.interval;
  return (
    <>
      <div className="mt-10 flex justify-center">
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-xl border border-line bg-surface p-1 text-sm font-medium">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              role="radio"
              aria-checked={interval === i}
              onClick={() => setInterval(i)}
              className={`rounded-lg px-3 py-2 sm:px-4 ${interval === i ? "bg-solid text-white" : "text-muted hover:text-ink"}`}
            >
              {i === "month" ? "Monthly" : "Yearly (2 months free)"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {ORDER.map((id) => {
          const p = PLANS[id];
          const featured = id === FEATURED;
          const mine = current?.plan === id;
          const price = interval === "year" ? p.priceYearly : p.priceMonthly;
          return (
            <div
              key={id}
              className={`relative flex flex-col rounded-2xl border bg-surface p-6 ${mine ? "border-ok-line ring-2 ring-ok-line" : featured ? "border-primary shadow-xl shadow-brand-900/10 ring-1 ring-primary" : "border-line"}`}
              data-testid={`plan-${id}`}
            >
              {mine ? (
                <span className="absolute -top-3 left-6 w-fit rounded-full bg-ok-bg px-3 py-1 text-xs font-semibold text-ok-fg ring-1 ring-ok-line" data-testid="current-plan">
                  Your current plan
                </span>
              ) : (
                featured && <span className="absolute -top-3 left-6 w-fit rounded-full bg-primary px-3 py-1 text-xs font-semibold text-on-primary">Best for teams</span>
              )}
              <h2 className="text-lg font-semibold text-ink">{p.name}</h2>
              <p className="mt-4 flex items-baseline gap-1">
                {/* US$ on every price, Free included, as at checkout. */}
                <span className="text-4xl font-semibold text-ink"><span className="text-xl align-top">US</span>${price}</span>
                <span className="text-sm text-dim">/ {interval}</span>
              </p>
              {interval === "year" && price > 0 && <p className="mt-1 text-xs text-dim">US${(price / 12).toFixed(2)} a month, billed yearly</p>}
              <ul className="mt-6 flex-1 space-y-3 text-sm text-muted">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <svg className="mt-0.5 shrink-0 text-accent" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-6 rounded-xl bg-canvas p-3 text-xs leading-5 text-muted" data-testid="video-storage">
                <p className="font-semibold text-ink">Video storage</p>
                <p className="mt-0.5">{storageLine(id, retentionDays)}</p>
              </div>
              <div className="mt-6">
                <PlanAction id={id} interval={interval} featured={featured} current={current} signedIn={signedIn} subscribed={subscribed} start={start} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** What a plan card's button does for whoever is looking. */
function PlanAction({
  id,
  interval,
  featured,
  current,
  signedIn,
  subscribed,
  start,
}: {
  id: Plan;
  interval: Interval;
  featured: boolean;
  current: CurrentPlan | null;
  signedIn: boolean;
  subscribed: boolean;
  start?: { plan: PaidPlan; interval: Interval } | null;
}) {
  const mine = current?.plan === id;
  if (id === "FREE") {
    if (!signedIn) return <Link href="/record" className={outline}>Start free</Link>;
    if (mine) return <span className={staticBox}>You&rsquo;re on Free</span>;
    if (!subscribed || !current?.owner) return null;
    // Paying: Free is what's left when the plan ends, so this is where cancelling lives.
    return (
      <>
        <Link href="/settings/billing#cancel-plan" className={outline}>Move to Free</Link>
        <p className="mt-2 text-xs text-dim">Cancel your plan in Billing. You keep it until the end of the period you&rsquo;ve paid for.</p>
      </>
    );
  }
  const name = PLANS[id].name;
  const solid = `block rounded-xl px-4 py-3 text-center font-semibold ${featured ? "bg-primary text-on-primary hover:bg-primary-hover" : "bg-solid text-on-solid hover:bg-solid-hover"}`;
  // Signed out: sign in (or create the account), then straight to this plan's checkout.
  if (!signedIn) {
    const back = `/pricing?plan=${id}&interval=${interval}`;
    return <Link href={`/login?next=${encodeURIComponent(back)}`} className={solid}>Get {name}</Link>;
  }
  if (!current?.owner) {
    return mine ? <span className={staticBox}>Your team&rsquo;s plan</span> : <p className="text-center text-xs text-dim">Only the workspace owner can change the plan.</p>;
  }
  if (mine && subscribed && current.interval === interval) {
    return (
      <>
        <span className={staticBox}>You&rsquo;re on {name}</span>
        <Link href="/settings/billing" className="mt-2 block text-center text-sm font-medium text-accent hover:underline">Manage in Billing</Link>
      </>
    );
  }
  const label = mine && subscribed ? `Switch to ${interval === "year" ? "yearly" : "monthly"}` : subscribed ? `Switch to ${name}` : mine ? `Subscribe to ${name}` : `Get ${name}`;
  return <UpgradeButton plan={id} interval={interval} featured={featured} label={label} autoStart={start?.plan === id && start.interval === interval} />;
}
