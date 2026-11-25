import { headers } from "next/headers";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/session";

/** RATE_LIMITS=off is for local test runs only; the live site always limits. */
export const limitsOff = process.env.RATE_LIMITS === "off" && process.env.VERCEL_ENV !== "production";
if (process.env.RATE_LIMITS === "off" && !limitsOff) console.error("[rate-limit] RATE_LIMITS=off is set in production and ignored");

/** For limits on editing things (clients, assignments) counted over an hour. */
export const MANY_CHANGES = "You've made a lot of changes in the last hour. Please try again in a little while.";

/** What a refused caller is told: "wait a moment" is only true of short windows, so the hour-long ones say so. */
const tooMany = (windowSec: number) =>
  windowSec < 3600
    ? "Too many requests. Please wait a moment and try again."
    : windowSec === 3600
      ? "You've done this a lot in the last hour. Please try again in a little while."
      : "You've done this a lot today. Please try again later.";

/**
 * Count one hit against `key` in a fixed window and refuse once it passes
 * `limit`. Counters live in Postgres so every server instance shares them.
 * `message` replaces the usual refusal where a route can say it better.
 */
export async function rateLimit(key: string, limit: number, windowSec: number, message?: string) {
  if (limitsOff) return;
  const windowMs = windowSec * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count"`;
  if ((rows[0]?.count ?? 0) > limit) throw new HttpError(429, message ?? tooMany(windowSec));
}

/** Whether `key` has already used up `limit` in the current window, without counting a hit. */
export async function isLimited(key: string, limit: number, windowSec: number) {
  if (limitsOff) return false;
  const windowMs = windowSec * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const row = await db.rateLimit.findFirst({ where: { key, windowStart }, select: { count: true } });
  return (row?.count ?? 0) >= limit;
}

/** The caller's IP as seen by Vercel's edge (falls back to "local" in development). */
export async function clientIp() {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

/** Rate-limit by caller IP. */
export async function limitByIp(name: string, limit: number, windowSec: number, message?: string) {
  await rateLimit(`${name}:ip:${await clientIp()}`, limit, windowSec, message);
}

/** Drop finished windows; called from the daily purge job. */
export async function pruneRateLimits(now = new Date()) {
  await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 86_400_000) } } });
}
