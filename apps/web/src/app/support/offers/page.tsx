import type { Metadata } from "next";
import { foundingLastDay, foundingOpen } from "@/lib/founding";
import type { Offer } from "@/lib/offers";
import { appUrl } from "@/lib/stripe";
import { listOffers, MAX_OFFER_MONTHS } from "@/lib/support/offers";
import PowerForm, { Check } from "../_console/PowerForm";
import { Badge, ConsoleNav, consoleAdmin, Done, Facts, Section } from "../_console/ui";

export const metadata: Metadata = { title: "Offers", robots: { index: false } };

const field = "w-full rounded-xl border border-line-strong px-3 py-2 text-sm";
const qldDay = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Brisbane" });

function status(o: Offer) {
  if (!o.active) return <Badge>Ended</Badge>;
  if (o.maxUses !== null && o.uses >= o.maxUses) return <Badge tone="amber">Used up</Badge>;
  if (o.expiresAt && o.expiresAt.getTime() <= Date.now()) return <Badge tone="amber">Expired</Badge>;
  return <Badge tone="green">Active</Badge>;
}

/** Who can use an offer (lib/offers.ts: a new subscription, or moving up a plan; Stripe's new-customer rule is "never billed"). */
function whoCanUse(o: Offer) {
  if (o.newCustomersOnly) return "Businesses we've never billed before, when they start a subscription";
  return "Businesses starting a subscription, or moving up to a bigger plan when the code doesn't make it cheaper than their current one";
}

function OfferCard({ o }: { o: Offer }) {
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
            ["Last day to use it", o.expiresAt ? qldDay(o.expiresAt) : "No end date"],
            ["Who can use it", whoCanUse(o)],
            ["Share link", <span key="l" className="break-all font-mono text-xs">{link}</span>],
            ["Created", qldDay(o.created)],
          ]}
        />
      </div>
      {o.active && (
        <div className="mt-3 grid gap-2">
          {o.usable &&
            (o.automatic ? (
              <PowerForm power="autoOfferOff" hidden={{ promotionCodeId: o.id }} title="Stop applying it automatically" submit="Stop applying automatically" testId={`auto-off-${o.code}`}>
                <p className="text-sm text-muted">The code and its share link keep working; new subscriptions just don&rsquo;t get it without them.</p>
              </PowerForm>
            ) : (
              <PowerForm power="autoOfferOn" hidden={{ promotionCodeId: o.id }} title="Apply it to every new subscription" submit="Apply automatically" testId={`auto-on-${o.code}`}>
                <p className="text-sm text-muted">
                  Every new subscription gets it at checkout without a code, and the pricing page says so. Only one offer can be applied automatically.
                </p>
              </PowerForm>
            ))}
          <PowerForm power="endOffer" hidden={{ promotionCodeId: o.id }} title="End this offer" submit="End offer" danger testId={`end-${o.code}`}>
            <p className="text-sm text-muted">
              Nobody new can use the code or its link from now on. Anyone who already has the discount keeps it for the time it was offered.
            </p>
          </PowerForm>
        </div>
      )}
    </div>
  );
}

/** Support admins: discount codes and offers, made and ended here (lib/support/offers.ts). */
export default async function Offers({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  await consoleAdmin("/support/offers");
  const { done } = await searchParams;
  let offers: Offer[] = [];
  let error: string | null = null;
  try {
    offers = await listOffers();
  } catch (err) {
    error = String((err as Error)?.message ?? err).slice(0, 200);
  }
  const live = offers.filter((o) => o.active);
  const ended = offers.filter((o) => !o.active);
  const founding = foundingOpen() ? foundingLastDay() : null;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <ConsoleNav />
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Offers</h1>
      <p className="mt-2 text-sm text-muted">
        Discount codes for SureFrame plans, kept in Stripe. People use a code at checkout, through its share link (which applies it for them), or on Settings
        &gt; Billing if they already subscribe. One offer can also be applied automatically to every new subscription. One discount per subscription.
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

      <Section title="New offer">
        <PowerForm power="createOffer" hidden={{}} title="Create a discount code" submit="Create offer" testId="create-offer">
          <label className="grid gap-1 text-sm text-muted">
            Code (letters, numbers and dashes; customers can type it in any case)
            <input name="code" required maxLength={40} pattern="[A-Za-z0-9-]{3,40}" autoCapitalize="characters" autoComplete="off" spellCheck={false} className={`${field} uppercase`} />
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
            How many times it can be used (empty for no limit)
            <input name="maxUses" type="number" min={1} step={1} inputMode="numeric" className={field} />
          </label>
          <label className="grid gap-1 text-sm text-muted">
            Last day it can be used, Queensland time (empty for no end date)
            <input name="lastDay" type="date" className={field} />
          </label>
          <Check
            name="newCustomersOnly"
            label="New customers only"
            hint="Only for businesses we've never billed before, paid or not (Stripe's rule), so not for anyone who subscribed or tried to before."
          />
          <Check name="automatic" label="Apply it to every new subscription without a code" hint="The pricing page says so. Only one offer can be applied automatically." />
          <p className="text-xs text-dim">
            Say exactly what the offer is wherever you share it, including any end date or limit on uses, and don&rsquo;t end an offer early that you promised
            would run to a date.
          </p>
        </PowerForm>
      </Section>

      <Section title={`Current offers (${live.length})`}>
        {live.length ? <div className="grid gap-3">{live.map((o) => <OfferCard key={o.id} o={o} />)}</div> : <p className="text-sm text-muted">No offers running.</p>}
      </Section>
      {ended.length > 0 && (
        <Section title={`Ended (${ended.length})`}>
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
