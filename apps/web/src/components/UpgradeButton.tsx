"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PLANS, type Interval, type PaidPlan } from "@/lib/plans";
import { DialogButtons, DialogShell, primaryButton, quietButton, secondaryButton } from "./ConfirmDialog";

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
  /** Extra client seats the new plan covers, taken off with the switch (lib/planChange.ts). */
  seats?: { from: number; to: number } | null;
  /** A code taken off this switch (lib/offers.ts upgradeOffer). */
  offer: { code: string; summary: string } | null;
};

const money = (cents: number, currency: string) => {
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  // "US$" like every other price on the site, not a bare "$".
  return currency.toUpperCase() === "USD" ? amount.replace("$", "US$") : amount;
};

/** An error from the billing API, with its code (TOO_MANY_CLIENTS, TOO_MANY_STAFF, TERMS_REQUIRED) when it has one. */
class BillingError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

/** Where to fix what stopped a switch (and, when the API's own words don't fit beside the button, what to say). */
const FIX: Record<string, { href: string; label: string; message?: string }> = {
  TOO_MANY_CLIENTS: { href: "/clients", label: "Go to Clients" },
  TOO_MANY_STAFF: { href: "/settings/team", label: "Go to Team and staff" },
  // The API's TERMS_REQUIRED says to reload the page; here the button takes them straight there (D12d).
  TERMS_REQUIRED: {
    href: `/agree?next=${encodeURIComponent("/pricing")}`,
    label: "Review and agree",
    message: "Please agree to the updated Terms of Service and Privacy Policy first. Then come back here to switch.",
  },
};

export default function UpgradeButton({
  plan,
  interval = "month",
  featured = false,
  label,
  autoStart = false,
}: {
  plan: PaidPlan;
  interval?: Interval;
  featured?: boolean;
  /** The button's words, e.g. "Switch to Studio" (default "Get Studio"). */
  label?: string;
  /** Back from signing in after choosing this plan: start straight away, once. */
  autoStart?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string }>();
  const [note, setNote] = useState<string>();
  const [confirm, setConfirm] = useState<Preview>();
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const name = PLANS[plan].name;
  const price = interval === "year" ? PLANS[plan].priceYearly : PLANS[plan].priceMonthly;

  async function post(path: string, body: object) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 401) {
      // Signed out meanwhile: sign in, then back to this plan.
      window.location.href = `/login?next=${encodeURIComponent(`/pricing?plan=${plan}&interval=${interval}`)}`;
      return null;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new BillingError(data.error ?? "Something went wrong. Try again in a moment.", data.code);
    return data;
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      const code = (e as BillingError).code;
      const fix = FIX[code ?? ""];
      // Something to fix elsewhere: the dialog with its button, not a line inside the confirm.
      if (fix) setConfirm(undefined);
      setError({ message: fix?.message ?? (e as Error).message, code });
      setBusy(false);
    }
  }

  const close = () => {
    setConfirm(undefined);
    setError(undefined);
    setCodeOpen(false);
    setCode("");
    setCodeError(undefined);
  };

  const goToCheckout = () =>
    run(async () => {
      const data = await post("/api/billing/checkout", { plan, interval, ...(confirm?.offer ? { code: confirm.offer.code } : {}) });
      if (data?.url) window.location.href = data.url;
    });

  // A code for this switch: checked and priced again before anything is charged.
  async function applyCode(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setCodeError(undefined);
    try {
      const data = await post("/api/billing/preview", { plan, interval, code: code.trim() });
      if (data?.mode === "change") setConfirm(data);
    } catch (err) {
      setCodeError((err as Error).message);
    }
    setChecking(false);
  }

  const removeCode = () =>
    run(async () => {
      const data = await post("/api/billing/preview", { plan, interval });
      if (data?.mode === "change") setConfirm(data);
      setCode("");
      setBusy(false);
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

  // Back from signing in with this plan chosen: go on to its checkout (or the switch dialog) without another click.
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    // Once only: a reload or Back doesn't start it again.
    window.history.replaceState(null, "", "/pricing");
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

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
        {busy && !confirm ? "One moment…" : (label ?? `Get ${name}`)}
      </button>
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
      {error && !confirm && (
        <DialogShell title={FIX[error.code ?? ""] ? `You can't switch to ${name} yet` : `Couldn't switch to ${name}`} role="alertdialog" onClose={() => setError(undefined)} testId="plan-error">
          <p className="mt-3 text-sm text-muted">{error.message}</p>
          <DialogButtons>
            {FIX[error.code ?? ""] && (
              <Link href={FIX[error.code!].href} className={primaryButton + " text-center"}>
                {FIX[error.code!].label}
              </Link>
            )}
            {error.code === "TOO_MANY_CLIENTS" && (
              <Link href="/settings/billing" className={secondaryButton}>
                Add client seats
              </Link>
            )}
            <button onClick={() => setError(undefined)} className={FIX[error.code ?? ""] ? quietButton : primaryButton}>
              {FIX[error.code ?? ""] ? "Not now" : "OK"}
            </button>
          </DialogButtons>
        </DialogShell>
      )}
      {confirm && (
        <DialogShell title={`Switch to ${name}?`} onClose={busy ? undefined : close} testId="plan-confirm">
            <p className="mt-3 text-sm text-muted">
              {name} is US${price} a {interval}, plus any tax.{" "}
              {confirm.seats
                ? `Your cloud backup and AI add-on carry over (the AI add-on moves to ${name}'s price).`
                : `Your extra clients, cloud backup and AI add-on carry over (the AI add-on moves to ${name}'s price).`}{" "}
              Extra staff logins are only on Studio and Agency.
            </p>
            {confirm.seats && (
              <p className="mt-3 rounded-xl border border-ok-line bg-ok-bg p-3 text-sm text-ok-fg" data-testid="seats-removed">
                {name} includes {PLANS[plan].clientSeats} clients, so{" "}
                {confirm.seats.to === 0
                  ? `your ${confirm.seats.from} extra client ${confirm.seats.from === 1 ? "seat is" : "seats are"} removed`
                  : `${confirm.seats.from - confirm.seats.to} of your ${confirm.seats.from} extra client seats are removed (you keep ${confirm.seats.to})`}{" "}
                with this switch, and you stop paying for {confirm.seats.from - confirm.seats.to === 1 ? "it" : "them"}.
              </p>
            )}
            <dl className="mt-4 space-y-1 rounded-xl bg-canvas p-4 text-sm text-muted" data-testid="due-today">
              <div className="flex justify-between gap-4">
                <dt>{name}, from today</dt>
                <dd>{money(confirm.plan, confirm.currency)}</dd>
              </div>
              {confirm.addOns > 0 && (
                <div className="flex justify-between gap-4">
                  <dt>{confirm.seats?.to === 0 ? "Add-ons, from today" : "Extra clients and add-ons, from today"}</dt>
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
            {confirm.offer ? (
              <p className="mt-3 text-sm text-ok-fg" data-testid="upgrade-code-applied">
                {confirm.offer.code}: {confirm.offer.summary}.{" "}
                <button type="button" onClick={removeCode} disabled={busy} className="font-medium text-muted underline hover:text-ink">
                  Remove
                </button>
              </p>
            ) : !codeOpen ? (
              <button type="button" onClick={() => setCodeOpen(true)} className="mt-3 text-sm font-medium text-accent hover:underline" data-testid="upgrade-have-code">
                Have a discount code?
              </button>
            ) : (
              <form onSubmit={applyCode} className="mt-3 grid gap-2 sm:flex sm:items-start" data-testid="upgrade-code-form">
                <label className="sr-only" htmlFor={`upgrade-code-${plan}`}>
                  Discount code
                </label>
                <input
                  id={`upgrade-code-${plan}`}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Discount code"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={40}
                  required
                  className="w-full rounded-xl border border-line-strong px-3 py-2 text-sm uppercase sm:w-48"
                />
                <button disabled={checking || busy || !code.trim()} className="rounded-xl border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60">
                  {checking ? "Checking…" : "Apply"}
                </button>
                {codeError && (
                  <p role="alert" className="text-sm text-danger-fg sm:basis-full">
                    {codeError}
                  </p>
                )}
              </form>
            )}
            <p className="mt-3 text-sm text-muted">
              {confirm.dueToday > 0 && <>Charged to {confirm.paymentMethod ? <strong>{confirm.paymentMethod}</strong> : "the card you subscribed with"}. </>}
              {confirm.leftover > 0 && <>The remaining {money(confirm.leftover, confirm.currency)} comes off your next bills. </>}
              {confirm.cancelling
                ? "Your subscription is still set to cancel, so it won't renew. To keep it going, choose Manage subscription on the Billing page and renew it."
                : `Your plan then renews on this date each ${interval}.`}
            </p>
            {error && (
              <p role="alert" className="mt-3 rounded-xl border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg">
                {error.message}
              </p>
            )}
            <DialogButtons>
              <button onClick={goToCheckout} disabled={busy} className={primaryButton}>
                {busy ? "Switching…" : confirm.dueToday > 0 ? `Pay ${money(confirm.dueToday, confirm.currency)} and switch` : "Switch plan"}
              </button>
              {confirm.dueToday > 0 && (
                <button onClick={changeCard} disabled={busy} className={secondaryButton}>
                  Use a different card
                </button>
              )}
              <button onClick={close} disabled={busy} className={quietButton}>
                Not now
              </button>
            </DialogButtons>
        </DialogShell>
      )}
    </>
  );
}
