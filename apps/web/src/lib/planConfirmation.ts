import type Stripe from "stripe";
import { ACTIVE_STATUSES, catalogOf, loadCatalog, planOf } from "@/lib/billing";
import { BRAND } from "@/lib/brand";
import { zoned } from "@/lib/dates";
import { db } from "@/lib/db";
import { LEGAL } from "@/lib/legal";
import { sendMail } from "@/lib/mail";
import { PLANS, RECEIPTS_NOTE, type Interval, type PaidPlan } from "@/lib/plans";
import { appUrl } from "@/lib/appUrl";
import { teamEmail } from "@/lib/teamEmail";

type Item = Pick<Stripe.SubscriptionItem, "price">;
/** The paid plan and billing period a subscription's items are for. */
function planIn(items: Item[] | undefined): { plan: PaidPlan; interval: Interval } | null {
  for (const i of items ?? []) {
    const plan = planOf(i.price);
    const interval = catalogOf(i.price)?.interval;
    if (plan && plan !== "FREE" && interval) return { plan: plan as PaidPlan, interval };
  }
  return null;
}

/**
 * What a subscription event means for the plan confirmation email (decision 16): "started" when a paid plan begins
 * (a new active subscription, or one whose first payment just went through), "changed" when an active one moves to
 * another plan or billing period. Renewals, seats, add-ons, cancelling and founding prices replacing standard ones send
 * nothing. Read from the event's own previous_attributes, so a switch the app already saved still counts.
 */
export function planEvent(event: Stripe.Event, sub: Stripe.Subscription): { kind: "started" | "changed"; plan: PaidPlan; interval: Interval } | null {
  if (!ACTIVE_STATUSES.has(sub.status) || sub.status === "past_due") return null;
  const now = planIn(sub.items.data);
  if (!now) return null;
  if (event.type === "customer.subscription.created") return { kind: "started", ...now };
  if (event.type !== "customer.subscription.updated") return null;
  const before = ((event.data as { previous_attributes?: Partial<Stripe.Subscription> }).previous_attributes ?? {}) as Partial<Stripe.Subscription>;
  if (before.status === "incomplete" || before.status === "incomplete_expired") return { kind: "started", ...now };
  if (!before.items) return null;
  const was = planIn(before.items.data);
  if (!was) return { kind: "started", ...now };
  return was.plan !== now.plan || was.interval !== now.interval ? { kind: "changed", ...now } : null;
}

/**
 * Claims the email for one Stripe event, so a redelivered event (or two servers handling it at once) sends it once.
 * Kept in the RateLimit table under the event's own day, whatever RATE_LIMITS says, and cleared with it a day or two
 * later (Stripe only redelivers an event it couldn't deliver, and stops after a few days).
 */
async function claim(event: Stripe.Event) {
  const day = 86_400_000;
  const at = Number.isFinite(event.created) ? event.created * 1000 : Date.now();
  const windowStart = new Date(Math.floor(at / day) * day);
  const rows = await db.$queryRaw<{ key: string }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${`plan-email:${event.id}`}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO NOTHING
    RETURNING "key"`;
  return rows.length === 1;
}
const unclaim = (event: Stripe.Event) => db.rateLimit.deleteMany({ where: { key: `plan-email:${event.id}` } });

export function planConfirmationEmail(o: { business: string; kind: "started" | "changed"; plan: PaidPlan; interval: Interval; renews: string | null; ends: string | null }) {
  const name = PLANS[o.plan].name;
  const period = o.interval === "year" ? "yearly" : "monthly";
  const when = o.ends ? `It's set to end on ${o.ends}, so it won't renew.` : o.renews ? `It renews on ${o.renews}.` : "";
  return teamEmail({
    business: BRAND.name,
    subject: o.renews && !o.ends ? `You're on ${name}, renews ${o.renews}` : `You're on ${name}`,
    lead:
      o.kind === "started"
        ? `Thanks for subscribing. ${o.business} is now on ${BRAND.name} ${name}, billed ${period}. ${when}`.trim()
        : `${o.business} has moved to ${BRAND.name} ${name}, billed ${period}. ${when}`.trim(),
    lines: [{ text: RECEIPTS_NOTE }],
    button: { label: "Open Billing", link: appUrl("/settings/billing") },
    footer: `You're getting this because you own ${o.business} on ${BRAND.name}. Questions? Email ${LEGAL.email}.`,
  });
}

/**
 * Called by the Stripe webhook after the subscription is saved: emails the business owner a short confirmation when a
 * paid plan starts or changes, once per event. A failed send is logged and not retried (Link's receipt still comes).
 */
export async function sendPlanConfirmation(event: Stripe.Event, sub: Stripe.Subscription) {
  await loadCatalog();
  // The change the event itself describes, if the subscription (as Stripe has it now) is still on that plan.
  const what = planEvent(event, event.data.object as Stripe.Subscription);
  const latest = planIn(sub.items.data);
  if (!what || !ACTIVE_STATUSES.has(sub.status) || latest?.plan !== what.plan || latest.interval !== what.interval) return false;
  const workspaceId = sub.metadata?.workspaceId;
  if (!workspaceId) return false;
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true, timezone: true, closedAt: true, deleteAt: true, stripeSubscriptionId: true, members: { where: { role: "OWNER" }, select: { user: { select: { email: true } } } } },
  });
  const to = workspace?.members[0]?.user.email;
  // Not for a second subscription the workspace doesn't use (lib/subscription.ts tells a person about that instead).
  if (!workspace || !to || workspace.closedAt || workspace.deleteAt || workspace.stripeSubscriptionId !== sub.id) return false;
  if (!(await claim(event))) return false;
  const item = sub.items.data.find((i) => planOf(i.price));
  const end = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
  const day = (d: Date) => zoned(workspace.timezone).longDay(d);
  const ending = sub.cancel_at ? new Date(sub.cancel_at * 1000) : sub.cancel_at_period_end ? end : null;
  try {
    await sendMail({ to, ...planConfirmationEmail({ business: workspace.name, ...what, renews: end ? day(end) : null, ends: ending ? day(ending) : null }) });
    return true;
  } catch (err) {
    await unclaim(event).catch(() => {});
    console.error(JSON.stringify({ level: "error", message: "[billing] plan confirmation email failed", workspace: workspaceId, event: event.id, error: String(err).slice(0, 300) }));
    return false;
  }
}
