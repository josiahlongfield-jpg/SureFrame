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
