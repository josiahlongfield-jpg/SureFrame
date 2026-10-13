import type Stripe from "stripe";
import { itemOfProduct, loadCatalog, type CatalogItem } from "@/lib/billing";
import { HttpError } from "@/lib/session";
import { stripe } from "@/lib/stripe";

/**
 * Discount offers: Stripe promotion codes on coupons, made on the support
 * console's Offers page (lib/support/offers.ts). A code reaches a
 * subscription in one of four ways: typed at Stripe Checkout, brought by a
 * share link (/offer/CODE, which leaves the code in a cookie for checkout),
 * the one automatic offer applied to every new subscription, or typed on
 * Settings > Billing by a current subscriber. One discount at a time.
 */

/** The cookie a share link leaves, so checkout applies its code. */
export const OFFER_COOKIE = "sf_offer";
export const OFFER_COOKIE_DAYS = 30;

/** Codes are letters, digits and dashes (Stripe's rule), and Stripe matches them ignoring case. */
export const isCodeShaped = (code: string) => /^[A-Za-z0-9-]{3,40}$/.test(code);

/** What an offer comes off. Stored on the coupon (metadata.sureframe_scope) when the console makes it. */
export const SCOPES = {
  plan: { label: "your plan", items: ["solo", "studio", "agency"] },
  seats: { label: "your plan and extra seats", items: ["solo", "studio", "agency", "client_seat", "staff_seat"] },
  all: { label: "your whole bill", items: null },
} as const satisfies Record<string, { label: string; items: readonly CatalogItem[] | null }>;
export type OfferScope = keyof typeof SCOPES;
export const isScope = (v: unknown): v is OfferScope => typeof v === "string" && v in SCOPES;

/** Expanding these on a subscription gives its discounts in full (lib/subscription.ts). */
export const DISCOUNT_EXPAND = ["discounts.source.coupon", "discounts.promotion_code"];

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
  /** Active, not expired, uses left and the coupon still valid. Stripe makes the final check. */
  usable: boolean;
  created: Date;
};

/** What the coupon comes off, from the console's note on it, else from the products it's limited to. */
function scopeLabel(c: Stripe.Coupon) {
  const s = c.metadata?.sureframe_scope;
  if (isScope(s)) return SCOPES[s].label;
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
    usable: usable(pc),
    created: new Date(pc.created * 1000),
  };
}

/** The usable offer with this code, or null (unknown, ended, used up or expired). */
export async function offerForCode(code: string | null | undefined): Promise<Offer | null> {
  const c = code?.trim();
  if (!c || !isCodeShaped(c)) return null;
  const found = await stripe().promotionCodes.list({ code: c, active: true, limit: 10, expand: ["data.promotion.coupon"] });
  const pc = found.data.find((p) => p.code.toUpperCase() === c.toUpperCase() && usable(p));
  return pc ? toOffer(pc) : null;
}

// On globalThis, so pages, routes and the console's actions share it (Next.js can load this module more than once).
const cache = globalThis as typeof globalThis & { sureframeAutomaticOffer?: { at: number; offer: Offer | null } | null };

/**
 * The offer every new subscription gets without a code (at most one at a
 * time), checked with Stripe at most once a minute per server, so a change
 * on the console reaches every page within a minute.
 */
export async function automaticOffer(): Promise<Offer | null> {
  const hit = cache.sureframeAutomaticOffer;
  if (hit && Date.now() - hit.at < 60_000) return hit.offer;
  const list = await stripe().promotionCodes.list({ active: true, limit: 100, expand: ["data.promotion.coupon"] });
  const pc = list.data.filter((p) => p.metadata?.sureframe_auto === "yes" && usable(p)).sort((a, b) => b.created - a.created)[0];
  const offer = pc ? await toOffer(pc) : null;
  cache.sureframeAutomaticOffer = { at: Date.now(), offer };
  return offer;
}

/** After the console changes an offer, so this server reads it again. */
export const forgetAutomaticOffer = () => {
  cache.sureframeAutomaticOffer = null;
};

/** Offers never stop or stall a page or a checkout: with Stripe unreachable or slow, there just isn't one. */
export const quietly = <T,>(p: Promise<T>, ms = 3000) => {
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

/** The offer a new subscription gets: the share link's code the visitor brought, else the automatic offer. */
export async function checkoutOffer(cookieCode: string | undefined): Promise<Offer | null> {
  return (cookieCode && (await quietly(offerForCode(cookieCode)))) || (await quietly(automaticOffer()));
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
  const d = discounts.find((x): x is Stripe.Discount => typeof x !== "string" && !!x.source?.coupon && typeof x.source.coupon !== "string");
  if (!d) return null;
  const coupon = d.source.coupon as Stripe.Coupon;
  await loadCatalog().catch(() => {});
  const code = d.promotion_code && typeof d.promotion_code !== "string" ? d.promotion_code.code : null;
  const what = `${amountOff(coupon)} ${scopeLabel(coupon)}${coupon.duration === "once" ? " on your next bill" : coupon.duration === "forever" ? " for as long as you stay subscribed" : ""}`;
  return { label: code ? `${code}: ${what}` : what, endsAt: coupon.duration === "repeating" && d.end ? new Date(d.end * 1000) : null };
}

/**
 * A current subscriber's code (Settings > Billing). It replaces nothing: a
 * subscription that already has a discount keeps it and the code is refused.
 */
export async function applyCodeToSubscription(sub: Stripe.Subscription, code: string): Promise<Offer> {
  const offer = await offerForCode(code);
  if (!offer) throw new HttpError(400, "That code isn't valid or has ended.");
  if ((sub.discounts ?? []).some((d) => typeof d === "string" || !d.deleted)) {
    throw new HttpError(400, "Your subscription already has a discount, and codes can't be combined.");
  }
  if (offer.newCustomersOnly) throw new HttpError(400, "That code is for new subscriptions only.");
  try {
    await stripe().subscriptions.update(sub.id, { discounts: [{ promotion_code: offer.id }], proration_behavior: "none" });
  } catch (err) {
    if ((err as { type?: string })?.type === "StripeInvalidRequestError") {
      console.log("[billing] code refused by Stripe", JSON.stringify({ code: offer.code, error: String((err as Error).message).slice(0, 300) }));
      throw new HttpError(400, "That code can't be used on your subscription.");
    }
    throw err;
  }
  return offer;
}
