import { AI_ASSIST_PRICES, AI_SUMMARIES_PER_MONTH, CLOUD_BACKUP_PRICE, PLANS, type PlanLimits } from "@/lib/plans";
import type { Plan } from "@prisma/client";

const ORDER: Plan[] = ["FREE", "SOLO", "STUDIO", "AGENCY"];

const length = (min: number) => (min < 60 ? `${min} min` : `${min / 60} ${min === 60 ? "hour" : "hours"}`);
const quality = (p: PlanLimits) => (p.maxResolution === 2160 ? "4K" : `${p.maxResolution}p`);

/**
 * What's in which plan, side by side (V26): every value comes from lib/plans.ts, so it can't drift from the cards.
 * Short values and a fixed layout so all four plans fit a 320px phone without scrolling sideways.
 */
export default function PlanGrid() {
  const rows: [string, (id: Plan, p: PlanLimits) => string][] = [
    ["Price (US$ a month)", (_, p) => String(p.priceMonthly)],
    ["Clients included", (_, p) => String(p.clientSeats)],
    ["Staff logins", (_, p) => String(p.staffSeats)],
    ["Videos", (_, p) => (p.maxVideos === null ? "No limit" : `${p.maxVideos} in total`)],
    ["Longest video", (_, p) => length(p.maxDurationMin)],
    ["Recording up to", (_, p) => quality(p)],
    ["Your logo and colours", (id) => (id === "FREE" ? "No" : "Yes")],
    ["SureFrame intro for clients", (_, p) => (p.showsPromo ? "Yes" : "No")],
    ["Assign clients to staff", (_, p) => (p.features.includes("Assign clients to staff") ? "Yes" : "No")],
    ["Cloud backup (US$ a month)", (id) => (id === "FREE" ? "No" : String(CLOUD_BACKUP_PRICE))],
    ["AI add-on (US$ a month)", (id) => (id === "FREE" ? "No" : String(AI_ASSIST_PRICES[id].month))],
    ["AI summaries a month", (id) => (id === "FREE" ? "No" : String(AI_SUMMARIES_PER_MONTH[id]))],
  ];
  return (
    <section className="mx-auto mt-12 max-w-3xl rounded-2xl border border-line bg-surface p-2 sm:p-6" aria-labelledby="compare-plans" data-testid="plan-grid">
      <h2 id="compare-plans" className="px-1 text-lg font-semibold text-ink">Compare plans</h2>
      <p className="mt-1 px-1 text-xs text-dim">Monthly prices (choose Yearly above the plans to see yearly ones). Add-ons are optional and billed with your plan.</p>
      <table className="mt-3 w-full table-fixed border-collapse text-xs sm:text-sm">
        <colgroup>
          <col className="w-[26%] sm:w-[34%]" />
          {ORDER.map((id) => <col key={id} />)}
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-1 py-2 text-left font-medium text-dim">
              <span className="sr-only">Feature</span>
            </th>
            {ORDER.map((id) => (
              <th key={id} scope="col" className="px-0 py-2 text-center font-semibold text-ink sm:px-1">
                {PLANS[id].name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-line last:border-0">
              <th scope="row" className="px-1 py-2 text-left font-normal text-muted [overflow-wrap:anywhere]">{label}</th>
              {ORDER.map((id) => {
                const v = value(id, PLANS[id]);
                return (
                  <td key={id} className={`px-0 py-2 text-center sm:px-1 ${v === "No" ? "text-dim" : "text-ink"}`}>
                    {v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
