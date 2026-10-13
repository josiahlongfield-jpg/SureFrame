import type { Metadata } from "next";
import { foundingLastDay, foundingOpen } from "@/lib/founding";
import type { Offer } from "@/lib/offers";
import { appUrl } from "@/lib/stripe";
import { listOffers } from "@/lib/support/offers";
import PowerForm, { Check } from "../_console/PowerForm";
import { Badge, ConsoleNav, consoleAdmin, Done, Facts, Section } from "../_console/ui";

export const metadata: Metadata = { title: "Offers", robots: { index: false } };

const field = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const qldDay = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Brisbane" });

function status(o: Offer) {
  if (!o.active) return <Badge>Ended</Badge>;
  if (o.maxUses !== null && o.uses >= o.maxUses) return <Badge tone="amber">Used up</Badge>;
  if (o.expiresAt && o.expiresAt.getTime() <= Date.now()) return <Badge tone="amber">Expired</Badge>;
  return <Badge tone="green">Active</Badge>;
}

function OfferCard({ o }: { o: Offer }) {
  const link = appUrl(`/offer/${o.code}`);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4" data-testid={`offer-${o.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-base font-semibold text-slate-900">{o.code}</span>
        {status(o)}
        {o.automatic && o.active && <Badge tone="purple">Applied automatically</Badge>}
      </div>
      <p className="mt-1 text-sm text-slate-700">{o.summary}</p>
      <div className="mt-3">
        <Facts
          rows={[
            ["Used", `${o.uses}${o.maxUses !== null ? ` of ${o.maxUses}` : ""} time${o.uses === 1 && o.maxUses === null ? "" : "s"}`],
            ["Last day to use it", o.expiresAt ? qldDay(o.expiresAt) : "No end date"],
            ["Who can use it", o.newCustomersOnly ? "New subscriptions only" : "New subscriptions, and current subscribers on Settings > Billing"],
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
                <p className="text-sm text-slate-600">The code and its share link keep working; new subscriptions just don&rsquo;t get it without them.</p>
              </PowerForm>
            ) : (
              <PowerForm power="autoOfferOn" hidden={{ promotionCodeId: o.id }} title="Apply it to every new subscription" submit="Apply automatically" testId={`auto-on-${o.code}`}>
                <p className="text-sm text-slate-600">
                  Every new subscription gets it at checkout without a code, and the pricing page says so. Only one offer can be applied automatically.
                </p>
              </PowerForm>
            ))}
          <PowerForm power="endOffer" hidden={{ promotionCodeId: o.id }} title="End this offer" submit="End offer" danger testId={`end-${o.code}`}>
            <p className="text-sm text-slate-600">
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
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">Offers</h1>
      <p className="mt-2 text-sm text-slate-600">
        Discount codes for SureFrame plans, kept in Stripe. People use a code at checkout, through its share link (which applies it for them), or on Settings
        &gt; Billing if they already subscribe. One offer can also be applied automatically to every new subscription. One discount per subscription.
      </p>
      <p className="mt-2 text-sm text-slate-600" data-testid="founding-status">
        Founding prices: {founding ? `running, for subscriptions started by ${founding}.` : "not running. Ask Claude to start them with an end date."}
      </p>
      <Done id={done} />
      {error && (
        <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          Stripe couldn&rsquo;t be reached ({error}). Try again shortly.
        </p>
      )}

      <Section title="New offer">
        <PowerForm power="createOffer" hidden={{}} title="Create a discount code" submit="Create offer" testId="create-offer">
          <label className="grid gap-1 text-sm text-slate-700">
            Code (letters, numbers and dashes; customers can type it in any case)
            <input name="code" required maxLength={40} pattern="[A-Za-z0-9-]{3,40}" autoCapitalize="characters" autoComplete="off" spellCheck={false} className={`${field} uppercase`} />
          </label>
          <label className="grid gap-1 text-sm text-slate-700">
            Percentage off
            <input name="percentOff" type="number" required min={1} max={100} step={1} inputMode="numeric" className={field} />
          </label>
          <label className="grid gap-1 text-sm text-slate-700">
            Comes off
            <select name="scope" required defaultValue="plan" className={field}>
              <option value="plan">The plan only</option>
              <option value="seats">The plan, extra clients and extra staff</option>
              <option value="all">Everything, add-ons included</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-slate-700">
            How long it lasts
            <select name="duration" required defaultValue="repeating" className={field}>
              <option value="once">The first bill only</option>
              <option value="repeating">A number of months (enter below)</option>
              <option value="forever">For as long as they stay subscribed</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-slate-700">
            Months (for &ldquo;a number of months&rdquo;)
            <input name="months" type="number" min={1} max={36} step={1} inputMode="numeric" className={field} />
            <span className="text-xs text-slate-500">
              On yearly billing a discount for a number of months comes off the first yearly bill in full, so 3 months at 20% saves 20% of a whole year.
            </span>
          </label>
          <label className="grid gap-1 text-sm text-slate-700">
            How many times it can be used (empty for no limit)
            <input name="maxUses" type="number" min={1} step={1} inputMode="numeric" className={field} />
          </label>
          <label className="grid gap-1 text-sm text-slate-700">
            Last day it can be used, Queensland time (empty for no end date)
            <input name="lastDay" type="date" className={field} />
          </label>
          <Check name="newCustomersOnly" label="New customers only" hint="Only for businesses that have never paid before. Current subscribers can't use it on Settings > Billing." />
          <Check name="automatic" label="Apply it to every new subscription without a code" hint="The pricing page says so. Only one offer can be applied automatically." />
          <p className="text-xs text-slate-500">
            Say exactly what the offer is wherever you share it, including any end date or limit on uses, and don&rsquo;t end an offer early that you promised
            would run to a date.
          </p>
        </PowerForm>
      </Section>

      <Section title={`Current offers (${live.length})`}>
        {live.length ? <div className="grid gap-3">{live.map((o) => <OfferCard key={o.id} o={o} />)}</div> : <p className="text-sm text-slate-600">No offers running.</p>}
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
