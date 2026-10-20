/**
 * The browser-session cookie holding the time of the last request; see
 * src/middleware.ts. No expiry date, so the browser drops it on quit.
 */
export const ACTIVITY_COOKIE = "sf_active";

/**
 * "Keep me signed in on this device" (the sign-in page). Ticking it sets
 * KEEP_NEXT in the browser; the sign-in that follows turns it into KEEP, which
 * lasts KEEP_DAYS from then. While KEEP is there, closing the browser or
 * leaving it unused doesn't sign out.
 */
export const KEEP_COOKIE = "sf_keep";
export const KEEP_NEXT_COOKIE = "sf_keep_next";
/**
 * The same choice carried in an emailed sign-in link (on the page it returns to), because the link often opens in
 * another browser than the one it was asked for in (a mail app's own, or the device's default), which has no
 * KEEP_NEXT. src/middleware.ts passes it to the sign-in as KEEP_HEADER and takes it off the address afterwards.
 */
export const KEEP_PARAM = "sf_keep";
export const KEEP_HEADER = "x-sf-keep";

/** `next` with the "keep me signed in" mark added (lib/activity.ts KEEP_PARAM). */
export function withKeep(next: string) {
  const u = new URL(next, "http://x");
  u.searchParams.set(KEEP_PARAM, "1");
  return u.pathname + u.search + u.hash;
}
export const KEEP_DAYS = 30;

/** With `keep`, the activity cookie outlives the browser for as long as KEEP does. */
export const activityCookie = (secure = process.env.NODE_ENV === "production", keep = false) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure,
  path: "/",
  ...(keep ? { maxAge: KEEP_DAYS * 86_400 } : {}),
});

/** The KEEP cookie, set when a sign-in completes with KEEP_NEXT ticked. */
export const keepCookie = (secure = process.env.NODE_ENV === "production") => ({ httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: KEEP_DAYS * 86_400 });
