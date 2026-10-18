"use client";

import { useEffect, useState } from "react";

/**
 * "Added 5 extra client seats" after a purchase: the page reloads with
 * ?added=N so the counts are fresh, and this says what happened, then takes
 * the number out of the address so a later reload doesn't repeat it.
 */
export default function PurchaseNotice({ one, many, where }: { one: string; many: string; where: string }) {
  const [added, setAdded] = useState<number>();
  useEffect(() => {
    const url = new URL(window.location.href);
    const n = Number(url.searchParams.get("added"));
    if (!Number.isInteger(n) || n <= 0) return;
    setAdded(n);
    url.searchParams.delete("added");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);
  if (!added) return null;
  return (
    <p role="status" className="mt-4 rounded-xl border border-ok-line bg-ok-bg p-3 text-sm text-ok-fg" data-testid="purchase-done">
      Added {added} extra {added === 1 ? one : many}. {where} Your receipt comes by email from Link, Stripe&apos;s payment service, and Settings &gt; Billing
      shows what you pay.
    </p>
  );
}

/** Reloads the page after a purchase, so PurchaseNotice can say how many were added. */
export function reloadAfterPurchase(n: number) {
  const url = new URL(window.location.href);
  url.searchParams.set("added", String(n));
  window.location.assign(url.pathname + url.search + url.hash);
}
