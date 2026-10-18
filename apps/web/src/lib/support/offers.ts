import crypto from "node:crypto";
import type Stripe from "stripe";
import { productIds } from "@/lib/billing";
import { db, type Workspace } from "@/lib/db";
import { forgetOffers, isCodeShaped, PROMO_EXPAND, PROMO_LIST_EXPAND, SCOPES, toOffer, type Offer, type OfferScope } from "@/lib/offers";
import { HttpError } from "@/lib/session";
import { stripe } from "@/lib/stripe";
import { isFounder, logAdmin, reasonOf, type SupportAdmin } from "@/lib/support/admin";
import { currentCustomer } from "@/lib/subscription";

/** Only the founder gives or ends discount codes (lib/support/admin.ts). */
export function requireFounder(actor: SupportAdmin) {
  if (!isFounder(actor.email)) throw new HttpError(403, "Only the founder can give or end discount codes.");
}

export type GivenOffer = Offer & { business: { id: string; name: string; ownerEmail: string | null } | null };

/** Every offer, newest first, ended ones included, with the business each was given to (the console's Discounts page). */
export async function listOffers(): Promise<GivenOffer[]> {
  const list = await stripe().promotionCodes.list({ limit: 100, expand: PROMO_LIST_EXPAND });
  const offers = (await Promise.all(list.data.map(toOffer))).filter((o): o is Offer => !!o);
  const customers = [...new Set(offers.flatMap((o) => (o.customer ? [o.customer] : [])))];
  const workspaces = await db.workspace.findMany({
    where: { stripeCustomerId: { in: customers } },
    select: { id: true, name: true, stripeCustomerId: true, members: { where: { role: "OWNER" }, select: { user: { select: { email: true } } }, take: 1 } },
  });
  return offers
    .map((o) => {
      const w = o.customer ? workspaces.find((x) => x.stripeCustomerId === o.customer) : null;
      return { ...o, business: w ? { id: w.id, name: w.name, ownerEmail: w.members[0]?.user.email ?? null } : null };
    })
    .sort((a, b) => b.created.getTime() - a.created.getTime());
}

/**
 * The longest an offer of "a number of months" can run. Stripe takes it off every bill that starts within those
 * months (Terms section 5), so on yearly billing that's the first yearly bill, and at exactly 12 possibly the second
 * too, as the console says.
 */
export const MAX_OFFER_MONTHS = 12;

export type NewOffer = {
  /** The business it's for: its owner's email. */
  email: string;
  /** Empty for one made up (SF- and eight letters or digits). */
  code?: string;
  percentOff: number;
  duration: "once" | "repeating" | "forever";
  months?: number;
  scope: OfferScope;
  maxUses?: number;
  /** Last day it can be used, YYYY-MM-DD, Queensland time. */
  lastDay?: string;
  reason: string;
};

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const madeUpCode = () => `SF-${Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("")}`;

/** The business an owner's email names. */
async function businessOf(email: string): Promise<{ workspace: Workspace; ownerEmail: string }> {
  const owned = await db.membership.findMany({ where: { role: "OWNER", user: { email: { equals: email.trim(), mode: "insensitive" } } }, include: { workspace: true, user: true } });
  if (!owned.length) throw new HttpError(400, "No business has an owner with that email. Check it on Look up.");
  if (owned.length > 1) throw new HttpError(400, "That person owns more than one business, and this page can't tell which one the code is for, so no code was made. For now, codes can only go to someone who owns one business.");
  const { workspace, user } = owned[0];
  if (workspace.closedAt || workspace.deleteAt) throw new HttpError(400, `${workspace.name} is closed or being deleted.`);
  return { workspace, ownerEmail: user.email };
}

/** The business's Stripe customer, made now if it has none, so the code can be tied to it. */
async function customerFor(workspace: Workspace, ownerEmail: string) {
  const existing = await currentCustomer(workspace);
  if (existing) return existing;
  const c = await stripe().customers.create({ email: ownerEmail, name: workspace.name, metadata: { workspaceId: workspace.id } });
  // Unless a checkout made one at the same moment: then that one.
  const set = await db.workspace.updateMany({ where: { id: workspace.id, stripeCustomerId: null }, data: { stripeCustomerId: c.id } });
  if (set.count) return c.id;
  await stripe().customers.del(c.id).catch(() => null);
  return (await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } })).stripeCustomerId!;
}

/**
 * Gives one business a discount code (Josiah, 16 October 2026): it works once,
 * and only for that business, as Stripe ties it to the business's customer.
 * Records it in the support log.
 */
export async function createOffer(actor: SupportAdmin, o: NewOffer): Promise<{ actionId: string }> {
  requireFounder(actor);
  const reason = reasonOf(o.reason);
  const code = (o.code?.trim() || madeUpCode()).toUpperCase();
  if (!isCodeShaped(code)) throw new HttpError(400, "Codes are 3 to 40 letters, digits or dashes.");
  // REF- codes are businesses' referral codes (lib/referrals.ts).
  if (code.startsWith("REF-")) throw new HttpError(400, "Codes starting with REF- are kept for referral codes. Choose another code.");
  if (!(o.percentOff > 0 && o.percentOff <= 100)) throw new HttpError(400, "Enter a percentage from 1 to 100.");
  if (o.duration === "repeating" && !(o.months && o.months >= 1 && o.months <= MAX_OFFER_MONTHS)) throw new HttpError(400, `Enter how many months, 1 to ${MAX_OFFER_MONTHS}.`);
  let expiresAt: number | undefined;
  if (o.lastDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.lastDay)) throw new HttpError(400, "Choose the last day it can be used.");
    expiresAt = Math.floor(new Date(`${o.lastDay}T23:59:59+10:00`).getTime() / 1000);
    if (expiresAt * 1000 <= Date.now()) throw new HttpError(400, "The last day has already passed.");
  }
  const { workspace, ownerEmail } = await businessOf(o.email);
  const existing = await stripe().promotionCodes.list({ code, active: true, limit: 1 });
  if (existing.data.length) throw new HttpError(400, `${code} is already in use. End that offer first or choose another code.`);

  const items = SCOPES[o.scope].items;
  const coupon = await stripe().coupons.create({
    name: code,
    percent_off: o.percentOff,
    duration: o.duration,
    ...(o.duration === "repeating" ? { duration_in_months: o.months } : {}),
    ...(items ? { applies_to: { products: await productIds([...items]) } } : {}),
    metadata: { sureframe_scope: o.scope, sureframe_workspace: workspace.id },
  });
  let pc: Stripe.PromotionCode;
  try {
    pc = await stripe().promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id },
      code,
      // This business only, once.
      customer: await customerFor(workspace, ownerEmail),
      max_redemptions: 1,
      ...(expiresAt ? { expires_at: expiresAt } : {}),
      metadata: { sureframe_auto: "no", sureframe_workspace: workspace.id },
      expand: PROMO_EXPAND,
    });
  } catch (err) {
    // A coupon without a code can't be used: don't leave it behind.
    await stripe().coupons.del(coupon.id).catch(() => null);
    if ((err as { type?: string })?.type === "StripeInvalidRequestError") throw new HttpError(400, `Stripe refused the code: ${(err as Error).message}`);
    throw err;
  }
  forgetOffers();
  const offer = await toOffer(pc);
  const row = await logAdmin(db, actor, {
    action: "offer.create",
    target: code,
    workspaceId: workspace.id,
    reason,
    details: {
      code,
      summary: offer?.summary ?? null,
      business: workspace.name,
      lastDay: o.lastDay ?? null,
      promotionCode: pc.id,
      coupon: coupon.id,
    },
  });
  return { actionId: row.id };
}

async function loadOffer(promotionCodeId: string) {
  const pc = await stripe().promotionCodes.retrieve(promotionCodeId, { expand: PROMO_EXPAND }).catch(() => null);
  const offer = pc && (await toOffer(pc));
  if (!offer) throw new HttpError(404, "That offer wasn't found in Stripe.");
  return offer;
}

/** Stops a code being used. Discounts people already have keep running for the time they were offered. */
export async function endOffer(actor: SupportAdmin, o: { promotionCodeId: string; reason: string }): Promise<{ actionId: string }> {
  requireFounder(actor);
  const reason = reasonOf(o.reason);
  const offer = await loadOffer(o.promotionCodeId);
  if (!offer.active) throw new HttpError(400, `${offer.code} has already ended.`);
  await stripe().promotionCodes.update(offer.id, { active: false, metadata: { sureframe_auto: "no" } });
  forgetOffers();
  const row = await logAdmin(db, actor, {
    action: "offer.end",
    target: offer.code,
    reason,
    details: { code: offer.code, summary: offer.summary, uses: offer.uses, wasAutomatic: offer.automatic, promotionCode: offer.id },
  });
  return { actionId: row.id };
}

/**
 * Stops an older code being applied to every new subscription. Codes are only
 * given to one business now, so none can be switched on.
 */
export async function stopAutomaticOffer(actor: SupportAdmin, o: { promotionCodeId: string; reason: string }): Promise<{ actionId: string }> {
  requireFounder(actor);
  const reason = reasonOf(o.reason);
  const offer = await loadOffer(o.promotionCodeId);
  await stripe().promotionCodes.update(offer.id, { metadata: { sureframe_auto: "no" } });
  forgetOffers();
  const row = await logAdmin(db, actor, {
    action: "offer.automatic",
    target: offer.code,
    reason,
    details: { code: offer.code, summary: offer.summary, automatic: false, promotionCode: offer.id },
  });
  return { actionId: row.id };
}
