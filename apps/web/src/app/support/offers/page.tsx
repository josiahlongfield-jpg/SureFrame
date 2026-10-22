import Link from "next/link";
import { notFound } from "next/navigation";
import CopyText from "@/components/CopyText";
import { foundingLastDay, foundingOpen } from "@/lib/founding";
import type { Offer } from "@/lib/offers";
import { appUrl } from "@/lib/stripe";
import { isFounder } from "@/lib/support/admin";
import { listOffers, MAX_OFFER_MONTHS, type GivenOffer } from "@/lib/support/offers";
import { qldDay } from "@/lib/support/when";
import PowerForm from "../_console/PowerForm";
import OfferTerms from "./OfferTerms";
import { Badge, consoleAdmin, Done, Facts, Section } from "../_console/ui";
import { supportTitle } from "../_console/meta";

export const generateMetadata = supportTitle("Discounts", "founder", { robots: { index: false } });

const field = "w-full rounded-xl border border-line-strong px-3 py-2 text-sm";

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

/** A ready-to-send email with the code, what it gives and how to use it. */
function mailto(o: GivenOffer, link: string) {
  const body = [
    "Hi,",
    "",
    `Here's a discount code for ${o.business?.name ?? "your business"} on SureFrame: ${o.code}`,
    `${o.summary}.${o.expiresAt ? ` Use it by ${qldDay(o.expiresAt)}.` : ""}`,
    "",
    `To use it, open this link (sign in first if asked): ${link}`,
  ].join("\n");
  return `mailto:${o.business!.ownerEmail}?subject=${encodeURIComponent("Your SureFrame discount code")}&body=${encodeURIComponent(body)}`;
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
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CopyText text={o.code} label="Copy code" testId={`copy-code-${o.code}`} />
          <CopyText text={link} label="Copy link" testId={`copy-link-${o.code}`} />
          {o.business?.ownerEmail && (
            // A draft in the founder's own email app, to check and send.
            <a href={mailto(o, link)} className="px-2 text-sm font-medium text-accent hover:underline" data-testid={`email-code-${o.code}`}>
              Email it to {o.business.ownerEmail}
            </a>
          )}
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
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Discounts</h1>
      <p className="mt-2 text-sm text-muted">
        Discount codes you give to one business at a time. Each code works once and only for the business it&rsquo;s given to: Stripe refuses it for anyone
        else, so passing it on does nothing. A business can hold more than one code, but a subscription takes only one discount, so only one of them can be
        used. Only you can give or cancel codes. Send the business its code or link yourself; they use it when they start a
        paid plan, add it to the plan they already pay for on Settings &gt; Billing (from their next bill), or when they move up to a bigger plan as long as it doesn&rsquo;t bring the new plan below what they pay now. Referral codes (REF-) are
        separate and work by themselves.
      </p>
      <p className="mt-2 text-sm text-muted" data-testid="founding-status">
        Founding prices: {founding ? `running, for subscriptions started by ${founding}.` : "not running. They're started with an end date in the site's settings, not from this page."}
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
            <input
              name="code"
              maxLength={40}
              pattern="[A-Za-z0-9\-]{3,40}"
              title="3 to 40 letters, digits or dashes"
              aria-describedby="code-hint"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className={`${field} uppercase`}
            />
            {/* The rule, before the browser's "Please match the requested format" (P28). */}
            <span id="code-hint" className="text-xs text-dim" data-testid="code-hint">
              3 to 40 letters, digits or dashes, such as SPRING-20. Not starting with REF- (those are referral codes).
            </span>
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
          <OfferTerms maxMonths={MAX_OFFER_MONTHS} />
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
    </div>
  );
}
