import { NextResponse, type NextRequest } from "next/server";
import { ACTIVITY_COOKIE as MARKER, activityCookie, KEEP_COOKIE, KEEP_DAYS, KEEP_NEXT_COOKIE } from "@/lib/activity";
import { OWNER_COOKIE, OWNER_PARAM, maintenanceOn, ownerPass, sameText } from "@/lib/maintenance";

/**
 * Sign-ins last only as long as the browser is open, and end after a long
 * stretch of inactivity.
 *
 * The Auth.js session cookie lives for 30 days, so on its own a closed and
 * reopened browser lands straight back in the account. Alongside it we keep a
 * browser-session cookie (no expiry date, so the browser drops it on quit)
 * holding the time of the last request. It is set when a sign-in completes
 * (events.signIn in src/auth.ts) and refreshed on every request while it is
 * fresh. Any request, page or API, that finds a session without it, or with
 * an activity time older than IDLE_MS, is treated as signed out and the
 * session cookies are deleted. Encryption keys stay on the device, so signing
 * back in doesn't ask for the recovery key.
 *
 * "Keep me signed in on this device" (lib/activity.ts) is the exception: for
 * KEEP_DAYS after that sign-in, the activity cookie outlives the browser and
 * there is no idle limit.
 */
/** Read by the sign-in page to explain why someone was signed out. */
const EXPIRED = "sf_signed_out";
const IDLE_MS = 8 * 3_600_000;
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];
/** Sent by background checks (new replies, support answers), which aren't someone using the site. */
const BACKGROUND_HEADER = "x-sf-background";
/**
 * Sent with every server action. Any cookie set on an action's response makes Next draw the whole page
 * again into the answer, even when the action only says what was wrong, and a form waiting on that redraw
 * can be left on "Working…" (app/support/_console/Fresh.tsx). Loading the page was the activity.
 */
const ACTION_HEADER = "next-action";

const sessionCookies = (req: NextRequest) =>
  req.cookies.getAll().filter((c) => SESSION_COOKIES.some((n) => c.name === n || c.name.startsWith(`${n}.`)));

const isCallback = (req: NextRequest) => req.nextUrl.pathname.startsWith("/api/auth/callback/");

/** Kept signed in on this device: ticked for the sign-in being completed now, or for the one in place. */
const keeping = (req: NextRequest) => (isCallback(req) ? req.cookies.get(KEEP_NEXT_COOKIE)?.value === "1" : req.cookies.get(KEEP_COOKIE)?.value === "1");

function mark(res: NextResponse, req: NextRequest) {
  const secure = req.nextUrl.protocol === "https:";
  const keep = keeping(req);
  // No maxAge/expires unless kept: a browser-session cookie.
  res.cookies.set(MARKER, String(Date.now()), activityCookie(secure, keep));
  // The sign-in itself sets or clears KEEP, once it has worked (events.signIn in src/auth.ts).
  return res;
}

/** The request as it would arrive with no sign-in: the old session cookies are left off. */
function withoutSession(req: NextRequest, names: Set<string>) {
  const headers = new Headers(req.headers);
  const kept = req.cookies.getAll().filter((c) => !names.has(c.name) && c.name !== MARKER);
  if (kept.length) headers.set("cookie", kept.map((c) => `${c.name}=${c.value}`).join("; "));
  else headers.delete("cookie");
  return headers;
}

const MAINTENANCE_HEADERS = { "Retry-After": "3600", "Cache-Control": "no-store" };

/**
 * While maintenance mode is on, anyone without the owner cookie gets the maintenance page (a 503, so
 * search engines treat it as temporary) and API calls get a 503. The Stripe webhook still gets through.
 * Returns null when the request should carry on as normal.
 */
async function maintenance(req: NextRequest) {
  if (!maintenanceOn()) return null;
  const { pathname, searchParams } = req.nextUrl;
  if (pathname.startsWith("/api/webhooks/")) return null;
  const key = process.env.MAINTENANCE_KEY ?? "";
  if (key.length >= 16) {
    const pass = await ownerPass(key);
    // The owner link: remember this browser, then show the same page without the key in the address.
    const given = searchParams.get(OWNER_PARAM);
    if (given !== null && sameText(given, key)) {
      const url = req.nextUrl.clone();
      url.searchParams.delete(OWNER_PARAM);
      const res = NextResponse.redirect(url);
      res.cookies.set(OWNER_COOKIE, pass, { path: "/", maxAge: 365 * 86_400, httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax" });
      res.headers.set("Cache-Control", "no-store");
      return res;
    }
    if (sameText(req.cookies.get(OWNER_COOKIE)?.value ?? "", pass)) return null;
  }
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "SureFrame is under maintenance. Please try again later." }, { status: 503, headers: MAINTENANCE_HEADERS });
  const url = req.nextUrl.clone();
  url.pathname = "/maintenance";
  url.search = "";
  return NextResponse.rewrite(url, { status: 503, headers: MAINTENANCE_HEADERS });
}

export async function middleware(req: NextRequest) {
  return (await maintenance(req)) ?? sessionActivity(req);
}

function sessionActivity(req: NextRequest) {
  const session = sessionCookies(req);
  // Completing a sign-in from signed out (email link, Google, dev login) starts the browser session.
  if (!session.length) return isCallback(req) ? mark(NextResponse.next(), req) : NextResponse.next();

  const last = Number(req.cookies.get(MARKER)?.value);
  const idle = req.cookies.get(KEEP_COOKIE)?.value === "1" ? KEEP_DAYS * 86_400_000 : IDLE_MS;
  const fresh = Number.isFinite(last) && last > 0 && Date.now() - last < idle;
  if (fresh) return req.headers.get(BACKGROUND_HEADER) || req.headers.has(ACTION_HEADER) ? NextResponse.next() : mark(NextResponse.next(), req);

  const names = new Set(session.map((c) => c.name));
  // Completing a new sign-in over an expired one: it goes ahead without the old session and sets
  // its own cookies and activity time (src/auth.ts). If the link was bad, the old cookies are
  // cleared on the next request.
  if (isCallback(req)) return NextResponse.next({ request: { headers: withoutSession(req, names) } });

  // The browser was closed, or nothing happened for too long: sign out here.
  // This request carries on as signed out (pages that need an account send
  // people to sign in as usual, API calls get "Sign in required"), and the
  // response deletes the session cookies.
  const res = NextResponse.next({ request: { headers: withoutSession(req, names) } });
  // __Secure- cookies can only be replaced by a Secure cookie.
  for (const name of names) res.cookies.set(name, "", { path: "/", maxAge: 0, secure: name.startsWith("__Secure-") });
  res.cookies.set(MARKER, "", { path: "/", maxAge: 0 });
  res.cookies.set(KEEP_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(EXPIRED, "1", { path: "/", maxAge: 300, sameSite: "lax", httpOnly: true });
  return res;
}

export const config = {
  // Skip static files, the speech model and cron jobs.
  matcher: ["/((?!_next/|favicon|models/|api/cron/|.*\\.(?:png|jpg|jpeg|svg|ico|webp|txt|xml|webmanifest)$).*)"],
};
