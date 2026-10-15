/**
 * Maintenance mode: while MAINTENANCE=on, everyone sees only the maintenance
 * page, apart from the owner's browsers. The owner opens
 * sureframe.app/?owner=<MAINTENANCE_KEY> once in each browser; that sets a
 * year-long cookie, and that browser then uses the site as normal.
 *
 * The Stripe webhook and the cron jobs still run (the cron jobs pause their
 * emails and deletions, see maintenancePaused). Runs in the middleware, so
 * only Web APIs here.
 */
export const OWNER_COOKIE = "sf_owner";
export const OWNER_PARAM = "owner";

export const maintenanceOn = () => process.env.MAINTENANCE === "on";

/** The owner cookie's value: derived from the key, so changing MAINTENANCE_KEY signs every browser out of it. */
export async function ownerPass(key: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("sureframe-owner-pass")));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Same length and contents, without stopping at the first difference. */
export function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Cron jobs skip what people would notice while nobody can get in: emails (reminders, warnings, notices) and
 * deleting their videos, removed clients or closed accounts. Housekeeping carries on.
 */
export const maintenancePaused = maintenanceOn;

/** Runs a cron job, unless maintenance has it paused. */
export const unlessPaused = <T,>(run: () => Promise<T>): Promise<T | "paused"> => (maintenancePaused() ? Promise.resolve("paused") : run());
