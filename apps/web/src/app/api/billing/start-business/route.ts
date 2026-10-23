import type Stripe from "stripe";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { FOUNDING_METADATA, keyFor, MANAGED_PAYMENTS, PLAN_ITEM, priceId } from "@/lib/billing";
import { isEmailBlocked } from "@/lib/blockedEmail";
import { foundingEnds, foundingOpen } from "@/lib/founding";
import { NEW_BUSINESS_FOR } from "@/lib/newBusiness";
import { PAID_PLANS } from "@/lib/plans";
import { limitByIp } from "@/lib/rateLimit";
import { ACCOUNT_SUSPENDED, handle, HttpError, termsRequired } from "@/lib/session";
import { appUrl, stripe } from "@/lib/stripe";
import { hasAgreed } from "@/lib/terms";

const Body = z.object({ plan: z.enum(PAID_PLANS), interval: z.enum(["month", "year"]).default("month") });

/**
 * "Start your own business" for someone who owns none (Decision 4): staff who joined a team from an invite don't get a
 * Free business of their own (lib/session.ts mayStartFree), so theirs starts on a paid plan. Opens Stripe Checkout
 * before there's a workspace; lib/newBusiness.ts makes it once the subscription is paid. Never offers Free. Doesn't use
 * currentUser(), which is the team they work in (or nothing).
 */
export const POST = handle(async (req: Request) => {
  await limitByIp("billing", 20, 600);
  const userId = (await auth())?.user?.id;
  const user = userId
    ? await db.user.findUnique({ where: { id: userId }, include: { memberships: { where: { role: "OWNER" }, select: { id: true } } } })
    : null;
  if (!user || user.deleteAt) throw new HttpError(401, "Sign in required");
  if (user.suspendedAt || user.closedAt) throw new HttpError(403, ACCOUNT_SUSPENDED, "ACCOUNT_SUSPENDED");
  if (await isEmailBlocked(user.email)) throw new HttpError(403, "This email address can't be used to start a business.");
  if (!(await hasAgreed(user.id))) throw termsRequired();
  // One business of their own: someone who has one manages its plan in Settings > Billing.
  if (user.memberships.length) throw new HttpError(409, "You already have a business of your own. Switch to it to change its plan in Settings > Billing.", "HAS_BUSINESS");
  const body = Body.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, "Invalid plan");
  const { plan, interval } = body.data;

  const founding = foundingOpen();
  const price = await priceId(keyFor(PLAN_ITEM[plan], interval, founding));
  const ends = founding ? foundingEnds() : null;
  const expiresAt = ends ? Math.floor(Math.max(Date.now() + 31 * 60_000, Math.min(ends.getTime(), Date.now() + 23 * 3600_000)) / 1000) : undefined;
  // A Stripe customer of its own: the business it pays for is made when it's paid, and takes this customer.
  const customer = await stripe().customers.create({ email: user.email, name: user.name ?? undefined, metadata: { [NEW_BUSINESS_FOR]: user.id } });
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer: customer.id,
    line_items: [{ price, quantity: 1 }],
    ...(MANAGED_PAYMENTS ? { managed_payments: { enabled: true } } : { automatic_tax: { enabled: true }, customer_update: { address: "auto", name: "auto" } }),
    client_reference_id: user.id,
    subscription_data: { metadata: { [NEW_BUSINESS_FOR]: user.id, ...(founding ? FOUNDING_METADATA : {}) } },
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    allow_promotion_codes: true,
    success_url: appUrl("/start?paid=1"),
    cancel_url: appUrl("/start"),
  };
  const session = await stripe().checkout.sessions.create(params);
  console.log("[billing] checkout for a new business", JSON.stringify({ user: user.id, plan, interval }));
  return Response.json({ url: session.url });
});
