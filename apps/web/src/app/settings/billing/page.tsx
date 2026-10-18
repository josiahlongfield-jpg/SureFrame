import type { Metadata } from "next";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import ManageBillingButton from "@/components/ManageBillingButton";
import CloudBackupToggle from "@/components/CloudBackupToggle";
import AiAssistToggle from "@/components/AiAssistToggle";
import RedeemCode from "@/components/RedeemCode";
import CopyText from "@/components/CopyText";
import CancelPlan from "@/components/CancelPlan";
import { summaryUsage } from "@/lib/ai/summary";
import { readManifest } from "@/lib/ai/speechModel";
import { RETENTION_DAYS } from "@/lib/retention";
import { AI_ASSIST_PRICES, aiAssistActive, CLOUD_BACKUP_PRICE, CLOUD_BACKUP_PRICE_YEARLY, PLANS, TEAM_PLANS, type Interval } from "@/lib/plans";
import { AI_ITEM, CATALOG, keyFor, PLAN_ITEM, type CatalogItem } from "@/lib/billing";
import type { Workspace } from "@/lib/db";
import { redirect } from "next/navigation";
import { agreePath, followTeamLink, requirePageUser } from "@/lib/session";
import { BRAND } from "@/lib/brand";
import { zoned } from "@/lib/dates";
import { videosUsed } from "@/lib/videoAllowance";
import { paying, REFERRAL_PERCENT, referralCodeFor, referredBy } from "@/lib/referrals";
import { appUrl } from "@/lib/stripe";

export const metadata: Metadata = { title: "Billing" };

/** The AI summaries add-on for this workspace's plan. */
async function AiAddOn({ workspace }: { workspace: Workspace }) {
  const paid = workspace.plan !== "FREE" ? AI_ASSIST_PRICES[workspace.plan] : null;
  const free = workspace.aiAssistComplimentary && workspace.plan !== "FREE";
  return (
    <AiAssistToggle
      enabled={aiAssistActive(workspace)}
      canEnable={free || (!!paid && !!workspace.stripeSubscriptionId)}
      needsSubscription={!!workspace.complimentaryPlan && !workspace.stripeSubscriptionId && !free}
      priceLabel={free || !paid ? null : `US$${paid.month} per month on ${PLANS[workspace.plan].name} (US$${paid.year} per year on yearly billing)`}
      usage={aiAssistActive(workspace) ? await summaryUsage(workspace) : null}
      modelReady={!!(await readManifest().catch(() => null))}
    />
  );
}

/** Free: how many of the plan's videos in total are used, deleted ones included. */
async function FreeVideosUsed({ workspaceId, limit }: { workspaceId: string; limit: number }) {
  const { used } = await videosUsed(workspaceId);
  return (
    <p className="mt-3 text-sm text-muted" data-testid="free-videos-used">
      {Math.min(used, limit)} of {limit} free videos used. Deleting a video doesn&apos;t give its place back.
    </p>
  );
}

const money = (cents: number) => `US$${cents % 100 ? (cents / 100).toFixed(2) : cents / 100}`;

/**
 * What a subscription costs each period, line by line: the plan, extra client
 * seats, extra staff logins and add-ons, from the same prices Stripe charges
 * (founding prices included). Before tax and any discount; Stripe's invoices
 * have the exact amounts.
 */
function WhatYouPay({ workspace, discount }: { workspace: Workspace; discount: string | null }) {
  if (workspace.plan === "FREE") return null;
  const interval: Interval = workspace.billingInterval === "year" ? "year" : "month";
  const each = (item: CatalogItem) => Math.round(CATALOG[keyFor(item, interval, workspace.foundingPrices)].amount * 100);
  const per = interval === "year" ? "a year" : "a month";
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const staff = TEAM_PLANS.includes(workspace.plan) ? workspace.extraStaffSeats : 0;
  const rows: { label: string; note?: string; cents: number; testId: string; free?: boolean }[] = [
    { label: `${PLANS[workspace.plan].name} plan`, cents: each(PLAN_ITEM[workspace.plan]), testId: "pay-plan" },
    ...(workspace.extraClientSeats
      ? [{ label: plural(workspace.extraClientSeats, "extra client seat", "extra client seats"), note: `${money(each("client_seat"))} each`, cents: workspace.extraClientSeats * each("client_seat"), testId: "pay-seats" }]
      : []),
    ...(staff ? [{ label: plural(staff, "extra staff login", "extra staff logins"), note: `${money(each("staff_seat"))} each`, cents: staff * each("staff_seat"), testId: "pay-staff" }] : []),
    ...(workspace.cloudBackup ? [{ label: "Cloud backup", cents: each("cloud_backup"), testId: "pay-backup" }] : []),
    ...(aiAssistActive(workspace)
      ? [{ label: "AI transcripts and summaries", cents: workspace.aiAssistComplimentary ? 0 : each(AI_ITEM[workspace.plan]), testId: "pay-ai", free: workspace.aiAssistComplimentary }]
      : []),
  ];
  const total = rows.reduce((t, r) => t + r.cents, 0);
  return (
    <div className="mt-5 rounded-xl border border-line bg-canvas p-4 text-sm" data-testid="what-you-pay">
      <p className="font-medium text-ink">What you pay</p>
      <ul className="mt-2 divide-y divide-line">
        {rows.map((r) => (
          <li key={r.testId} className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5" data-testid={r.testId}>
            <span className="text-muted">
              {r.label}
              {r.note && <span className="text-dim"> ({r.note})</span>}
            </span>
            <span className="text-ink">{r.free ? "Free" : `${money(r.cents)} ${per}`}</span>
          </li>
        ))}
        <li className="flex flex-wrap items-baseline justify-between gap-x-4 pt-2 font-semibold text-ink" data-testid="pay-total">
          <span>Total</span>
          <span>
            {money(total)} {per}
          </span>
        </li>
      </ul>
      <p className="mt-2 text-xs text-dim">
        Plus any tax{discount ? ", less your discount" : ""}. Extra client seats are added on the{" "}
        <Link href="/clients#buy-seats" className="font-medium text-accent hover:underline">Clients page</Link>
        {TEAM_PLANS.includes(workspace.plan) && (
          <>
            , extra staff logins on the <Link href="/settings/team" className="font-medium text-accent hover:underline">Team page</Link>
          </>
        )}
        , and add-ons below.
      </p>
    </div>
  );
}

/** A date as the workspace's owner would read it, in their own time zone. */
const day = (d: Date, timeZone: string | null) => zoned(timeZone).longDay(d);

/**
 * Refer a business (lib/referrals.ts): a paying business's own code and how
 * it works, or where its reward is up to once the code has been used.
 */
async function Referrals({ workspace }: { workspace: Workspace }) {
  const pct = `${REFERRAL_PERCENT}%`;
  const card = (body: React.ReactNode) => (
    <div className="mt-6 rounded-2xl border border-line bg-surface p-6" data-testid="referrals">
      <p className="font-semibold text-ink">Refer a business</p>
      {body}
    </div>
  );
  if (workspace.discountLabel?.startsWith("Referral:") || (await referredBy(workspace.id))) {
    if (!workspace.stripeSubscriptionId) return null;
    return card(
      <p className="mt-1 text-sm text-muted" data-testid="referral-joined">
        Your business started its subscription with another business&apos;s referral code, so it has {pct} off its plan for as long as you stay
        subscribed. Each business can take part in referrals once, so there&apos;s no code for you to share.
      </p>,
    );
  }
  const row = await referralCodeFor(workspace);
  if (!row) return null;
  const tz = workspace.timezone;
  if (!row.usedAt) {
    if (!paying(workspace)) return null;
    const link = appUrl(`/offer/${row.code}`);
    return card(
      <>
        <p className="mt-1 text-sm text-muted">
          Know another business that could use {BRAND.name}? Share your code with them. If a business we&apos;ve never billed before starts a paid plan
          with it, they get {pct} off their plan on every bill for as long as they stay subscribed.
        </p>
        <p className="mt-2 text-sm text-muted" data-testid="referral-reward-terms">
          Once their first payment goes through, you get {pct} off your plan too. <span className="font-medium text-ink">It starts from your next bill</span>,
          not the one you&apos;ve already paid, and then comes off every bill after that for as long as they stay subscribed.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-canvas px-3 py-1.5 font-mono text-base font-semibold tracking-wider text-ink" data-testid="referral-code">
            {row.code}
          </code>
          <CopyText text={row.code} label="Copy code" testId="referral-copy-code" />
          <CopyText text={link} label="Copy link" testId="referral-copy-link" />
        </div>
        <p className="mt-2 break-all text-xs text-dim" data-testid="referral-link">
          {link}
        </p>
        <p className="mt-3 text-xs text-dim">
          Your code works for one business. The {pct} comes off the plan itself, not extra clients, extra staff or add-ons, and stays with you if you move to
          a bigger plan. A business can&apos;t use its own code, and a business that joins with a code doesn&apos;t get one to share.
        </p>
      </>,
    );
  }
  const status = row.rewardEndedAt ? (
    <>
      Your {pct} referral discount ended on {day(row.rewardEndedAt, tz)} because the business you referred stopped subscribing.
    </>
  ) : row.rewardLapsedAt ? (
    <>
      Your code {row.code} was used, but the {pct} wasn&apos;t given because your subscription had ended, or the business you referred stopped subscribing,
      before your next bill.
    </>
  ) : row.rewardAppliedAt ? (
    <>
      Your {pct} referral discount is active. It comes off your plan on every bill for as long as the business you referred stays subscribed.
    </>
  ) : (
    <>
      Your code {row.code} was used on {day(row.usedAt, tz)}. Your {pct} off starts with your next bill
      {workspace.currentPeriodEnd ? <>, on {day(workspace.currentPeriodEnd, tz)},</> : ""} and then comes off every bill after that for as long as the
      business you referred stays subscribed.
    </>
  );
  return card(
    <p className="mt-1 text-sm text-muted" data-testid="referral-status">
      {status}
    </p>,
  );
}

export default async function Billing({ searchParams }: { searchParams: Promise<{ upgraded?: string; ws?: string }> }) {
  const { upgraded, ws } = await searchParams;
  await followTeamLink(ws, "/settings/billing");
  // Reachable before agreeing to updated terms, to manage or cancel the plan (Terms, introduction); the rest waits for /agree.
  const { user, workspace, role, agreed } = await requirePageUser(upgraded ? "/settings/billing?upgraded=1" : "/settings/billing", { allowTermsPending: true });
  if (!agreed && role !== "OWNER") redirect(agreePath("/settings/billing"));
  const plan = PLANS[workspace.plan];
  const comp = !!workspace.complimentaryPlan && !workspace.stripeSubscriptionId;
  const freeLimit = PLANS.FREE.maxVideos;
  // A discount past its end that no webhook has cleared yet isn't shown, and a new code can be entered.
  const discount =
    workspace.stripeSubscriptionId && workspace.discountLabel && !(workspace.discountEndsAt && workspace.discountEndsAt.getTime() <= Date.now())
      ? workspace.discountLabel
      : null;
  const afterCancel = (
    <>
      If you cancel, or a payment can&apos;t be taken, you move to the Free plan when the paid period ends. Clients and staff beyond its limits are then paused
      until you upgrade or remove some. Please tell them about any change.
      {freeLimit !== null && ` Free includes ${freeLimit} videos in total, counting the ones you've already recorded, so you may need a paid plan to record new ones.`}
      {workspace.cloudBackup && ` Cloud backup ends too, and our copies of your recordings are deleted ${RETENTION_DAYS} days later unless you subscribe again or save them.`}
    </>
  );
  if (role !== "OWNER") {
    return (
      <>
        <AppHeader email={user.email} plan={plan.name} />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Billing</h1>
          <p className="mt-6 rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
            {workspace.name} is on the {plan.name} plan. Only the workspace owner can change the plan or billing.
          </p>
        </main>
      </>
    );
  }
  return (
    <>
      <AppHeader email={user.email} plan={plan.name} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Billing</h1>
        {upgraded && (
          // Stripe's confirmation usually lands before the page does; until it has, say the plan is on its way.
          <p role="status" className="mt-4 rounded-xl border border-ok-line bg-ok-bg p-3 text-sm text-ok-fg" data-testid="upgraded">
            {workspace.stripeSubscriptionId && workspace.plan !== "FREE"
              ? `Thanks for upgrading. You're on ${plan.name} now. Your receipt comes by email from Link, Stripe's payment service.`
              : "Thanks for upgrading. Your plan updates as soon as payment is confirmed, usually within a minute. Reload this page to see it."}
          </p>
        )}
        <div className="mt-6 rounded-2xl border border-line bg-surface p-6">
          <p className="text-sm text-dim">{workspace.name}</p>
          <p className="mt-1 text-xl font-semibold text-ink">
            {plan.name} plan
            {workspace.stripeSubscriptionId && workspace.billingInterval && (
              <span className="ml-2 text-sm font-normal text-dim" data-testid="billing-interval">billed {workspace.billingInterval === "year" ? "yearly" : "monthly"}</span>
            )}
          </p>
          {comp && (
            <p className="mt-1 text-sm text-ok-fg">
              Complimentary from {BRAND.name}. No card needed. Choosing a paid plan replaces it with your own subscription; your clients and videos stay as they are.
              {workspace.aiAssistComplimentary && " Free AI summaries end then, and can be added as a paid add-on."}
            </p>
          )}
          {(workspace.subscriptionStatus === "past_due" || workspace.subscriptionStatus === "unpaid") && workspace.stripeSubscriptionId && (
            <p role="alert" className="mt-3 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg" data-testid="payment-failed">
              Your last payment didn&apos;t go through. Update your card under Manage subscription so your plan carries on.
            </p>
          )}
          {workspace.cancelsAt ? (
            <p className="mt-1 text-sm font-medium text-warn-fg" data-testid="cancels-on">
              Cancels {day(workspace.cancelsAt, workspace.timezone)}
            </p>
          ) : (
            workspace.currentPeriodEnd && (
              <p className="mt-1 text-sm text-dim" data-testid="renews-on">
                Renews {day(workspace.currentPeriodEnd, workspace.timezone)}
              </p>
            )
          )}
          {workspace.stripeSubscriptionId && workspace.foundingPrices && (
            <p className="mt-2 text-sm text-ok-fg" data-testid="founding-prices">
              <span className="font-semibold">Founding prices.</span> You keep today&apos;s prices for your plan, extra clients and extra staff while this
              subscription stays active, even if our prices go up.
            </p>
          )}
          {discount && (
            <p className="mt-2 text-sm text-muted" data-testid="discount">
              Discount: {discount}
              {workspace.discountEndsAt ? `, until ${day(workspace.discountEndsAt, workspace.timezone)}` : ""}.
            </p>
          )}
          {workspace.stripeSubscriptionId && <WhatYouPay workspace={workspace} discount={discount} />}
          {plan.showsPromo && (
            <p className="mt-3 rounded-xl bg-canvas p-3 text-sm text-muted">
              Your clients see a short SureFrame intro, once on each device. Any paid plan removes it and lets you add your own logo and colours (a small Made with {BRAND.name} credit stays).
            </p>
          )}
          <ul className="mt-4 space-y-1 text-sm text-muted">
            {plan.features.map((f) => <li key={f}>• {f}</li>)}
          </ul>
          {plan.maxVideos !== null && (
            <FreeVideosUsed workspaceId={workspace.id} limit={plan.maxVideos} />
          )}
          {workspace.stripeSubscriptionId && (
            <p className="mt-4 text-xs text-dim" data-testid="cancel-note">
              {afterCancel}
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            {workspace.stripeCustomerId && <ManageBillingButton />}
            {agreed && (
              <Link href="/pricing" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">
                {comp ? "Choose a paid plan" : workspace.plan === "FREE" ? "Upgrade" : "Change plan"}
              </Link>
            )}
          </div>
          {workspace.stripeCustomerId && (
            <p className="mt-2 text-xs text-dim" data-testid="receipts-note">
              Manage subscription opens Stripe&apos;s billing page, where you can change your card and see or download past invoices. Receipts for your
              payments come by email from Link, Stripe&apos;s payment service; {BRAND.name} doesn&apos;t send its own.
            </p>
          )}
          {workspace.stripeSubscriptionId && (
            <CancelPlan
              planName={plan.name}
              periodEnd={workspace.currentPeriodEnd ? day(workspace.currentPeriodEnd, workspace.timezone) : null}
              cancelsOn={workspace.cancelsAt ? day(workspace.cancelsAt, workspace.timezone) : null}
              whatHappens={<p>{afterCancel}</p>}
            />
          )}
          {!agreed && (
            <p className="mt-4 rounded-xl border border-line bg-canvas p-3 text-sm text-muted" data-testid="billing-terms-pending">
              To change your plan or add-ons, first <Link href={agreePath("/settings/billing")} className="font-medium text-accent hover:underline">agree to our updated terms</Link>. You can
              cancel your plan or choose Manage subscription without agreeing.
            </p>
          )}
          {/* Without a subscription a code is kept for checkout; on a running one, a code we gave this business comes off its next bill. */}
          {agreed && (!workspace.stripeSubscriptionId || !discount) && <RedeemCode subscribed={!!workspace.stripeSubscriptionId} />}
        </div>
        {agreed && <Referrals workspace={workspace} />}
        {agreed && (
          <>
        <CloudBackupToggle
          enabled={workspace.cloudBackup}
          canEnable={workspace.plan !== "FREE" && !!workspace.stripeSubscriptionId}
          needsSubscription={comp}
          price={CLOUD_BACKUP_PRICE}
          yearlyPrice={CLOUD_BACKUP_PRICE_YEARLY}
          days={RETENTION_DAYS}
        />
        <AiAddOn workspace={workspace} />
          </>
        )}
      </main>
    </>
  );
}
