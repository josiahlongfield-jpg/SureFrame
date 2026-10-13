import type Stripe from "stripe";
import { adoptFoundingPrices } from "@/lib/billing";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { alertFounder } from "@/lib/founderAlert";
import { rateLimit } from "@/lib/rateLimit";
import { DISCOUNT_EXPAND } from "@/lib/offers";
import { forgetSubscription, syncSubscription } from "@/lib/subscription";

const money = (cents: number, currency: string) => `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;

/** One email per subject a day, however many times Stripe sends the event. */
const once = (key: string) => rateLimit(`alert:${key}`, 1, 86400).then(() => true, () => false);

/**
 * Re-reads a subscription (so out-of-order deliveries always apply the latest
 * state), gives it founding prices if it started during the offer without
 * them (lib/billing.ts), and records it. If founding prices couldn't be
 * given, the subscription is still recorded, the founder is told, and the
 * event fails so Stripe sends it again.
 */
async function syncWithFounding(id: string) {
  let sub = await stripe().subscriptions.retrieve(id, { expand: DISCOUNT_EXPAND });
  let failed: unknown = null;
  try {
    if (await adoptFoundingPrices(sub)) sub = await stripe().subscriptions.retrieve(id, { expand: DISCOUNT_EXPAND });
  } catch (err) {
    failed = err;
    console.error("[billing] couldn't give founding prices", JSON.stringify({ subscription: id, error: String(err).slice(0, 300) }));
    if (await once(`founding:${id}`)) {
      await alertFounder("Founding prices not given to a new subscription", [
        `Subscription ${id} (workspace ${sub.metadata?.workspaceId ?? "unknown"}) started while founding prices were offered, but they couldn't be added. Stripe will retry.`,
        "If it keeps failing: in the Stripe Dashboard, add the metadata foundingPrices = yes and switch its plan and extra-seat items to the sureframe_founding_* prices, with no proration.",
      ]);
    }
  }
  await syncSubscription(sub);
  if (failed) throw failed;
}

/** A customer deleted in the Stripe Dashboard: forget it, so a new one is made if they subscribe again. */
async function customerDeleted(customerId: string) {
  const workspace = await db.workspace.findUnique({ where: { stripeCustomerId: customerId } });
  if (!workspace) return;
  if (workspace.stripeSubscriptionId) await forgetSubscription(workspace, { customer: true });
  else await db.workspace.update({ where: { id: workspace.id }, data: { stripeCustomerId: null } });
}

const workspaceForCustomer = (customer: string | Stripe.Customer | Stripe.DeletedCustomer | null) =>
  customer ? db.workspace.findUnique({ where: { stripeCustomerId: typeof customer === "string" ? customer : customer.id } }) : null;

/**
 * Stripe (or Link support) refunded a payment. Access isn't changed
 * automatically: a person decides whether the subscription should end too.
 */
async function refunded(charge: Stripe.Charge) {
  const workspace = await workspaceForCustomer(charge.customer);
  if (!(await once(`refund:${charge.id}:${charge.amount_refunded}`))) return;
  await alertFounder(`Refund for ${workspace?.name ?? "a customer"}`, [
    `${money(charge.amount_refunded, charge.currency)} of a ${money(charge.amount, charge.currency)} payment was refunded${charge.refunded ? " (all of it)" : ""}.`,
    workspace ? `Workspace: ${workspace.name} (${workspace.id}), plan ${workspace.plan}.` : `Stripe customer: ${String(charge.customer ?? "unknown")}.`,
    "Their subscription carries on. If the refund means it should end, cancel it in the Stripe Dashboard under Customers.",
  ]);
}

/**
 * A customer disputed a payment. Their subscription stops renewing (more
 * charges would only bring more disputes) but nothing is taken away before the
 * period they paid for ends, as Terms section 10 says; a person decides the rest.
 */
async function disputed(dispute: Stripe.Dispute) {
  const charge = typeof dispute.charge === "string" ? await stripe().charges.retrieve(dispute.charge) : dispute.charge;
  const workspace = await workspaceForCustomer(charge.customer);
  let stopped = false;
  if (workspace?.stripeSubscriptionId) {
    stopped = await stripe()
      .subscriptions.update(workspace.stripeSubscriptionId, { cancel_at_period_end: true })
      .then(() => true, (err) => (console.log("[billing] stopping renewal after dispute failed", String(err)), false));
  }
  // Not turned back on by "Keep my account" either (lib/accountDeletion.ts restoreAccount), if they'd closed it.
  if (workspace?.renewalStoppedAt) await db.workspace.update({ where: { id: workspace.id }, data: { renewalStoppedAt: null } });
  if (!(await once(`dispute:${dispute.id}`))) return;
  await alertFounder(`Payment disputed by ${workspace?.name ?? "a customer"}`, [
    `A ${money(dispute.amount, dispute.currency)} payment was disputed (reason: ${dispute.reason}).`,
    workspace
      ? `Workspace: ${workspace.name} (${workspace.id}). ${stopped ? "Their subscription won't renew, so they aren't charged again; it stays active until the period they paid for ends. To keep it going, turn renewal back on in the Stripe Dashboard." : "Their subscription couldn't be stopped from renewing; do it in the Stripe Dashboard."}`
      : `Stripe customer: ${String(charge.customer ?? "unknown")}.`,
    "Stripe handles the dispute itself; check it in the Stripe Dashboard under Disputes.",
  ]);
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new Response("Bad signature", { status: 400 });
  }

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await syncWithFounding(event.data.object.id);
      break;
    case "customer.subscription.deleted":
      // Re-read so out-of-order deliveries always apply the latest state.
      await syncSubscription(await stripe().subscriptions.retrieve(event.data.object.id, { expand: DISCOUNT_EXPAND }));
      break;
    case "customer.deleted":
      await customerDeleted(event.data.object.id);
      break;
    case "charge.refunded":
      await refunded(event.data.object);
      break;
    case "charge.dispute.created":
      await disputed(event.data.object);
      break;
  }
  return new Response("ok");
}
