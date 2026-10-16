import { cookies } from "next/headers";
import type Stripe from "stripe";
import { z } from "zod";
import { db } from "@/lib/db";
import { ACTIVE_STATUSES, chargeChange, FOUNDING_METADATA, hasFoundingPrices, keyFor, MANAGED_PAYMENTS, PLAN_ITEM, priceId, unpaid } from "@/lib/billing";
import { foundingEnds, foundingOpen } from "@/lib/founding";
import { checkoutOffers, codeFromCookie, DISCOUNT_EXPAND, isCodeShaped, OFFER_COOKIE, upgradeOffer } from "@/lib/offers";
import { PAID_PLANS } from "@/lib/plans";
import { assertFits, planChange } from "@/lib/planChange";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";
import { appUrl, stripe } from "@/lib/stripe";
import { limitByIp } from "@/lib/rateLimit";
import { currentCustomer, syncSubscription } from "@/lib/subscription";
import { isReferralCode, referralCoupon, usableReferral } from "@/lib/referrals";

const Body = z.object({ plan: z.enum(PAID_PLANS), interval: z.enum(["month", "year"]).default("month"), code: z.string().trim().max(40).optional() });

export const POST = handle(async (req: Request) => {
  const me = await requireUser();
  requireRole(me, "OWNER");
  const { user, workspace } = me;
  const body = Body.safeParse(await req.json());
  await limitByIp("billing", 20, 600);
  if (!body.success) throw new HttpError(400, "Invalid plan");
  const { plan, interval, code } = body.data;

  // Already subscribed: switch plans on the existing subscription instead of starting a second one.
  // It's paid for now, and the switch only applies once that payment succeeds.
  const change = await planChange(workspace, plan, interval);
  if (change) {
    if (change.same) return Response.json({ url: appUrl("/settings/billing") });
    // A code typed in the switch box: only for moving up, and never below the current plan's price (lib/offers.ts).
    if (code !== undefined && !isCodeShaped(code)) throw new HttpError(400, "Enter the code as written: letters, numbers and dashes.");
    const offer = code ? await upgradeOffer(change.sub, keyFor(PLAN_ITEM[plan], interval, hasFoundingPrices(change.sub)), code) : null;
    // The new plan starts today at its full price, less a credit for the unused part of the old one.
    const charge = await chargeChange(change.sub, {
      items: change.items,
      billing_cycle_anchor: { type: "now" },
      ...(offer ? { discounts: [{ promotion_code: offer.id }] } : {}),
    }).catch((err) => {
      // Stripe has the last word on a code; then nothing changed.
      if (offer && (err as { type?: string })?.type === "StripeInvalidRequestError") {
        console.log("[billing] code refused on upgrade", JSON.stringify({ code: offer.code, error: String((err as Error).message).slice(0, 300) }));
        throw new HttpError(400, "That code can't be used on your subscription, so nothing changed.");
      }
      throw err;
    });
    if (!charge.paid) {
      // Declined or needs confirming: pay on Stripe's invoice page (the change then applies), or fix the card.
      if (charge.payUrl) return Response.json({ url: charge.payUrl });
      return unpaid(charge);
    }
    await db.workspace.update({ where: { id: workspace.id }, data: { plan, billingInterval: interval } });
    // The webhook does this too; now, so Settings > Billing shows the discount straight away.
    if (offer) await syncSubscription(await stripe().subscriptions.retrieve(change.sub.id, { expand: DISCOUNT_EXPAND }), { notify: false });
    return Response.json({ url: appUrl("/settings/billing?upgraded=1") });
  }

  // planChange may have just forgotten a subscription Stripe doesn't have, so read the workspace again.
  const fresh = await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } });
  // A new subscription must fit the clients and staff already here (a free plan we gave may have had more).
  await assertFits(fresh, plan);
  // Started while the founding offer runs: founding prices for as long as this subscription lasts (lib/founding.ts).
  const founding = foundingOpen();
  const price = await priceId(keyFor(PLAN_ITEM[plan], interval, founding));
  // A share link's or the code box's code, then the automatic offer (lib/offers.ts); without either, Checkout asks for a code.
  const saved = codeFromCookie((await cookies()).get(OFFER_COOKIE)?.value);
  // A referral code (lib/referrals.ts) that still works for this business; if it doesn't, the automatic offer instead.
  const referral = isReferralCode(saved)
    ? await usableReferral(saved!, { userId: user.id, workspace: fresh })
        .then(async (r) => ({ code: r.code, coupon: await referralCoupon() }))
        .catch((err) => (err instanceof HttpError ? null : (console.error("[billing] referral at checkout failed", String(err)), null)))
    : null;
  const offers = await checkoutOffers(isReferralCode(saved) ? null : saved, fresh.stripeCustomerId);
  // A founding checkout can't be paid long after the offer ends: open no later than its close (Stripe's minimum is 30 minutes).
  const ends = founding ? foundingEnds() : null;
  const expiresAt = ends ? Math.floor(Math.max(Date.now() + 31 * 60_000, Math.min(ends.getTime(), Date.now() + 23 * 3600_000)) / 1000) : undefined;

  // One checkout at a time per workspace, so two tabs can't start two subscriptions.
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"checkout:" + workspace.id}))`;
      // A customer deleted in Stripe, or left over from test mode, is replaced with a new one.
      let customer = await currentCustomer(fresh);
      if (customer) {
        const subs = await stripe().subscriptions.list({ customer, status: "all", limit: 20 });
        const ours = subs.data.filter((s) => s.metadata?.workspaceId === workspace.id);
        // A subscription paid for a moment ago may not have reached us yet: don't start a second one.
        if (ours.some((s) => ACTIVE_STATUSES.has(s.status))) {
          throw new HttpError(409, "Your subscription is being set up. Refresh this page in a minute.");
        }
        // An earlier one left unpaid could still be paid from its invoice email and run alongside the new one.
        await Promise.all(ours.filter((s) => s.status === "incomplete" || s.status === "unpaid").map((s) => stripe().subscriptions.cancel(s.id).catch(() => null)));
        // Only the newest checkout can be paid.
        const open = await stripe().checkout.sessions.list({ customer, status: "open", limit: 20 });
        await Promise.all(open.data.map((s) => stripe().checkout.sessions.expire(s.id).catch(() => null)));
      } else {
        const c = await stripe().customers.create({ email: user.email, name: fresh.name, metadata: { workspaceId: workspace.id } });
        customer = c.id;
        await tx.workspace.update({ where: { id: workspace.id }, data: { stripeCustomerId: customer } });
      }

      const params: Stripe.Checkout.SessionCreateParams = {
        mode: "subscription",
        customer,
        line_items: [{ price, quantity: 1 }],
        ...(MANAGED_PAYMENTS ? { managed_payments: { enabled: true } } : { automatic_tax: { enabled: true }, customer_update: { address: "auto", name: "auto" } }),
        client_reference_id: workspace.id,
        subscription_data: { metadata: { workspaceId: workspace.id, ...(founding ? FOUNDING_METADATA : {}) } },
        ...(expiresAt ? { expires_at: expiresAt } : {}),
        success_url: appUrl("/settings/billing?upgraded=1"),
        cancel_url: appUrl("/pricing"),
      };
      let session: Stripe.Checkout.Session | null = null;
      if (referral) {
        // The code rides on the subscription, so the webhook can thank the business that shared it once this is paid.
        session = await stripe()
          .checkout.sessions.create({
            ...params,
            discounts: [{ coupon: referral.coupon }],
            subscription_data: { ...params.subscription_data, metadata: { ...params.subscription_data!.metadata, referralCode: referral.code } },
          })
          .catch((err) => {
            if ((err as { type?: string })?.type !== "StripeInvalidRequestError") throw err;
            console.error("[billing] referral not applied at checkout", JSON.stringify({ code: referral.code, error: String((err as Error).message).slice(0, 300) }));
            return null;
          });
      }
      for (const offer of session ? [] : offers) {
        // Stripe has the last word (say a code for new customers, and this one has paid before): then the next offer, else an ordinary checkout.
        session = await stripe()
          .checkout.sessions.create({ ...params, discounts: [{ promotion_code: offer.id }] })
          .catch((err) => {
            if ((err as { type?: string })?.type !== "StripeInvalidRequestError") throw err;
            console.log("[billing] offer not applied at checkout", JSON.stringify({ code: offer.code, error: String((err as Error).message).slice(0, 300) }));
            return null;
          });
        if (session) break;
      }
      // A checkout can take a code typed in or one applied for them, not both.
      session ??= await stripe().checkout.sessions.create({ ...params, allow_promotion_codes: true });
      return Response.json({ url: session.url });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
});
