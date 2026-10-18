"use client";

import { useState } from "react";
import { qldDay } from "@/lib/support/when";

const field = "w-full rounded-xl border border-line-strong px-3 py-2 text-sm";

/**
 * How long a discount lasts: nothing is chosen until it's picked, the months box only shows for "a number of
 * months", and the chosen last day is written out the way the rest of the site writes dates.
 */
export default function OfferTerms({ maxMonths }: { maxMonths: number }) {
  const [duration, setDuration] = useState("");
  const [lastDay, setLastDay] = useState("");
  return (
    <>
      <label className="grid gap-1 text-sm text-muted">
        How long it lasts
        <select name="duration" value={duration} onChange={(e) => setDuration(e.target.value)} className={field} data-testid="offer-duration">
          <option value="" disabled>
            Choose…
          </option>
          <option value="once">The first bill only (new subscriptions only)</option>
          <option value="repeating">A number of months</option>
          <option value="forever">For as long as they stay subscribed</option>
        </select>
      </label>
      {duration === "repeating" && (
        <label className="grid gap-1 text-sm text-muted">
          How many months
          <input name="months" type="number" min={1} max={maxMonths} step={1} inputMode="numeric" className={field} />
          <span className="text-xs text-dim">
            Up to {maxMonths}. It comes off every bill that starts within those months. On yearly billing that&rsquo;s the whole first yearly bill, so 3 months at
            20% saves 20% of a year, and at 12 months it may come off the second yearly bill too.
          </span>
        </label>
      )}
      <label className="grid gap-1 text-sm text-muted">
        Last day it can be used, Queensland time (empty for no end date)
        <input name="lastDay" type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} className={field} />
        {/^\d{4}-\d{2}-\d{2}$/.test(lastDay) && <span className="text-xs text-dim" data-testid="offer-last-day">Usable until the end of {qldDay(`${lastDay}T12:00:00+10:00`)}</span>}
      </label>
    </>
  );
}
