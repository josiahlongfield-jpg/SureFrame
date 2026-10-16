import crypto from "node:crypto";
import type Stripe from "stripe";
import { Prisma, type ReferralCode } from "@prisma/client";
import { ACTIVE_STATUSES, productIds } from "@/lib/billing";
import { db, type Workspace } from "@/lib/db";
import { billedBefore, DISCOUNT_EXPAND } from "@/lib/offers";
import { HttpError } from "@/lib/session";
import { stripe } from "@/lib/stripe";
import { currentSubscription, isMissing } from "@/lib/subscription";

/**
 * Referrals (Josiah, 16 October 2026). A business paying for a plan has one
 * referral code, shown on Settings > Billing and never advertised. A business
 * we've never billed that subscribes with it gets 10% off its plan on every
 * bill while it stays subscribed. Once that first payment goes through, the
 * business that shared the code gets the same 10% off its plan, from its next
 * bill on, for as long as the business it referred stays subscribed. The 10%
 * is off whichever plan they're on, so it follows an upgrade.
 *
 * Each business takes part once, so nobody gets more than 10%: a business that
 * subscribed with a code has no code to share, and a code works once. It
 * can't be used by its own business or anyone on its team, or while the
 * sharer's subscription is set to end, and nothing is given once it has ended.
 */
export const REFERRAL_PERCENT = 10;
/** The reward goes on this long before the sharer's next bill, so it starts with that bill and not something bought before it. */
const REWARD_LEAD_MS = 2 * 3600_000;

/** Letters and digits that can't be mistaken for each other when read out. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const isReferralCode = (code: string | null | undefined) => !!code && /^REF-[A-Z0-9]{6}$/i.test(code.trim());
const newCode = () => `REF-${Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("")}`;

/** What the new business gets, in plain words. */
export const REFERRAL_SUMMARY = `${REFERRAL_PERCENT}% off your plan for as long as you stay subscribed`;

/** A workspace that's paying for a plan by card now (not one we gave for free), and not set to end. */
export const paying = (w: Pick<Workspace, "plan" | "stripeSubscriptionId" | "subscriptionStatus" | "cancelsAt">) =>
  w.plan !== "FREE" && !!w.stripeSubscriptionId && ACTIVE_STATUSES.has(w.subscriptionStatus ?? "") && !w.cancelsAt;

/** The code a business subscribed with, if it did: then it has no code of its own to share. */
export const referredBy = (workspaceId: string) => db.referralCode.findUnique({ where: { usedByWorkspaceId: workspaceId } });

/**
 * A business's referral code, made the first time it's asked for. Null without
 * a paid subscription (or one set to end), or for a business that subscribed
 * with someone else's code. A used code stays as the record of its reward.
 */
export async function referralCodeFor(workspace: Workspace): Promise<ReferralCode | null> {
  const found = await db.referralCode.findUnique({ where: { workspaceId: workspace.id } });
  if (found) return found;
  // A referral discount on its own subscription means it subscribed with a code, even before the webhook records which.
  if (!paying(workspace) || workspace.discountLabel?.startsWith("Referral:") || (await referredBy(workspace.id))) return null;
  for (let i = 0; i < 5; i++) {
    try {
      return await db.referralCode.create({ data: { code: newCode(), workspaceId: workspace.id } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      // Made at the same moment by another request, or (rarely) a code already taken: try again.
      const made = await db.referralCode.findUnique({ where: { workspaceId: workspace.id } });
      if (made) return made;
    }
  }
  throw new Error("couldn't make a referral code");
}

export const REFERRAL_UNUSABLE = "That referral code isn't valid, or it has already been used.";

/**
 * A referral code someone wants to subscribe with, if it still works: not
 * used, and its business still paying. With `me`, also that they can use it:
 * not their own business or team, never billed, and no code used before.
 */
export async function usableReferral(code: string, me?: { userId: string; workspace: Workspace }): Promise<ReferralCode> {
  const row = await db.referralCode.findUnique({ where: { code: code.trim().toUpperCase() }, include: { workspace: true } });
  if (!row || row.usedAt || !paying(row.workspace)) throw new HttpError(400, REFERRAL_UNUSABLE);
  if (!me) return row;
  const ownTeam = row.workspaceId === me.workspace.id || (await db.membership.count({ where: { workspaceId: row.workspaceId, userId: me.userId } })) > 0;
  if (ownTeam) throw new HttpError(400, "That's your own business's referral code. Share it with another business instead.");
  if (await referredBy(me.workspace.id)) throw new HttpError(400, "Your business has already used a referral code.");
  if ((await billedBefore(me.workspace.stripeCustomerId)) !== false) {
    throw new HttpError(400, "Referral codes are only for businesses we've never billed before.");
  }
  return row;
}

/**
 * A referral code from a share link or the pricing page, if it still works,
 * as the pricing banner and the code box describe it. Whether this business
 * can use it is checked at checkout.
 */
export async function referralOffer(code: string): Promise<{ code: string; summary: string } | null> {
  try {
    const row = await usableReferral(code);
    return { code: row.code, summary: REFERRAL_SUMMARY };
  } catch (err) {
    if (err instanceof HttpError) return null;
    throw err;
  }
}

/**
 * The referral discount, the same for both businesses: 10% off the plan (any
 * plan, so it follows an upgrade) for as long as the subscription lasts. Made
 * once in Stripe and found again by its id.
 */
export async function referralCoupon() {
  const id = `sureframe_referral_${REFERRAL_PERCENT}_forever`;
  try {
    return (await stripe().coupons.retrieve(id)).id;
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  const params: Stripe.CouponCreateParams = {
    id,
    name: `Referral: ${REFERRAL_PERCENT}% off your plan`,
    percent_off: REFERRAL_PERCENT,
    duration: "forever",
    applies_to: { products: await productIds(["solo", "studio", "agency"]) },
    metadata: { sureframe_scope: "plan", sureframe_kind: "referral" },
  };
  return (await stripe().coupons.create(params, { idempotencyKey: `${id}-v1` })).id;
}

const isReferralDiscount = (d: string | Stripe.Discount, coupon: string) =>
  typeof d !== "string" && !d.deleted && (typeof d.source?.coupon === "string" ? d.source.coupon : d.source?.coupon?.id) === coupon;

/** A subscription's discounts, as `discounts` entries that keep them, less any `drop`s. */
const keepDiscounts = (sub: Stripe.Subscription, drop?: (d: string | Stripe.Discount) => boolean) =>
  (sub.discounts ?? []).flatMap((d) => (drop?.(d) ? [] : typeof d === "string" ? [{ discount: d }] : d.deleted ? [] : [{ discount: d.id }]));

/**
 * A subscription a referral code started (its metadata carries the code), once
 * it's paid for: the code is used up and the sharer's 10% booked for just
 * before their next bill. Safe to call again for the same subscription.
 */
export async function recordReferral(sub: Stripe.Subscription) {
  const code = sub.metadata?.referralCode;
  const newWorkspaceId = sub.metadata?.workspaceId;
  if (!code || !newWorkspaceId || !ACTIVE_STATUSES.has(sub.status) || sub.status === "trialing") return;
  const row = await db.referralCode.findUnique({ where: { code }, include: { workspace: true } });
  if (!row || row.usedAt || row.workspaceId === newWorkspaceId) return;
  const end = row.workspace.currentPeriodEnd;
  const dueAt = end ? new Date(Math.max(Date.now(), end.getTime() - REWARD_LEAD_MS)) : new Date();
  try {
    await db.referralCode.updateMany({ where: { code, usedAt: null }, data: { usedAt: new Date(), usedByWorkspaceId: newWorkspaceId, rewardDueAt: dueAt } });
  } catch (err) {
    // This business already used another code: the first one counts.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
  // A code of its own made before this was recorded, and not shared yet, goes: a referred business doesn't get one.
  await db.referralCode.deleteMany({ where: { workspaceId: newWorkspaceId, usedAt: null } });
}

/**
 * Cron: puts each booked 10% on the sharer's subscription when their next bill
 * is close. A plan switch restarts billing, so the date follows the
 * subscription. A sharer whose subscription has ended, or whose referred
 * business has already left, gets nothing; one set to end waits in case they
 * renew after all.
 */
export async function applyReferralRewards(limit = 50) {
  const due = await db.referralCode.findMany({
    where: { usedAt: { not: null }, rewardAppliedAt: null, rewardLapsedAt: null, rewardDueAt: { lte: new Date() } },
    include: { workspace: true },
    take: limit,
  });
  let applied = 0;
  for (const r of due) {
    try {
      const referred = r.usedByWorkspaceId ? await db.workspace.findUnique({ where: { id: r.usedByWorkspaceId } }) : null;
      const sub = await currentSubscription(r.workspace, { expand: DISCOUNT_EXPAND });
      if (!referred?.stripeSubscriptionId || !sub || !ACTIVE_STATUSES.has(sub.status)) {
        await db.referralCode.update({ where: { code: r.code }, data: { rewardLapsedAt: new Date() } });
        continue;
      }
      // Set to end: there's no next bill to take it off, unless they turn renewal back on before then. Look again in an hour.
      if (sub.cancel_at_period_end || sub.cancel_at) {
        await db.referralCode.update({ where: { code: r.code }, data: { rewardDueAt: new Date(Date.now() + 3600_000) } });
        continue;
      }
      const renews = Math.max(0, ...sub.items.data.map((i) => i.current_period_end ?? 0)) * 1000;
      if (renews - Date.now() > REWARD_LEAD_MS + 3600_000) {
        await db.referralCode.update({ where: { code: r.code }, data: { rewardDueAt: new Date(renews - REWARD_LEAD_MS) } });
        continue;
      }
      const coupon = await referralCoupon();
      if (!(sub.discounts ?? []).some((d) => isReferralDiscount(d, coupon))) {
        await stripe().subscriptions.update(sub.id, { discounts: [...keepDiscounts(sub), { coupon }], proration_behavior: "none" });
      }
      await db.referralCode.update({ where: { code: r.code }, data: { rewardAppliedAt: new Date() } });
      applied++;
    } catch (err) {
      console.error("[billing] referral reward failed", JSON.stringify({ code: r.code, error: String(err).slice(0, 300) }));
    }
  }
  return { due: due.length, applied };
}

/**
 * A referred business's subscription ended: the sharer's 10% stops too (it
 * lasts while the business they brought stays), or is never given if it
 * hadn't started yet. From the webhook.
 */
export async function referredBusinessLeft(workspaceId: string) {
  const row = await db.referralCode.findUnique({ where: { usedByWorkspaceId: workspaceId }, include: { workspace: true } });
  if (!row || row.rewardEndedAt || row.rewardLapsedAt) return;
  // An old subscription ending while a newer one is running isn't leaving.
  const referred = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (referred?.stripeSubscriptionId && ACTIVE_STATUSES.has(referred.subscriptionStatus ?? "")) return;
  if (!row.rewardAppliedAt) {
    await db.referralCode.update({ where: { code: row.code }, data: { rewardLapsedAt: new Date() } });
    return;
  }
  const sub = await currentSubscription(row.workspace, { expand: DISCOUNT_EXPAND });
  if (sub && ACTIVE_STATUSES.has(sub.status)) {
    const coupon = await referralCoupon();
    if ((sub.discounts ?? []).some((d) => isReferralDiscount(d, coupon))) {
      await stripe().subscriptions.update(sub.id, { discounts: keepDiscounts(sub, (d) => isReferralDiscount(d, coupon)), proration_behavior: "none" });
    }
  }
  await db.referralCode.update({ where: { code: row.code }, data: { rewardEndedAt: new Date() } });
}
