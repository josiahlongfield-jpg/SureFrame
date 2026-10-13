import type Stripe from "stripe";
import { productIds } from "@/lib/billing";
import { db } from "@/lib/db";
import { forgetAutomaticOffer, isCodeShaped, SCOPES, toOffer, type Offer, type OfferScope } from "@/lib/offers";
import { HttpError } from "@/lib/session";
import { stripe } from "@/lib/stripe";
import { logAdmin, reasonOf, type SupportAdmin } from "@/lib/support/admin";

/** Every offer, newest first, ended ones included (the console's Offers page). */
export async function listOffers(): Promise<Offer[]> {
  const list = await stripe().promotionCodes.list({ limit: 100, expand: ["data.promotion.coupon"] });
  const offers = await Promise.all(list.data.map(toOffer));
  return offers.filter((o): o is Offer => !!o).sort((a, b) => b.created.getTime() - a.created.getTime());
}

async function currentAutomatic(exceptId?: string) {
  const list = await stripe().promotionCodes.list({ active: true, limit: 100 });
  return list.data.find((p) => p.metadata?.sureframe_auto === "yes" && p.id !== exceptId) ?? null;
}

export type NewOffer = {
  code: string;
  percentOff: number;
  duration: "once" | "repeating" | "forever";
  months?: number;
  scope: OfferScope;
  maxUses?: number;
  /** Last day it can be used, YYYY-MM-DD, Queensland time. */
  lastDay?: string;
  newCustomersOnly: boolean;
  automatic: boolean;
  reason: string;
};

/** Makes a coupon and its promotion code in Stripe, and records it in the support log. */
export async function createOffer(actor: SupportAdmin, o: NewOffer): Promise<{ actionId: string }> {
  const reason = reasonOf(o.reason);
  const code = o.code.trim().toUpperCase();
  if (!isCodeShaped(code)) throw new HttpError(400, "Codes are 3 to 40 letters, digits or dashes.");
  if (!(o.percentOff > 0 && o.percentOff <= 100)) throw new HttpError(400, "Enter a percentage from 1 to 100.");
  if (o.duration === "repeating" && !(o.months && o.months >= 1 && o.months <= 36)) throw new HttpError(400, "Enter how many months, 1 to 36.");
  let expiresAt: number | undefined;
  if (o.lastDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.lastDay)) throw new HttpError(400, "Choose the last day it can be used.");
    expiresAt = Math.floor(new Date(`${o.lastDay}T23:59:59+10:00`).getTime() / 1000);
    if (expiresAt * 1000 <= Date.now()) throw new HttpError(400, "The last day has already passed.");
  }
  if (o.automatic) {
    const other = await currentAutomatic();
    if (other) throw new HttpError(400, `${other.code} is already applied automatically. Only one offer can be; switch that one off first.`);
  }
  const existing = await stripe().promotionCodes.list({ code, active: true, limit: 1 });
  if (existing.data.length) throw new HttpError(400, `${code} is already in use. End that offer first or choose another code.`);

  const items = SCOPES[o.scope].items;
  const coupon = await stripe().coupons.create({
    name: code,
    percent_off: o.percentOff,
    duration: o.duration,
    ...(o.duration === "repeating" ? { duration_in_months: o.months } : {}),
    ...(items ? { applies_to: { products: await productIds([...items]) } } : {}),
    metadata: { sureframe_scope: o.scope },
  });
  let pc: Stripe.PromotionCode;
  try {
    pc = await stripe().promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id },
      code,
      ...(o.maxUses ? { max_redemptions: o.maxUses } : {}),
      ...(expiresAt ? { expires_at: expiresAt } : {}),
      restrictions: { first_time_transaction: o.newCustomersOnly },
      metadata: { sureframe_auto: o.automatic ? "yes" : "no" },
      expand: ["promotion.coupon"],
    });
  } catch (err) {
    // A coupon without a code can't be used: don't leave it behind.
    await stripe().coupons.del(coupon.id).catch(() => null);
    if ((err as { type?: string })?.type === "StripeInvalidRequestError") throw new HttpError(400, `Stripe refused the code: ${(err as Error).message}`);
    throw err;
  }
  forgetAutomaticOffer();
  const offer = await toOffer(pc);
  const row = await logAdmin(db, actor, {
    action: "offer.create",
    target: code,
    reason,
    details: {
      code,
      summary: offer?.summary ?? null,
      maxUses: o.maxUses ?? null,
      lastDay: o.lastDay ?? null,
      newCustomersOnly: o.newCustomersOnly,
      automatic: o.automatic,
      promotionCode: pc.id,
      coupon: coupon.id,
    },
  });
  return { actionId: row.id };
}

async function loadOffer(promotionCodeId: string) {
  const pc = await stripe().promotionCodes.retrieve(promotionCodeId, { expand: ["promotion.coupon"] }).catch(() => null);
  const offer = pc && (await toOffer(pc));
  if (!offer) throw new HttpError(404, "That offer wasn't found in Stripe.");
  return offer;
}

/** Stops a code being used. Discounts people already have keep running for the time they were offered. */
export async function endOffer(actor: SupportAdmin, o: { promotionCodeId: string; reason: string }): Promise<{ actionId: string }> {
  const reason = reasonOf(o.reason);
  const offer = await loadOffer(o.promotionCodeId);
  if (!offer.active) throw new HttpError(400, `${offer.code} has already ended.`);
  await stripe().promotionCodes.update(offer.id, { active: false, metadata: { sureframe_auto: "no" } });
  forgetAutomaticOffer();
  const row = await logAdmin(db, actor, {
    action: "offer.end",
    target: offer.code,
    reason,
    details: { code: offer.code, summary: offer.summary, uses: offer.uses, wasAutomatic: offer.automatic, promotionCode: offer.id },
  });
  return { actionId: row.id };
}

/** Applies an offer to every new subscription without a code, or stops doing so. One at a time. */
export async function setAutomaticOffer(actor: SupportAdmin, o: { promotionCodeId: string; on: boolean; reason: string }): Promise<{ actionId: string }> {
  const reason = reasonOf(o.reason);
  const offer = await loadOffer(o.promotionCodeId);
  if (o.on) {
    if (!offer.usable) throw new HttpError(400, `${offer.code} can't be used any more, so it can't be applied automatically.`);
    const other = await currentAutomatic(offer.id);
    if (other) throw new HttpError(400, `${other.code} is already applied automatically. Switch that one off first.`);
  }
  await stripe().promotionCodes.update(offer.id, { metadata: { sureframe_auto: o.on ? "yes" : "no" } });
  forgetAutomaticOffer();
  const row = await logAdmin(db, actor, {
    action: "offer.automatic",
    target: offer.code,
    reason,
    details: { code: offer.code, summary: offer.summary, automatic: o.on, promotionCode: offer.id },
  });
  return { actionId: row.id };
}
