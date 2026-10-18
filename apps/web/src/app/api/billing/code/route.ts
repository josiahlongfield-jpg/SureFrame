import { cookies } from "next/headers";
import { z } from "zod";
import { ACTIVE_STATUSES } from "@/lib/billing";
import {
  billedBefore,
  isCodeShaped,
  NEW_CUSTOMERS_ONLY,
  NOT_YOURS,
  offerCookieValue,
  offerForCode,
  offerIsFor,
  OFFER_COOKIE,
  OFFER_COOKIE_OPTIONS,
} from "@/lib/offers";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";
import { currentSubscription } from "@/lib/subscription";
import { stripe } from "@/lib/stripe";
import { limitByIp } from "@/lib/rateLimit";
import { isReferralCode, REFERRAL_SUMMARY, usableReferral } from "@/lib/referrals";

const Body = z.object({ code: z.string().trim().max(40) });

/**
 * A discount code typed on Settings > Billing. Without a subscription it's
 * kept for checkout, like a share link. On a running subscription a code given
 * to this business comes off from the next bill (Terms, Discounts): nothing is
 * charged or refunded now.
 */
export const POST = handle(async (req: Request) => {
  const me = await requireUser();
  requireRole(me, "OWNER");
  const body = Body.safeParse(await req.json());
  // Tight, so codes can't be guessed by trying many.
  await limitByIp("billing-code", 10, 600);
  if (!body.success || !isCodeShaped(body.data.code)) throw new HttpError(400, "Enter the code as written: letters, numbers and dashes.");
  const { code } = body.data;
  const sub = me.workspace.stripeSubscriptionId ? await currentSubscription(me.workspace) : null;
  if (sub && ACTIVE_STATUSES.has(sub.status)) {
    if (isReferralCode(code)) throw new HttpError(400, "Referral codes are for businesses starting their first paid plan, so they can't be used on a running subscription.");
    const offer = await offerForCode(code);
    if (!offer) throw new HttpError(400, "That code isn't valid or has ended.");
    if (!offerIsFor(offer, typeof sub.customer === "string" ? sub.customer : sub.customer.id)) throw new HttpError(400, NOT_YOURS);
    if (offer.newCustomersOnly) throw new HttpError(400, NEW_CUSTOMERS_ONLY);
    if ((sub.discounts ?? []).some((d) => typeof d === "string" || (!d.deleted && !(d.end && d.end * 1000 <= Date.now())))) {
      throw new HttpError(400, "Your subscription already has a discount, and codes can't be combined.");
    }
    await stripe().subscriptions.update(sub.id, { discounts: [{ promotion_code: offer.id }], proration_behavior: "none" });
    return Response.json({ applied: true, subscribed: true, code: offer.code, summary: offer.summary });
  }
  if (isReferralCode(code)) {
    // A business's referral code (lib/referrals.ts): checked for this business now, and again at checkout.
    const row = await usableReferral(code, { userId: me.user.id, workspace: me.workspace });
    (await cookies()).set(OFFER_COOKIE, offerCookieValue(row.code), OFFER_COOKIE_OPTIONS);
    return Response.json({ applied: false, code: row.code, summary: REFERRAL_SUMMARY });
  }
  const offer = await offerForCode(code);
  if (!offer) throw new HttpError(400, "That code isn't valid or has ended.");
  if (!offerIsFor(offer, me.workspace.stripeCustomerId)) throw new HttpError(400, NOT_YOURS);
  // Stripe would drop it at checkout: say so now rather than promise it. (If Stripe can't say, checkout decides.)
  if (offer.newCustomersOnly && (await billedBefore(me.workspace.stripeCustomerId))) throw new HttpError(400, NEW_CUSTOMERS_ONLY);
  (await cookies()).set(OFFER_COOKIE, offerCookieValue(offer.code), OFFER_COOKIE_OPTIONS);
  return Response.json({ applied: false, code: offer.code, summary: offer.summary });
});
