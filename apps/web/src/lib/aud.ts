/**
 * A rough Australian-dollar figure beside our US-dollar prices, for Australian buyers (decision 9, V23). It's only an
 * estimate: we charge in US dollars and never fetch exchange rates, and the customer's bank (or Stripe, if they choose
 * to pay in their own currency at checkout) uses its own rate on the day. Prices themselves never change with it.
 * Safe to import in the browser.
 *
 * About A$1.53 to US$1, the approximate rate on 22 October 2026. Check it now and then and update it by hand
 * (with the date here and in AUD_RATE_DATE) if it drifts far.
 */
export const AUD_PER_USD = 1.53;
export const AUD_RATE_DATE = "October 2026";

/** "A$23" for US$15: rounded to whole dollars, since it's only an estimate. */
export const audFor = (usd: number) => `A$${Math.round(usd * AUD_PER_USD).toLocaleString("en-AU")}`;

/** The note that goes with the estimates, wherever they're shown. */
export const AUD_NOTE = `A$ amounts are estimates at about A$${AUD_PER_USD.toFixed(2)} to US$1 (${AUD_RATE_DATE}), before any GST added at checkout where it applies. You're charged in US dollars, and your bank's rate on the day applies.`;
