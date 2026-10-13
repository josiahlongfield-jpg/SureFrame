import { z } from "zod";
import { hasFoundingPrices, keyFor, PLAN_ITEM, priceId } from "@/lib/billing";
import { PAID_PLANS } from "@/lib/plans";
import { paymentMethodLabel, planChange } from "@/lib/planChange";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";
import { stripe } from "@/lib/stripe";
import { limitByIp } from "@/lib/rateLimit";

const Body = z.object({ plan: z.enum(PAID_PLANS), interval: z.enum(["month", "year"]).default("month") });

/**
 * What switching plans would do, shown to the owner before they confirm:
 * the new plan and the add-ons that carry over, the credit for unused time on
 * the old plan, tax, what's charged today and the payment method it goes on.
 * The rows add up to the amount due. Without a
 * subscription the switch is a normal Checkout, so there is nothing to preview.
 */
export const POST = handle(async (req: Request) => {
  const me = await requireUser();
  requireRole(me, "OWNER");
  const body = Body.safeParse(await req.json());
  await limitByIp("billing", 20, 600);
  if (!body.success) throw new HttpError(400, "Invalid plan");
  const { plan, interval } = body.data;
  const change = await planChange(me.workspace, plan, interval);
  if (!change) return Response.json({ mode: "checkout" });
  if (change.same) return Response.json({ mode: "current" });
  const preview = await stripe().invoices.createPreview({
    customer: typeof change.sub.customer === "string" ? change.sub.customer : change.sub.customer.id,
    subscription: change.sub.id,
    subscription_details: { items: change.items, billing_cycle_anchor: { type: "now" }, proration_behavior: "always_invoice" },
  });
  const planPrice = await priceId(keyFor(PLAN_ITEM[plan], interval, hasFoundingPrices(change.sub)));
  const priceOf = (l: (typeof preview.lines.data)[number]) => {
    const p = l.pricing?.price_details?.price;
    return typeof p === "string" ? p : p?.id;
  };
  const charges = preview.lines.data.filter((l) => l.amount > 0);
  const planAmount = charges.filter((l) => priceOf(l) === planPrice).reduce((t, l) => t + l.amount, 0);
  const addOns = charges.reduce((t, l) => t + l.amount, 0) - planAmount;
  // The unused part of the current plan and add-ons, taken off today's charge.
  const credit = -preview.lines.data.reduce((t, l) => t + Math.min(0, l.amount), 0);
  const tax = (preview.total_taxes ?? []).reduce((t, x) => t + x.amount, 0);
  const discount = (preview.total_discount_amounts ?? []).reduce((t, x) => t + x.amount, 0);
  const dueToday = Math.max(0, preview.amount_due);
  return Response.json({
    mode: "change",
    dueToday,
    plan: planAmount,
    addOns,
    credit,
    tax,
    discount,
    // Credit already on the account (say from an earlier downgrade) that's used up first.
    balance: Math.min(Math.max(0, -preview.starting_balance), Math.max(0, preview.total)),
    leftover: Math.max(0, -preview.total),
    currency: preview.currency,
    paymentMethod: await paymentMethodLabel(change.sub),
    // Switching plans doesn't undo a cancellation; the dialog says so.
    cancelling: !!(change.sub.cancel_at || change.sub.cancel_at_period_end),
  });
});
