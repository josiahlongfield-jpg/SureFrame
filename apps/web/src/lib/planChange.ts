import type Stripe from "stripe";
import { db, type Workspace } from "@/lib/db";
import { ACTIVE_STATUSES, AI_ITEM, catalogOf, hasFoundingPrices, isAiItem, keyFor, PLAN_ITEM, planOf, priceId } from "@/lib/billing";
import { PLANS, staffSeatLimit, TEAM_PLANS, type Interval, type PaidPlan } from "@/lib/plans";
import { HttpError } from "@/lib/session";
import { stripe } from "@/lib/stripe";
import { currentSubscription } from "@/lib/subscription";

export type PlanChange = {
  sub: Stripe.Subscription;
  items: Stripe.SubscriptionUpdateParams.Item[];
  /** True when the plan and interval are already the ones asked for. */
  same: boolean;
  /** Some items are removed (extra staff when leaving a team plan, or extra client seats the new plan includes). */
  removesItems: boolean;
  /** Extra client seats the new plan makes unnecessary, taken off as part of the switch: how many there are now and after. */
  seats: { from: number; to: number } | null;
};

const clientsUsed = (workspaceId: string) => db.client.count({ where: { workspaceId, removedAt: null } });

/**
 * Throws when the workspace has more clients or staff than the plan (plus its extra seats) allows, saying how many
 * to remove and where. The code (TOO_MANY_CLIENTS or TOO_MANY_STAFF) lets the pricing page link there.
 */
export async function assertFits(workspace: Workspace, plan: PaidPlan) {
  const { name, clientSeats } = PLANS[plan];
  const used = await clientsUsed(workspace.id);
  const clientLimit = clientSeats + workspace.extraClientSeats;
  if (clientLimit < used) {
    const allows = workspace.extraClientSeats ? `${clientSeats} clients, plus your ${workspace.extraClientSeats} extra` : `${clientSeats} clients`;
    throw new HttpError(
      400,
      `${name} includes ${allows}, and you have ${used}. Remove ${used - clientLimit} on the Clients page, or add extra client seats, then try again.`,
      "TOO_MANY_CLIENTS",
    );
  }
  const staff = await db.membership.count({ where: { workspaceId: workspace.id } });
  const staffLimit = staffSeatLimit({ plan, extraStaffSeats: workspace.extraStaffSeats });
  if (staffLimit < staff) {
    throw new HttpError(
      400,
      `${name} has ${staffLimit} ${staffLimit === 1 ? "login" : "logins"}, and your team has ${staff} people. Remove ${staff - staffLimit} on the Team page, then try again.`,
      "TOO_MANY_STAFF",
    );
  }
}

/**
 * How an existing subscription changes to another plan or interval, or null
 * when there is no active subscription (a new one goes through Checkout).
 * Throws when the workspace has more clients or staff than the plan allows.
 */
export async function planChange(workspace: Workspace, plan: PaidPlan, interval: Interval): Promise<PlanChange | null> {
  const sub = await currentSubscription(workspace, { expand: ["default_payment_method"] });
  if (!sub || !ACTIVE_STATUSES.has(sub.status)) return null;
  // Founding subscriptions keep founding prices on whichever plan they move to (lib/founding.ts).
  const founding = hasFoundingPrices(sub);
  const price = await priceId(keyFor(PLAN_ITEM[plan], interval, founding));
  const item = sub.items.data.find((i) => planOf(i.price));
  if (item?.price.id === price) return { sub, items: [], same: true, removesItems: false, seats: null };

  await assertFits(workspace, plan);
  // Moving to a plan that includes more clients: extra client seats it now covers come off with the switch (Solo with 12
  // clients and 2 extra seats moving to Studio, which includes 40, needs none), so you never pay twice for the same room.
  // Never fewer than the clients you have need; staying on the same size or moving down keeps every seat.
  const seatItems = sub.items.data.filter((i) => catalogOf(i.price)?.item === "client_seat");
  const bought = seatItems.reduce((t, i) => t + (i.quantity ?? 0), 0);
  const fromPlan = item ? planOf(item.price) : null;
  const more = fromPlan ? PLANS[plan].clientSeats - PLANS[fromPlan].clientSeats : 0;
  const needed = Math.max(0, (await clientsUsed(workspace.id)) - PLANS[plan].clientSeats);
  const keep = Math.max(needed, bought - more);
  const seats = more > 0 && keep < bought ? { from: bought, to: keep } : null;
  // Every item on a subscription bills on the same interval, so extras move with the plan.
  const extras = await Promise.all(
    sub.items.data
      .filter((i) => i !== item)
      .map(async (i): Promise<Stripe.SubscriptionUpdateParams.Item | null> => {
        const entry = catalogOf(i.price);
        // Unneeded extra client seats: the first seat item keeps what's still needed, any others go.
        if (seats && entry?.item === "client_seat") {
          if (i !== seatItems[0] || seats.to === 0) return { id: i.id, deleted: true };
          return { id: i.id, quantity: seats.to, ...(entry.interval !== interval ? { price: await priceId(keyFor("client_seat", interval, founding)) } : {}) };
        }
        // Extra staff only exist on team plans.
        if (entry?.item === "staff_seat" && !TEAM_PLANS.includes(plan)) return { id: i.id, deleted: true };
        // AI summaries are priced by plan, so the add-on follows the new plan.
        const target = entry && isAiItem(entry.item) ? AI_ITEM[plan] : entry?.item;
        return entry && target && (entry.interval !== interval || target !== entry.item) ? { id: i.id, price: await priceId(keyFor(target, interval, founding)) } : null;
      }),
  );
  const items = [item ? { id: item.id, price } : { price, quantity: 1 }, ...extras.filter((x) => x !== null)];
  return { sub, items, same: false, removesItems: items.some((i) => i.deleted), seats };
}

/** The card (or other method) the subscription is charged to, for showing to the owner. */
export async function paymentMethodLabel(sub: Stripe.Subscription): Promise<string | null> {
  let pm = sub.default_payment_method;
  if (!pm || typeof pm === "string") {
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const customer = await stripe().customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] });
    pm = customer.deleted ? null : customer.invoice_settings?.default_payment_method ?? null;
  }
  if (!pm || typeof pm === "string") return null;
  if (pm.card) return `${pm.card.brand.charAt(0).toUpperCase()}${pm.card.brand.slice(1)} ending ${pm.card.last4}`;
  if (pm.type === "link") return "your Link account";
  return pm.type.replace(/_/g, " ");
}
