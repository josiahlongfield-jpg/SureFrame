import crypto from "node:crypto";
import type Stripe from "stripe";
import { catalogOf, itemOfProduct, loadCatalog, planOf, type CatalogItem, type CatalogKey, CATALOG } from "@/lib/billing";
import { appSecret, safeEqual } from "@/lib/secrets";
import { HttpError } from "@/lib/session";
import { stripe } from "@/lib/stripe";

/**
 * Discount offers: Stripe promotion codes on coupons, made on the support
 * console's Offers page (lib/support/offers.ts). A code reaches a
 * subscription in one of four ways: typed at Stripe Checkout, brought by a
 * share link (/offer/CODE, which leaves the code in a cookie for checkout),
 * the one automatic offer applied to every new subscription, or typed on
 * Settings > Billing before choosing a plan (kept in the same cookie), or
 * typed when moving up to a bigger plan (upgradeOffer), or typed on Settings >
 * Billing while subscribed, which adds it from the next bill (api/billing/code).
 */

/** The cookie a share link leaves, so checkout applies its code. */
export const OFFER_COOKIE = "sf_offer";
export const OFFER_COOKIE_DAYS = 30;
export const OFFER_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: OFFER_COOKIE_DAYS * 86400,
};

/** Codes are letters, digits and dashes (Stripe's rule), and Stripe matches them ignoring case. */
export const isCodeShaped = (code: string) => /^[A-Za-z0-9-]{3,40}$/.test(code);

const signCode = (code: string) => crypto.createHmac("sha256", appSecret()).update(`offer:${code}`).digest("base64url").slice(0, 22);

/**
 * The cookie's value: the code and a signature. Only our share link and the
 * code box (both rate limited) make one, so the pricing page and checkout
 * can't be used to try codes by setting the cookie by hand.
 */
export const offerCookieValue = (code: string) => `${code.toUpperCase()}.${signCode(code.toUpperCase())}`;

/** The code in an offer cookie we made, or null for a missing, altered or hand-made one. */
export function codeFromCookie(value: string | undefined): string | null {
  const [code, sig, extra] = (value ?? "").split(".");
  if (!code || !sig || extra !== undefined || !isCodeShaped(code)) return null;
  return safeEqual(sig, signCode(code)) ? code : null;
}

/** What an offer comes off. Stored on the coupon (metadata.sureframe_scope) when the console makes it. */
export const SCOPES = {
  plan: { label: "your plan", items: ["solo", "studio", "agency"] },
  seats: { label: "your plan and extra seats", items: ["solo", "studio", "agency", "client_seat", "staff_seat"] },
  all: { label: "your whole bill", items: null },
} as const satisfies Record<string, { label: string; items: readonly CatalogItem[] | null }>;
export type OfferScope = keyof typeof SCOPES;
export const isScope = (v: unknown): v is OfferScope => typeof v === "string" && v in SCOPES;

/**
 * Expanding these on a subscription gives its discounts in full (lib/subscription.ts). A coupon's applies_to (what it
 * comes off) is only sent when asked for.
 */
export const DISCOUNT_EXPAND = ["discounts.source.coupon", "discounts.source.coupon.applies_to", "discounts.promotion_code"];
/** The same for a list of promotion codes, and for one. */
export const PROMO_LIST_EXPAND = ["data.promotion.coupon", "data.promotion.coupon.applies_to"];
export const PROMO_EXPAND = ["promotion.coupon", "promotion.coupon.applies_to"];

export type Offer = {
  /** The Stripe promotion code id. */
  id: string;
  code: string;
  active: boolean;
  automatic: boolean;
  coupon: Stripe.Coupon;
  /** "20% off your plan for 3 months". */
  summary: string;
  uses: number;
  maxUses: number | null;
  expiresAt: Date | null;
  newCustomersOnly: boolean;
  /** The one Stripe customer (business) it was given to, or null for a code anyone could use (made before 16 October 2026). */
  customer: string | null;
  /** Active, not expired, uses left and the coupon still valid. Stripe makes the final check. */
  usable: boolean;
  created: Date;
};

/** What the coupon comes off, from the console's note on it, else from the products it's limited to. */
function scopeLabel(c: Stripe.Coupon) {
  const s = c.metadata?.sureframe_scope;
  if (isScope(s)) return SCOPES[s].label;
  // Not sent by Stripe, so unknown: never claim more than we know.
  if (c.applies_to === undefined) return "selected items";
  const products = c.applies_to?.products;
  if (!products?.length) return SCOPES.all.label;
  const items = new Set(products.map((p) => itemOfProduct(p)));
  for (const scope of ["plan", "seats"] as const) {
    const want = SCOPES[scope].items;
    if (items.size === want.length && want.every((i) => items.has(i))) return SCOPES[scope].label;
  }
  return "selected items";
}

const amountOff = (c: Stripe.Coupon) =>
  c.percent_off ? `${Number(c.percent_off.toFixed(2))}% off` : c.amount_off ? `US$${(c.amount_off / 100).toFixed(2).replace(/\.00$/, "")} off` : "A discount";

const months = (n: number) => `${n} month${n === 1 ? "" : "s"}`;

/** An offer in plain words, e.g. "20% off your plan for 3 months". */
export async function describeCoupon(c: Stripe.Coupon) {
  await loadCatalog().catch(() => {});
  const what = `${amountOff(c)} ${scopeLabel(c)}`;
  if (c.duration === "forever") return `${what} for as long as you stay subscribed`;
  if (c.duration === "repeating" && c.duration_in_months) return `${what} for ${months(c.duration_in_months)}`;
  return `${what} on your first bill`;
}

/** The coupon behind a promotion code, if Stripe sent it expanded. */
const couponOf = (pc: Stripe.PromotionCode) => {
  const c = pc.promotion?.coupon;
  return c && typeof c !== "string" ? c : null;
};

function usable(pc: Stripe.PromotionCode, now = Date.now()) {
  const c = couponOf(pc);
  return (
    pc.active &&
    !!c?.valid &&
    (!pc.expires_at || pc.expires_at * 1000 > now) &&
    (pc.max_redemptions === null || pc.times_redeemed < pc.max_redemptions)
  );
}

const customerOf = (pc: Stripe.PromotionCode) => (pc.customer ? (typeof pc.customer === "string" ? pc.customer : pc.customer.id) : null);

/**
 * Whether a business can use an offer: a code given to one business (Stripe
 * customer) works for that business only. Stripe refuses it for anyone else
 * too; this says so before they get that far.
 */
export const offerIsFor = (offer: Pick<Offer, "customer">, customer: string | null | undefined) => !offer.customer || offer.customer === customer;

/** Why a code given to another business is refused. */
export const NOT_YOURS = "That code was given to another business, so it can't be used here.";

export async function toOffer(pc: Stripe.PromotionCode): Promise<Offer | null> {
  const coupon = couponOf(pc);
  if (!coupon) return null;
  return {
    id: pc.id,
    code: pc.code,
    active: pc.active,
    automatic: pc.metadata?.sureframe_auto === "yes",
    coupon,
    summary: await describeCoupon(coupon),
    uses: pc.times_redeemed,
    maxUses: pc.max_redemptions,
    expiresAt: pc.expires_at ? new Date(pc.expires_at * 1000) : null,
    newCustomersOnly: !!pc.restrictions?.first_time_transaction,
    customer: customerOf(pc),
    usable: usable(pc),
    created: new Date(pc.created * 1000),
  };
}

/** The usable offer with this code, or null (unknown, ended, used up or expired). */
export async function offerForCode(code: string | null | undefined): Promise<Offer | null> {
  const c = code?.trim();
  if (!c || !isCodeShaped(c)) return null;
  const found = await stripe().promotionCodes.list({ code: c, active: true, limit: 10, expand: PROMO_LIST_EXPAND });
  const pc = found.data.find((p) => p.code.toUpperCase() === c.toUpperCase() && usable(p));
  return pc ? toOffer(pc) : null;
}

// On globalThis, so pages, routes and the console's actions share them (Next.js can load this module more than once).
type Cached = { at: number; offer: Offer | null };
type CachedLookup = { at: number; offer: Promise<Offer | null> };
const cache = globalThis as typeof globalThis & { sureframeAutomaticOffer?: Cached | null; sureframeOfferCodes?: Map<string, CachedLookup> };
const FRESH_MS = 60_000;

/**
 * The offer every new subscription gets without a code (at most one at a
 * time), checked with Stripe at most once a minute per server, so a change
 * on the console reaches every page within a minute.
 */
export async function automaticOffer(): Promise<Offer | null> {
  const hit = cache.sureframeAutomaticOffer;
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.offer;
  const list = await stripe().promotionCodes.list({ active: true, limit: 100, expand: PROMO_LIST_EXPAND });
  // A code given to one business is never applied to everyone.
  const pc = list.data.filter((p) => p.metadata?.sureframe_auto === "yes" && !p.customer && usable(p)).sort((a, b) => b.created - a.created)[0];
  const offer = pc ? await toOffer(pc) : null;
  cache.sureframeAutomaticOffer = { at: Date.now(), offer };
  return offer;
}

/**
 * offerForCode for the pricing page and checkout, checked with Stripe at most
 * once a minute per code per server.
 */
export async function cachedOfferForCode(code: string): Promise<Offer | null> {
  const key = code.toUpperCase();
  const codes = (cache.sureframeOfferCodes ??= new Map());
  const hit = codes.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.offer;
  // Kept as a promise, so requests arriving together share one Stripe call; a failure isn't kept.
  const offer = offerForCode(key);
  codes.delete(key);
  if (codes.size >= 500) codes.delete(codes.keys().next().value!);
  codes.set(key, { at: Date.now(), offer });
  offer.catch(() => {
    if (codes.get(key)?.offer === offer) codes.delete(key);
  });
  return offer;
}

/** After the console changes an offer, so this server reads offers again. */
export const forgetOffers = () => {
  cache.sureframeAutomaticOffer = null;
  cache.sureframeOfferCodes?.clear();
};

/** Offers never stop or stall a page or a checkout: with Stripe unreachable or slow, there just isn't one. */
export const quietly = <T,>(p: Promise<T>, ms = 3000): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.error("[billing] offer lookup timed out", JSON.stringify({ ms }));
      resolve(null);
    }, ms);
  });
  const settled = p.catch((err) => {
    if (!(err instanceof HttpError)) console.error("[billing] offer lookup failed", String(err));
    return null;
  });
  return Promise.race([settled, late]).finally(() => clearTimeout(timer));
};

/**
 * The offers to try on a new subscription, in order: the code the visitor
 * brought (share link or code box), then the automatic offer, so the
 * automatic one still applies when Stripe refuses the other (say it's for
 * new customers and this one has paid before). Given longer than the pricing
 * page, as the visitor is waiting on checkout anyway.
 */
export async function checkoutOffers(code: string | null, customer: string | null): Promise<Offer[]> {
  const [linked, auto] = await Promise.all([code ? quietly(cachedOfferForCode(code), 8000) : null, quietly(automaticOffer(), 8000)]);
  return [linked, auto].filter((o, i, all): o is Offer => !!o && offerIsFor(o, customer) && all.findIndex((x) => x?.id === o.id) === i);
}

/**
 * Why a code for new customers is refused. Stripe's rule (first_time_transaction) is a customer without any
 * payments or invoices, so anyone we've billed, paid or not, is refused.
 */
export const NEW_CUSTOMERS_ONLY = "That code is only for businesses we've never billed before.";

/** Whether we've billed a Stripe customer before, so codes for new customers won't work for them. Null if Stripe can't say. */
export async function billedBefore(customer: string | null | undefined): Promise<boolean | null> {
  if (!customer) return false;
  try {
    const invoices = await stripe().invoices.list({ customer, limit: 1 });
    return invoices.data.length > 0;
  } catch (err) {
    console.error("[billing] billed-before check failed", String(err));
    return null;
  }
}

export type DiscountNow = { label: string; endsAt: Date | null };

/**
 * The discount a subscription has now, for Settings > Billing: "SPRING20: 20%
 * off your plan" and when it stops applying (null for one that lasts while
 * subscribed, or comes off the next bill only). Null without one.
 */
export async function discountOf(sub: Stripe.Subscription): Promise<DiscountNow | null> {
  let discounts = (sub.discounts ?? []).filter((d) => typeof d === "string" || !d.deleted);
  if (!discounts.length) return null;
  if (discounts.some((d) => typeof d === "string" || typeof d.source?.coupon === "string")) {
    discounts = (await stripe().subscriptions.retrieve(sub.id, { expand: DISCOUNT_EXPAND })).discounts ?? [];
  }
  const found = discounts.filter((x): x is Stripe.Discount => typeof x !== "string" && !!x.source?.coupon && typeof x.source.coupon !== "string");
  if (!found.length) return null;
  await loadCatalog().catch(() => {});
  const labels = found.map((d) => {
    const coupon = d.source.coupon as Stripe.Coupon;
    // A referral (lib/referrals.ts): how long it lasts is explained beside it on Settings > Billing.
    if (coupon.metadata?.sureframe_kind === "referral") return `Referral: ${amountOff(coupon)} ${scopeLabel(coupon)}`;
    const code = d.promotion_code && typeof d.promotion_code !== "string" ? d.promotion_code.code : null;
    const what = `${amountOff(coupon)} ${scopeLabel(coupon)}${coupon.duration === "once" ? " on your next bill" : coupon.duration === "forever" ? " for as long as you stay subscribed" : ""}`;
    return code ? `${code}: ${what}` : what;
  });
  // An end date only when every one of them ends; the label is redone when one does.
  const ends = found.map((d) => ((d.source.coupon as Stripe.Coupon).duration === "repeating" && d.end ? d.end * 1000 : null));
  return { label: labels.join("; "), endsAt: ends.every((e) => e !== null) ? new Date(Math.max(...(ends as number[]))) : null };
}

const perMonth = (cents: number, interval: string | undefined) => (interval === "year" ? cents / 12 : cents);

/**
 * A code typed when switching to a bigger plan. It's only for moving up: the
 * new plan, with the code taken off, must still cost at least what the
 * current plan does (each counted per month, so monthly and yearly compare),
 * so a code never makes a switch cheaper than staying put. It can't be added
 * on top of a discount the subscription already has, and codes for new
 * customers aren't for subscribers.
 */
export async function upgradeOffer(sub: Stripe.Subscription, newPlanKey: CatalogKey, code: string): Promise<Offer> {
  const offer = await offerForCode(code);
  if (!offer) throw new HttpError(400, "That code isn't valid or has ended.");
  if (!offerIsFor(offer, typeof sub.customer === "string" ? sub.customer : sub.customer.id)) throw new HttpError(400, NOT_YOURS);
  if (offer.newCustomersOnly) throw new HttpError(400, NEW_CUSTOMERS_ONLY);
  if ((sub.discounts ?? []).some((d) => typeof d === "string" || (!d.deleted && !(d.end && d.end * 1000 <= Date.now())))) {
    throw new HttpError(400, "Your subscription already has a discount, and codes can't be combined.");
  }
  const current = sub.items.data.find((i) => planOf(i.price));
  if (!current?.price.unit_amount) throw new HttpError(400, "Codes can only be used when moving up to a bigger plan.");
  const was = perMonth(current.price.unit_amount * (current.quantity ?? 1), current.price.recurring?.interval);
  const next = CATALOG[newPlanKey];
  const full = perMonth(Math.round(next.amount * 100), next.interval);
  if (full <= was) throw new HttpError(400, "Codes can only be used when moving up to a bigger plan.");
  // What the code takes off the new plan. A code limited to other items leaves the plan's price as it is.
  const c = offer.coupon;
  await loadCatalog().catch(() => {});
  const products = c.applies_to?.products;
  const onPlan = !products?.length || products.some((p) => itemOfProduct(p) === next.item);
  const off = !onPlan ? 0 : c.percent_off ? (full * c.percent_off) / 100 : c.amount_off ? perMonth(c.amount_off, next.interval) : 0;
  if (full - off < was) {
    const name = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);
    const from = catalogOf(current.price)?.item ?? "current";
    throw new HttpError(400, `That code would make ${name(next.item)} cost less than your ${name(from)} plan, so it can't be used for this switch.`);
  }
  return offer;
}
