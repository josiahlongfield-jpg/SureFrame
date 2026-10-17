import type { Metadata } from "next";
import { cookies } from "next/headers";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PricingTable, { type CurrentPlan } from "@/components/PricingTable";
import { auth } from "@/auth";
import { RETENTION_DAYS } from "@/lib/retention";
import { AI_ASSIST_PRICES, AI_SUMMARIES_PER_MONTH, CLOUD_BACKUP_PRICE, CLOUD_BACKUP_PRICE_YEARLY, PAID_PLANS, PLANS, type PaidPlan } from "@/lib/plans";
import { foundingLastDay, foundingOpen } from "@/lib/founding";
import { automaticOffer, cachedOfferForCode, codeFromCookie, isCodeShaped, OFFER_COOKIE, offerIsFor, quietly, type Offer } from "@/lib/offers";
import { currentUser } from "@/lib/session";
import { isReferralCode, referralOffer } from "@/lib/referrals";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple plans priced by how many clients you work with, in US dollars. Clients always join free. Optional cloud backup and AI add-ons.",
};

const qldDay = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Brisbane" });

/**
 * The founding offer, a share link's code (or that it has ended) and the
 * automatic offer, above the plans. Offers only come off when a subscription
 * starts (a code typed in the switch box can come off a move up, never an
 * offer on its own), so that's what the banner says.
 */
function Offers({
  founding,
  ended,
  busy,
  linked,
  auto,
  referral,
}: {
  founding: string | null;
  ended: string | null;
  busy: boolean;
  linked: Offer | null;
  auto: Offer | null;
  referral: { code: string; summary: string } | null;
}) {
  const box = "mx-auto mt-6 max-w-3xl rounded-2xl border p-4 text-center text-sm";
  // A referral code comes off instead of any other offer (lib/referrals.ts).
  const offer = referral ? null : (linked ?? auto);
  const who = offer?.newCustomersOnly ? ", for businesses we've never billed before" : offer && offer !== linked ? ", for new subscriptions" : "";
  return (
    <>
      {founding && (
        <p className={`${box} border-primary-line bg-primary-soft text-ink`} data-testid="founding-banner">
          <span className="font-semibold">Founding prices:</span> start a subscription by {founding} and keep these prices for your plan, extra clients and extra
          staff for as long as it stays active, even if our prices go up.
        </p>
      )}
      {ended && (
        <p className={`${box} border-line bg-canvas text-muted`} data-testid="offer-ended">
          The code {ended} has ended or isn&rsquo;t valid. You can still subscribe at the prices below.
        </p>
      )}
      {busy && (
        <p className={`${box} border-line bg-canvas text-muted`} data-testid="offer-busy">
          We couldn&rsquo;t check that code just now. Open the link again in a few minutes.
        </p>
      )}
      {referral && (
        <p className={`${box} border-ok-line bg-ok-bg text-ok-fg`} data-testid="referral-banner">
          <span className="font-semibold">Referral code {referral.code}:</span> {referral.summary}, for businesses we&rsquo;ve never billed before. It
          comes off at checkout when you start a subscription.
        </p>
      )}
      {offer && (
        <p className={`${box} border-ok-line bg-ok-bg text-ok-fg`} data-testid="offer-banner">
          <span className="font-semibold">{offer === linked ? `Code ${offer.code}:` : "Offer:"}</span> {offer.summary}
          {who}.{offer.expiresAt ? ` Use it by ${qldDay(offer.expiresAt)}.` : ""} It comes off at checkout when you start a subscription
          {offer === linked ? "" : ", no code needed"}.
          {offer === linked ? "" : " Have a different code? Enter it on Settings > Billing before you choose a plan."}
        </p>
      )}
    </>
  );
}

/**
 * Everything the Free plan includes and leaves out, in one place (V4). Each line comes from lib/plans.ts, lib/retention.ts
 * or the Terms (section 10 for unused workspaces).
 */
function FreePlanInFull() {
  const free = PLANS.FREE;
  const rows: [string, string][] = [
    ["Clients", `${free.clientSeats} clients. Clients never pay and don't need an account.`],
    ["Videos", `${free.maxVideos} videos in total, not per month, counting videos recorded on any plan. Deleting a video doesn't give its place back. Replies and sending a video to more clients don't count.`],
    ["Length", `Up to ${free.maxDurationMin} minutes per video, and up to ${free.maxDurationMin} minutes for your own video and voice replies.`],
    ["Quality", `${free.maxResolution}p recording. Paid plans record in 1080p or 4K.`],
    ["What clients see", "A short SureFrame intro before your video, once on each device. Paid plans remove it and let you add your own logo and colours."],
    ["Video storage", `Videos are deleted from our servers ${RETENTION_DAYS} days after they're recorded. Save a video to your device to keep your own copy. Cloud backup is only on paid plans.`],
    ["Logins", `${free.staffSeats} login, yours. Staff logins are on Studio and Agency.`],
    ["Unused workspaces", "We may delete a Free workspace that hasn't been used for 12 months, after emailing you at least 30 days beforehand."],
  ];
  return (
    <section className="mx-auto mt-12 max-w-3xl rounded-2xl border border-line bg-surface p-6" aria-labelledby="free-in-full" data-testid="free-in-full">
      <h2 id="free-in-full" className="text-lg font-semibold text-ink">The Free plan in full</h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[10rem_1fr] sm:gap-x-6">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-medium text-ink">{k}</dt>
            <dd className="-mt-2 text-muted sm:mt-0">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default async function Pricing({ searchParams }: { searchParams: Promise<{ ended?: string; code?: string; plan?: string; interval?: string }> }) {
  const query = await searchParams;
  // The plan being looked at by someone signed in, so its card is marked and its button doesn't offer it again.
  const signedIn = !!(await auth())?.user;
  const me = signedIn ? await currentUser() : null;
  const current: CurrentPlan | null = me
    ? { plan: me.workspace.plan, interval: me.workspace.stripeSubscriptionId ? (me.workspace.billingInterval === "year" ? "year" : "month") : null, owner: me.role === "OWNER" }
    : null;
  // Back from signing in after choosing a paid plan (its "Get" link sends /pricing?plan=…&interval=… as the way back).
  const start =
    me?.role === "OWNER" && PAID_PLANS.includes(query.plan as PaidPlan)
      ? { plan: query.plan as PaidPlan, interval: query.interval === "year" ? ("year" as const) : ("month" as const) }
      : null;
  const code = codeFromCookie((await cookies()).get(OFFER_COOKIE)?.value);
  // Wrapped, so a code Stripe says has ended (null offer) differs from Stripe not answering in time (null lookup).
  const referralCode = isReferralCode(code);
  const [lookup, auto, referred] = await Promise.all([
    code && !referralCode ? quietly(cachedOfferForCode(code).then((offer) => ({ offer }))) : null,
    quietly(automaticOffer()),
    code && referralCode ? quietly(referralOffer(code).then((offer) => ({ offer }))) : null,
  ]);
  // A code given to one business only shows for that business.
  const given = lookup?.offer?.customer ? me : null;
  const mine = !lookup?.offer?.customer || (!!given && offerIsFor(lookup.offer, given.workspace.stripeCustomerId));
  const linked = mine ? (lookup?.offer ?? null) : null;
  const referral = referred?.offer ?? null;
  // A share link to a code Stripe doesn't know (/offer/CODE sends ?ended=CODE), else the remembered code if it has since ended.
  const endedLink = typeof query.ended === "string" && isCodeShaped(query.ended) ? query.ended.toUpperCase() : null;
  const ended = endedLink ?? (code && ((lookup && (!lookup.offer || !mine)) || (referred && !referred.offer)) ? code : null);
  return (
    <div data-theme="fresh" className="min-h-screen bg-canvas text-ink">
      <SiteHeader navy />
      <main className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="text-center">
          <p className="kicker">Pricing</p>
          <h1 className="display mt-3 text-4xl   text-ink">Simple pricing. Clients always free.</h1>
          <p className="mt-4 text-muted">Pick a plan by how many clients you work with.</p>
        </div>
        <Offers founding={foundingOpen() ? foundingLastDay() : null} ended={ended} busy={query.code === "busy"} linked={linked} auto={auto} referral={referral} />
        <PricingTable current={current} signedIn={signedIn} retentionDays={RETENTION_DAYS} start={start} />
        <p className="mt-10 text-center text-sm text-dim">More than 100 clients? Add extra clients for US$1.50 a month each.</p>
        <p className="mt-2 text-center text-sm text-dim" data-testid="free-videos-note">
          Free includes {PLANS.FREE.maxVideos} videos in total, not per month, counting videos recorded on any plan. Deleting a video doesn&rsquo;t give its place
          back. Replies and sending a video to more clients don&rsquo;t count.
        </p>
        <p className="mt-2 text-center text-sm text-dim" data-testid="currency-note">All prices are in US dollars (USD), plus any sales tax, VAT or GST that applies where you are. Checkout may offer to charge you in your own currency at Stripe&rsquo;s exchange rate; otherwise your bank converts it.</p>

        <FreePlanInFull />

        <section className="mx-auto mt-16 max-w-3xl" aria-labelledby="add-ons">
          <h2 id="add-ons" className="text-center text-2xl font-semibold tracking-tight text-ink">Optional add-ons</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-6" data-testid="addon-ai">
              <h3 className="font-semibold text-ink">AI transcripts and summaries</h3>
              <p className="mt-2 text-sm text-muted">
                A transcript and a short summary with key points and action items under each video, for your team and your client. The transcript is made on your own
                device and the audio isn&apos;t sent anywhere for it; only the transcript text is sent to Anthropic&apos;s Claude to write the summary. AI summaries can contain mistakes. Videos up to 30 minutes.
              </p>
              <ul className="mt-4 space-y-1 text-sm text-muted">
                {(["SOLO", "STUDIO", "AGENCY"] as const).map((id) => (
                  <li key={id} className="flex justify-between gap-3">
                    <span>{PLANS[id].name}</span>
                    <span>
                      US${AI_ASSIST_PRICES[id].month}/month or US${AI_ASSIST_PRICES[id].year}/year · up to {AI_SUMMARIES_PER_MONTH[id]} summaries a month
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-dim">Not available on Free. Off unless you switch it on. Works best on a computer.</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-6">
              <h3 className="font-semibold text-ink">Cloud backup</h3>
              <p className="mt-2 text-sm text-muted">Keep the encrypted copies of your videos on our servers until you delete them, instead of for {RETENTION_DAYS} days. We still can&apos;t open them.</p>
              <p className="mt-4 text-sm text-muted">US${CLOUD_BACKUP_PRICE}/month or US${CLOUD_BACKUP_PRICE_YEARLY}/year on any paid plan</p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
