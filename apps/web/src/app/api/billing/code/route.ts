import { cookies } from "next/headers";
import { z } from "zod";
import { ACTIVE_STATUSES } from "@/lib/billing";
import { billedBefore, isCodeShaped, NEW_CUSTOMERS_ONLY, offerCookieValue, offerForCode, OFFER_COOKIE, OFFER_COOKIE_OPTIONS } from "@/lib/offers";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";
import { currentSubscription } from "@/lib/subscription";
import { limitByIp } from "@/lib/rateLimit";

const SUBSCRIBED = "Discount codes can only be used when you start a paid plan, not on a subscription that's already running.";

const Body = z.object({ code: z.string().trim().max(40) });

/**
 * A discount code typed on Settings > Billing, kept for checkout like a share
 * link. Codes are only for starting a subscription: one that's running can't
 * take a code.
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
  if (sub && ACTIVE_STATUSES.has(sub.status)) throw new HttpError(400, SUBSCRIBED);
  const offer = await offerForCode(code);
  if (!offer) throw new HttpError(400, "That code isn't valid or has ended.");
  // Stripe would drop it at checkout: say so now rather than promise it. (If Stripe can't say, checkout decides.)
  if (offer.newCustomersOnly && (await billedBefore(me.workspace.stripeCustomerId))) throw new HttpError(400, NEW_CUSTOMERS_ONLY);
  (await cookies()).set(OFFER_COOKIE, offerCookieValue(offer.code), OFFER_COOKIE_OPTIONS);
  return Response.json({ applied: false, code: offer.code, summary: offer.summary });
});
