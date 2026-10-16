import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CopyText from "@/components/CopyText";
import { foundingLastDay, foundingOpen } from "@/lib/founding";
import type { Offer } from "@/lib/offers";
import { appUrl } from "@/lib/stripe";
import { isFounder } from "@/lib/support/admin";
import { listOffers, MAX_OFFER_MONTHS, type GivenOffer } from "@/lib/support/offers";
import PowerForm from "../_console/PowerForm";
import { Badge, ConsoleNav, consoleAdmin, Done, Facts, Section } from "../_console/ui";

export const metadata: Metadata = { title: "Discounts", robots: { index: false } };

const field = "w-full rounded-xl border border-line-strong px-3 py-2 text-sm";
const qldDay = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Brisbane" });

function status(o: Offer) {
  if (!o.active) return <Badge>Ended</Badge>;
  if (o.maxUses !== null && o.uses >= o.maxUses) return <Badge tone="green">{o.maxUses === 1 ? "Used" : "Used up"}</Badge>;
  if (o.expiresAt && o.expiresAt.getTime() <= Date.now()) return <Badge tone="amber">Expired</Badge>;
  return <Badge tone="green">Active</Badge>;
}

/** Who can use an offer (lib/offers.ts: a new subscription, or moving up a plan; Stripe's new-customer rule is "never billed"). */
function whoCanUse(o: GivenOffer) {
  if (o.customer) {
    return o.business ? (
      <Link key="b" href={`/support/workspaces/${o.business.id}`} className="text-accent hover:underline">
        {o.business.name}
        {o.business.ownerEmail ? ` (${o.business.ownerEmail})` : ""} only
      </Link>
    ) : (
      "One business only (no longer found)"
    );
  }
  if (o.newCustomersOnly) return "Anyone we've never billed before (an older code, made before codes were tied to one business)";
  return "Anyone (an older code, made before codes were tied to one business)";
}

function OfferCard({ o }: { o: GivenOffer }) {
  const link = appUrl(`/offer/${o.code}`);
  return (
    <div className="rounded-2xl border border-line bg-surface p-4" data-testid={`offer-${o.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-base font-semibold text-ink">{o.code}</span>
        {status(o)}
        {o.automatic && o.active && <Badge tone="purple">Applied automatically</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted">{o.summary}</p>
      <div className="mt-3">
        <Facts
          rows={[
            ["Used", `${o.uses}${o.maxUses !== null ? ` of ${o.maxUses}` : ""} time${o.uses === 1 && o.maxUses === null ? "" : "s"}`],
            ["For", whoCanUse(o)],
            ["Last day to use it", o.expiresAt ? qldDay(o.expiresAt) : "No end date"],
            ["Link for them", <span key="l" className="break-all font-mono text-xs">{link}</span>],
            ["Created", qldDay(o.created)],
          ]}
        />
      </div>
      {o.active && o.usable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <CopyText text={o.code} label="Copy code" testId={`copy-code-${o.code}`} />
          <CopyText text={link} label="Copy link" testId={`copy-link-${o.code}`} />
        </div>
      )}
      {o.active && (
        <div className="mt-3 grid gap-2">
          {o.automatic && (
            <PowerForm power="autoOfferOff" hidden={{ promotionCodeId: o.id }} title="Stop applying it automatically" submit="Stop applying automatically" testId={`auto-off-${o.code}`}>
              <p className="text-sm text-muted">An older code applied to every new subscription. It stops being applied without the code; the code itself keeps working.</p>
            </PowerForm>
          )}
          <PowerForm power="endOffer" hidden={{ promotionCodeId: o.id }} title="Cancel this code" submit="Cancel code" danger testId={`end-${o.code}`}>
            <p className="text-sm text-muted">The code can&rsquo;t be used from now on. A discount already taken with it keeps running for the time it was given.</p>
          </PowerForm>
        </div>
      )}
    </div>
  );
}

/** The founder only: discount codes, each given to one business and used once (lib/support/offers.ts). */
export default async function Discounts({ searchParams }: { searchParams: Promise<{ done?: string; email?: string }> }) {
  const admin = await consoleAdmin("/support/offers");
  if (!isFounder(admin.email)) notFound();
  const { done, email: prefill } = await searchParams;
  let offers: GivenOffer[] = [];
  let error: string | null = null;
  try {
    offers = await listOffers();
  } catch (err) {
    error = String((err as Error)?.message ?? err).slice(0, 200);
  }
  const live = offers.filter((o) => o.active && o.usable);
  const ended = offers.filter((o) => !(o.active && o.usable));
  const founding = foundingOpen() ? foundingLastDay() : null;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <ConsoleNav />
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Discounts</h1>
      <p className="mt-2 text-sm text-muted">
        Discount codes you give to one business at a time. Each code works once and only for the business it&rsquo;s given to: Stripe refuses it for anyone
        else, so passing it on does nothing. Only you can give or cancel codes. Send the business its code or link yourself; they use it when they start a
        paid plan, or when they move up to a bigger plan as long as it doesn&rsquo;t bring the new plan below what they pay now. Referral codes (REF-) are
        separate and work by themselves.
      </p>
      <p className="mt-2 text-sm text-muted" data-testid="founding-status">
        Founding prices: {founding ? `running, for subscriptions started by ${founding}.` : "not running. Ask Claude to start them with an end date."}
      </p>
      <Done id={done} />
      {error && (
        <p role="alert" className="mt-6 rounded-xl bg-danger-bg p-3 text-sm text-danger-fg">
          Stripe couldn&rsquo;t be reached ({error}). Try again shortly.
        </p>
      )}

      <Section title="Give a discount">
        <PowerForm power="createOffer" hidden={{}} title="Give a business a discount code" submit="Make code" testId="create-offer">
          <label className="grid gap-1 text-sm text-muted">
            The business owner&rsquo;s email (the account the code is for)
            <input name="email" type="email" required maxLength={320} defaultValue={prefill ?? ""} autoComplete="off" spellCheck={false} className={field} />
          </label>
          <label className="grid gap-1 text-sm text-muted">
            Code (optional: leave empty and one is made up, like SF-7KQ2MX4P)
            <input name="code" maxLength={40} pattern="[A-Za-z0-9-]{3,40}" autoCapitalize="characters" autoComplete="off" spellCheck={false} className={`${field} uppercase`} />
          </label>
          <label className="grid gap-1 text-sm text-muted">
            Percentage off
            <input name="percentOff" type="number" required min={1} max={100} step={1} inputMode="numeric" className={field} />
          </label>
          <label className="grid gap-1 text-sm text-muted">
            Comes off
            <select name="scope" required defaultValue="plan" className={field}>
              <option value="plan">The plan only</option>
              <option value="seats">The plan, extra clients and extra staff</option>
              <option value="all">Everything, add-ons included</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-muted">
            How long it lasts
            <select name="duration" required defaultValue="repeating" className={field}>
              <option value="once">The first bill only (new subscriptions only)</option>
              <option value="repeating">A number of months (enter below)</option>
              <option value="forever">For as long as they stay subscribed</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-muted">
            Months (for &ldquo;a number of months&rdquo;)
            <input name="months" type="number" min={1} max={MAX_OFFER_MONTHS} step={1} inputMode="numeric" className={field} />
            <span className="text-xs text-dim">
              Up to {MAX_OFFER_MONTHS}. It comes off every bill that starts within those months. On yearly billing that&rsquo;s the whole first yearly bill, so 3
              months at 20% saves 20% of a year, and at 12 months it may come off the second yearly bill too.
            </span>
          </label>
          <label className="grid gap-1 text-sm text-muted">
            Last day it can be used, Queensland time (empty for no end date)
            <input name="lastDay" type="date" className={field} />
          </label>
          <p className="text-xs text-dim">
            Tell them exactly what the discount is, including any last day, and don&rsquo;t cancel a code early that you promised would last to a date.
          </p>
        </PowerForm>
      </Section>

      <Section title={`Current codes (${live.length})`}>
        {live.length ? <div className="grid gap-3">{live.map((o) => <OfferCard key={o.id} o={o} />)}</div> : <p className="text-sm text-muted">No codes waiting to be used.</p>}
      </Section>
      {ended.length > 0 && (
        <Section title={`Used or cancelled (${ended.length})`}>
          <div className="grid gap-3">
            {ended.map((o) => (
              <OfferCard key={o.id} o={o} />
            ))}
          </div>
        </Section>
      )}
    </main>
  );
}
