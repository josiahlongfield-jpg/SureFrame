import type { Metadata } from "next";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import ManageBillingButton from "@/components/ManageBillingButton";
import CloudBackupToggle from "@/components/CloudBackupToggle";
import AiAssistToggle from "@/components/AiAssistToggle";
import RedeemCode from "@/components/RedeemCode";
import { summaryUsage } from "@/lib/ai/summary";
import { readManifest } from "@/lib/ai/speechModel";
import { RETENTION_DAYS } from "@/lib/retention";
import { AI_ASSIST_PRICES, aiAssistActive, CLOUD_BACKUP_PRICE, CLOUD_BACKUP_PRICE_YEARLY, PLANS } from "@/lib/plans";
import type { Workspace } from "@/lib/db";
import { followTeamLink, requirePageUser } from "@/lib/session";
import { BRAND } from "@/lib/brand";
import { zoned } from "@/lib/dates";
import { videosUsed } from "@/lib/videoAllowance";

export const metadata: Metadata = { title: "Billing" };

/** The AI summaries add-on for this workspace's plan. */
async function AiAddOn({ workspace }: { workspace: Workspace }) {
  const paid = workspace.plan !== "FREE" ? AI_ASSIST_PRICES[workspace.plan] : null;
  const free = workspace.aiAssistComplimentary && workspace.plan !== "FREE";
  return (
    <AiAssistToggle
      enabled={aiAssistActive(workspace)}
      canEnable={free || (!!paid && !!workspace.stripeSubscriptionId)}
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
    <p className="mt-3 text-sm text-slate-700" data-testid="free-videos-used">
      {Math.min(used, limit)} of {limit} free videos used. Deleting a video doesn&apos;t give its place back.
    </p>
  );
}

/** A date as the workspace's owner would read it, in their own time zone. */
const day = (d: Date, timeZone: string | null) => zoned(timeZone).longDay(d);

export default async function Billing({ searchParams }: { searchParams: Promise<{ upgraded?: string; ws?: string }> }) {
  const { upgraded, ws } = await searchParams;
  await followTeamLink(ws, "/settings/billing");
  const { user, workspace, role } = await requirePageUser(upgraded ? "/settings/billing?upgraded=1" : "/settings/billing");
  const plan = PLANS[workspace.plan];
  const comp = !!workspace.complimentaryPlan && !workspace.stripeSubscriptionId;
  const freeLimit = PLANS.FREE.maxVideos;
  if (role !== "OWNER") {
    return (
      <>
        <AppHeader email={user.email} plan={plan.name} />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Billing</h1>
          <p className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
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
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Billing</h1>
        {upgraded && (
          <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            Thanks for upgrading. Your plan updates as soon as payment is confirmed.
          </p>
        )}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-sm text-slate-500">{workspace.name}</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {plan.name} plan
            {workspace.stripeSubscriptionId && workspace.billingInterval && (
              <span className="ml-2 text-sm font-normal text-slate-500" data-testid="billing-interval">billed {workspace.billingInterval === "year" ? "yearly" : "monthly"}</span>
            )}
          </p>
          {comp && (
            <p className="mt-1 text-sm text-emerald-700">
              Complimentary from {BRAND.name}. No card needed. Choosing a paid plan replaces it with your own subscription; your clients and videos stay as they are.
              {workspace.aiAssistComplimentary && " Free AI summaries end then, and can be added as a paid add-on."}
            </p>
          )}
          {(workspace.subscriptionStatus === "past_due" || workspace.subscriptionStatus === "unpaid") && workspace.stripeSubscriptionId && (
            <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="payment-failed">
              Your last payment didn&apos;t go through. Update your card under Manage subscription so your plan carries on.
            </p>
          )}
          {workspace.cancelsAt ? (
            <p className="mt-1 text-sm font-medium text-amber-700" data-testid="cancels-on">
              Cancels {day(workspace.cancelsAt, workspace.timezone)}
            </p>
          ) : (
            workspace.currentPeriodEnd && (
              <p className="mt-1 text-sm text-slate-500" data-testid="renews-on">
                Renews {day(workspace.currentPeriodEnd, workspace.timezone)}
              </p>
            )
          )}
          {workspace.stripeSubscriptionId && workspace.foundingPrices && (
            <p className="mt-2 text-sm text-emerald-700" data-testid="founding-prices">
              <span className="font-semibold">Founding prices.</span> You keep today&apos;s prices for your plan, extra clients and extra staff while this
              subscription stays active, even if our prices go up.
            </p>
          )}
          {workspace.stripeSubscriptionId && workspace.discountLabel && (
            <p className="mt-2 text-sm text-slate-700" data-testid="discount">
              Discount: {workspace.discountLabel}
              {workspace.discountEndsAt ? `, until ${day(workspace.discountEndsAt, workspace.timezone)}` : ""}.
            </p>
          )}
          {plan.showsPromo && (
            <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              Your clients see a short SureFrame intro before each video. Any paid plan removes it and lets you add your own logo and colours (a small Made with {BRAND.name} credit stays).
            </p>
          )}
          <ul className="mt-4 space-y-1 text-sm text-slate-700">
            {plan.features.map((f) => <li key={f}>• {f}</li>)}
          </ul>
          {plan.maxVideos !== null && (
            <FreeVideosUsed workspaceId={workspace.id} limit={plan.maxVideos} />
          )}
          {workspace.stripeSubscriptionId && (
            <p className="mt-4 text-xs text-slate-500" data-testid="cancel-note">
              If you cancel, or a payment can&apos;t be taken, you move to the Free plan when the paid period ends. Clients and staff beyond its limits are then
              paused until you upgrade or remove some. Please tell them about any change.
              {freeLimit !== null && ` Free includes ${freeLimit} videos in total, counting the ones you've already recorded, so you may need a paid plan to record new ones.`}
              {workspace.cloudBackup && ` Cloud backup ends too, and our copies of your recordings are deleted ${RETENTION_DAYS} days later unless you subscribe again or save them.`}
            </p>
          )}
          <div className="mt-6 flex gap-3">
            {workspace.stripeCustomerId && <ManageBillingButton />}
            {(workspace.plan !== "AGENCY" || comp) && (
              <Link href="/pricing" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">{comp ? "Choose a paid plan" : "Upgrade"}</Link>
            )}
          </div>
          <RedeemCode subscribed={!!workspace.stripeSubscriptionId} hasDiscount={!!(workspace.stripeSubscriptionId && workspace.discountLabel)} />
        </div>
        <CloudBackupToggle
          enabled={workspace.cloudBackup}
          canEnable={workspace.plan !== "FREE" && !!workspace.stripeSubscriptionId}
          needsSubscription={comp}
          price={CLOUD_BACKUP_PRICE}
          yearlyPrice={CLOUD_BACKUP_PRICE_YEARLY}
          days={RETENTION_DAYS}
        />
        <AiAddOn workspace={workspace} />
      </main>
    </>
  );
}
