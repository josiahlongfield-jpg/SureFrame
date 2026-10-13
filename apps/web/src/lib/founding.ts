/**
 * Founding prices. A business that starts a subscription before the offer
 * ends keeps the prices in FOUNDING_PRICES (lib/billing.ts) for its plan,
 * extra clients and extra staff for as long as that subscription stays active,
 * including when it switches plans or between monthly and yearly (Terms
 * section 5). Add-ons and tax aren't covered. A new subscription after the
 * offer has ended pays the prices of the time.
 *
 * ENDS is the last day of the offer, in Queensland time, or null while no
 * offer is running. To extend it, move the date later and say so on the
 * pricing page rather than quietly. FOUNDING_ENDS in the environment
 * overrides it ("off" turns it off), for tests.
 *
 * Checkout decides founding when it opens; a checkout opened just before the
 * offer starts and paid after it is given founding prices by the webhook
 * (adoptFoundingPrices in lib/billing.ts), and one opened on the last day
 * expires soon after the offer closes.
 */
const ENDS: string | null = null;

const QLD_OFFSET = "+10:00"; // Queensland has no daylight saving.

function endsSetting() {
  const v = process.env.FOUNDING_ENDS || ENDS;
  if (!v || v === "off") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    console.error("[billing] FOUNDING_ENDS isn't a YYYY-MM-DD date; founding prices are off", JSON.stringify({ value: v }));
    return null;
  }
  return v;
}

/** The moment the founding offer closes (the end of its last day in Queensland), or null with no offer running. */
export function foundingEnds(): Date | null {
  const v = endsSetting();
  return v ? new Date(`${v}T23:59:59.999${QLD_OFFSET}`) : null;
}

/** Whether a subscription started now gets founding prices. */
export function foundingOpen(now = new Date()) {
  const ends = foundingEnds();
  return !!ends && now <= ends;
}

/** The offer's last day as people read it, e.g. "31 January 2027". */
export function foundingLastDay(): string | null {
  const v = endsSetting();
  return v ? new Date(`${v}T12:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;
}
