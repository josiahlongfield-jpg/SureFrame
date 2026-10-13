import type Stripe from "stripe";
import type { Plan } from "@prisma/client";
import {
  AI_ASSIST_PRICES,
  CLOUD_BACKUP_PRICE,
  CLOUD_BACKUP_PRICE_YEARLY,
  EXTRA_SEAT_PRICE,
  EXTRA_SEAT_PRICE_YEARLY,
  EXTRA_STAFF_PRICE,
  EXTRA_STAFF_PRICE_YEARLY,
  PLANS,
  type Interval,
  type PaidPlan,
} from "@/lib/plans";
import { stripe } from "@/lib/stripe";

/** What SureFrame sells. Each item has a monthly and a yearly price. */
const ITEMS = {
  solo: { product: "SureFrame Solo", month: PLANS.SOLO.priceMonthly, year: PLANS.SOLO.priceYearly },
  studio: { product: "SureFrame Studio", month: PLANS.STUDIO.priceMonthly, year: PLANS.STUDIO.priceYearly },
  agency: { product: "SureFrame Agency", month: PLANS.AGENCY.priceMonthly, year: PLANS.AGENCY.priceYearly },
  client_seat: { product: "SureFrame extra client", month: EXTRA_SEAT_PRICE, year: EXTRA_SEAT_PRICE_YEARLY },
  staff_seat: { product: "SureFrame extra staff", month: EXTRA_STAFF_PRICE, year: EXTRA_STAFF_PRICE_YEARLY },
  cloud_backup: { product: "SureFrame cloud backup", month: CLOUD_BACKUP_PRICE, year: CLOUD_BACKUP_PRICE_YEARLY },
  // AI summaries are priced by plan, so each plan has its own add-on item.
  ai_assist_solo: { product: "SureFrame AI summaries (Solo)", ...AI_ASSIST_PRICES.SOLO },
  ai_assist_studio: { product: "SureFrame AI summaries (Studio)", ...AI_ASSIST_PRICES.STUDIO },
  ai_assist_agency: { product: "SureFrame AI summaries (Agency)", ...AI_ASSIST_PRICES.AGENCY },
} as const;

export type CatalogItem = keyof typeof ITEMS;
const SUFFIX: Record<Interval, string> = { month: "monthly", year: "yearly" };
const INTERVALS = ["month", "year"] as const;

/**
 * What founding subscriptions (lib/founding.ts) pay for their plan and extra
 * seats, whatever the prices in plans.ts become. They're what founding
 * customers were promised, so never change them. Their Stripe prices have
 * their own lookup keys (sureframe_founding_…), so raising a normal price
 * never touches them. Raising a price in plans.ts? Founding workspaces
 * (Workspace.foundingPrices) still pay these, so show them these in the app.
 */
export const FOUNDING_PRICES = {
  solo: { month: 15, year: 150 },
  studio: { month: 49, year: 490 },
  agency: { month: 99, year: 990 },
  client_seat: { month: 1.5, year: 15 },
  staff_seat: { month: 8, year: 80 },
} as const satisfies Partial<Record<CatalogItem, Record<Interval, number>>>;
type FoundingItem = keyof typeof FOUNDING_PRICES;
const isFoundingItem = (item: CatalogItem): item is FoundingItem => item in FOUNDING_PRICES;

/** Stripe price lookup key, e.g. sureframe_solo_yearly, or sureframe_founding_solo_yearly for a founding price. */
export type CatalogKey = `sureframe_${CatalogItem}_${"monthly" | "yearly"}` | `sureframe_founding_${FoundingItem}_${"monthly" | "yearly"}`;
export const catalogKey = (item: CatalogItem, interval: Interval) => `sureframe_${item}_${SUFFIX[interval]}` as CatalogKey;
const foundingKey = (item: FoundingItem, interval: Interval) => `sureframe_founding_${item}_${SUFFIX[interval]}` as CatalogKey;

type CatalogEntry = { item: CatalogItem; interval: Interval; product: string; amount: number; founding: boolean };

/**
 * Everything SureFrame sells, keyed by Stripe price lookup key. Products and
 * prices are created in Stripe on first use, so test and live mode need no
 * manual catalog setup and no price ids in env. A founding price is another
 * price of the same product.
 */
export const CATALOG = Object.fromEntries([
  ...(Object.keys(ITEMS) as CatalogItem[]).flatMap((item) =>
    INTERVALS.map((interval) => [catalogKey(item, interval), { item, interval, product: ITEMS[item].product, amount: ITEMS[item][interval], founding: false }]),
  ),
  ...(Object.keys(FOUNDING_PRICES) as FoundingItem[]).flatMap((item) =>
    INTERVALS.map((interval) => [foundingKey(item, interval), { item, interval, product: ITEMS[item].product, amount: FOUNDING_PRICES[item][interval], founding: true }]),
  ),
]) as Record<CatalogKey, CatalogEntry>;

/** Subscriptions started while founding prices were offered carry this in their metadata for as long as they last. */
export const FOUNDING_METADATA = { foundingPrices: "yes" } as const;
export const hasFoundingPrices = (sub: Pick<Stripe.Subscription, "metadata">) => sub.metadata?.foundingPrices === FOUNDING_METADATA.foundingPrices;

/** The price an item is billed at: founding subscriptions keep their founding prices for the plan and extra seats. */
export function keyFor(item: CatalogItem, interval: Interval, founding: boolean): CatalogKey {
  return founding && isFoundingItem(item) ? foundingKey(item, interval) : catalogKey(item, interval);
}

/** Software as a service, business use: eligible for Stripe Managed Payments. */
const TAX_CODE = "txcd_10103001";

export const PLAN_ITEM: Record<PaidPlan, CatalogItem> = { SOLO: "solo", STUDIO: "studio", AGENCY: "agency" };

/** The AI summaries add-on item that goes with each plan. */
export const AI_ITEM: Record<PaidPlan, CatalogItem> = { SOLO: "ai_assist_solo", STUDIO: "ai_assist_studio", AGENCY: "ai_assist_agency" };
export const isAiItem = (item: CatalogItem | undefined) => !!item && item.startsWith("ai_assist_");

const cache = new Map<CatalogKey, string>();
const products = new Map<CatalogItem, string>();
/** Which catalog item each of our Stripe products is, for prices that have lost their lookup key. */
const productItems = new Map<string, CatalogItem>();

/** Reads our prices from Stripe once per server, and warns if any no longer match plans.ts. */
export async function loadCatalog() {
  if (cache.size) return;
  // Stripe accepts at most 10 lookup keys per list call.
  const keys = Object.keys(CATALOG);
  for (let i = 0; i < keys.length; i += 10) {
    const found = await stripe().prices.list({ lookup_keys: keys.slice(i, i + 10), active: true, limit: 100 });
    for (const p of found.data) {
      if (!p.lookup_key || !(p.lookup_key in CATALOG)) continue;
      const entry = CATALOG[p.lookup_key as CatalogKey];
      const product = typeof p.product === "string" ? p.product : p.product.id;
      cache.set(p.lookup_key as CatalogKey, p.id);
      products.set(entry.item, product);
      productItems.set(product, entry.item);
      // Stripe keeps charging what the price says, whatever the site shows.
      if (p.unit_amount !== Math.round(entry.amount * 100) || p.currency !== "usd" || p.recurring?.interval !== entry.interval) {
        console.error("[billing] Stripe price doesn't match plans.ts", JSON.stringify({ key: p.lookup_key, price: p.id, stripe: [p.unit_amount, p.currency, p.recurring?.interval], site: [entry.amount, "usd", entry.interval] }));
      }
    }
  }
}

/** The Stripe price id for a catalog item, creating the product and price if missing. */
export async function priceId(key: CatalogKey): Promise<string> {
  const hit = cache.get(key);
  if (hit) return hit;
  await loadCatalog();
  const again = cache.get(key);
  if (again) return again;
  const entry = CATALOG[key];
  // Idempotency keys stop two cold servers from creating duplicates at the same moment.
  let product = products.get(entry.item);
  if (!product) {
    product = (
      await stripe().products.create(
        { name: entry.product, tax_code: TAX_CODE, metadata: { item: entry.item } },
        { idempotencyKey: `sureframe_${entry.item}-product-v2` },
      )
    ).id;
    products.set(entry.item, product);
  }
  productItems.set(product, entry.item);
  const price = await stripe().prices.create(
    {
      product,
      currency: "usd",
      unit_amount: Math.round(entry.amount * 100),
      recurring: { interval: entry.interval },
      // Prices are before tax; any tax is added on top, as the pricing page says.
      tax_behavior: "exclusive",
      lookup_key: key,
      transfer_lookup_key: true,
    },
    { idempotencyKey: `${key}-price-v3` },
  );
  cache.set(key, price.id);
  return price.id;
}

/** Stripe product ids for catalog items (creating any not made yet), for discounts limited to them. */
export async function productIds(items: CatalogItem[]): Promise<string[]> {
  await loadCatalog();
  const out: string[] = [];
  for (const item of items) {
    if (!products.has(item)) await priceId(catalogKey(item, "month"));
    out.push(products.get(item)!);
  }
  return out;
}

/** Which catalog item one of our Stripe products is. */
export const itemOfProduct = (product: string) => productItems.get(product);

type PriceRef = Pick<Stripe.Price, "lookup_key"> & Partial<Pick<Stripe.Price, "product" | "recurring">>;

/**
 * Which catalog entry a subscription item's price is, if any. A price whose
 * lookup key moved to a newer price (say one archived in the Dashboard) is
 * still known by its product, so its subscribers keep what they pay for.
 */
export function catalogOf(price: PriceRef) {
  const key = price.lookup_key;
  if (key && key in CATALOG) return CATALOG[key as CatalogKey];
  const product = typeof price.product === "string" ? price.product : price.product?.id;
  const item = product ? productItems.get(product) : undefined;
  const interval = price.recurring?.interval as string | undefined;
  return item && (interval === "month" || interval === "year") ? CATALOG[catalogKey(item, interval)] : null;
}

export function planOf(price: PriceRef): Plan | null {
  const item = catalogOf(price)?.item;
  const plan = (Object.keys(PLAN_ITEM) as PaidPlan[]).find((p) => PLAN_ITEM[p] === item);
  return plan ?? null;
}

/** The billing interval of a subscription, read from its plan item. */
export function intervalOf(sub: Stripe.Subscription): Interval {
  const plan = sub.items.data.find((i) => planOf(i.price));
  return (plan && catalogOf(plan.price)?.interval) || "month";
}

/** Stripe's merchant-of-record mode. On unless explicitly turned off. */
export const MANAGED_PAYMENTS = process.env.STRIPE_MANAGED_PAYMENTS !== "off";

export const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

let portalConfig: string | undefined;

/** A customer-portal configuration so cancelling and card updates work without dashboard setup. */
export async function portalConfiguration(): Promise<string> {
  if (portalConfig) return portalConfig;
  const existing = await stripe().billingPortal.configurations.list({ active: true, limit: 100 });
  const ours = existing.data.find((c) => c.metadata?.app === "sureframe");
  if (ours) return (portalConfig = ours.id);
  const created = await stripe().billingPortal.configurations.create(
    {
      business_profile: { headline: "Manage your SureFrame subscription" },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
      },
      metadata: { app: "sureframe" },
    },
    { idempotencyKey: "sureframe-portal-v1" },
  );
  return (portalConfig = created.id);
}

type ItemChange = Stripe.SubscriptionUpdateParams.Item;

/**
 * The item changes that leave `quantity` of a catalog add-on on a
 * subscription, at `price`. Items are matched by what they are, not by price
 * id, so someone on an older price of the same add-on is moved to the current
 * one instead of being billed for both, and removing it removes every copy.
 */
export function addOnChanges(sub: Stripe.Subscription, item: CatalogItem, price: string, quantity: number): ItemChange[] {
  const [keep, ...extra] = sub.items.data.filter((i) => catalogOf(i.price)?.item === item);
  const drop = extra.map((i) => ({ id: i.id, deleted: true }));
  if (quantity === 0) return keep ? [{ id: keep.id, deleted: true }, ...drop] : drop;
  if (!keep) return [{ price, quantity }, ...drop];
  if (keep.price.id === price && keep.quantity === quantity) return drop;
  return [{ id: keep.id, price, quantity }, ...drop];
}

export type Charge = { paid: true } | { paid: false; payUrl: string | null };

/** Stripe couldn't take the payment (declined, or the bank wants the owner to confirm it). */
export const paymentFailed = (err: unknown) => {
  const e = err as { statusCode?: number; type?: string } | null;
  return e?.statusCode === 402 || e?.type === "StripeCardError" || e?.type === "card_error";
};

/**
 * Applies a subscription change that's charged today, only once it's paid.
 * Pending updates (which keep a link to pay) can't remove items, so a change
 * that also removes something is refused outright when the payment fails.
 */
export async function chargeChange(sub: Stripe.Subscription, params: Stripe.SubscriptionUpdateParams): Promise<Charge> {
  const removes = (params.items ?? []).some((i) => i.deleted);
  let updated: Stripe.Subscription;
  try {
    updated = await stripe().subscriptions.update(sub.id, {
      ...params,
      proration_behavior: "always_invoice",
      payment_behavior: removes ? "error_if_incomplete" : "pending_if_incomplete",
      expand: ["latest_invoice"],
    });
  } catch (err) {
    if (paymentFailed(err)) return { paid: false, payUrl: null };
    throw err;
  }
  if (!updated.pending_update) return { paid: true };
  const invoice = updated.latest_invoice;
  return { paid: false, payUrl: (invoice && typeof invoice !== "string" && invoice.hosted_invoice_url) || null };
}

/** The reply when a charge didn't go through: nothing changed, and how to fix it. */
export function unpaid({ payUrl }: { payUrl: string | null }) {
  return payUrl
    ? Response.json({ error: "Your card couldn't be charged. Pay the invoice to finish.", url: payUrl }, { status: 402 })
    : Response.json({ error: "Your card couldn't be charged, so nothing changed. Update your card under Manage subscription, then try again." }, { status: 402 });
}

/**
 * Changes add-ons or extra seats on a subscription. Anything added is charged
 * today for the rest of the current billing period (then renews with the plan),
 * so nothing is used before it's paid for, even on a cancelled plan that won't
 * renew. Removals are credited against the next bill. If the card can't be
 * charged nothing changes.
 */
export async function changeAddOns(sub: Stripe.Subscription, items: ItemChange[], { adds }: { adds: boolean }): Promise<Charge> {
  if (!items.length) return { paid: true };
  if (!adds) {
    await stripe().subscriptions.update(sub.id, { items, proration_behavior: "create_prorations" });
    return { paid: true };
  }
  return chargeChange(sub, { items });
}
