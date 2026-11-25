import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { ACTIVITY_COOKIE as MARKER, activityCookie, KEEP_COOKIE, KEEP_DAYS, KEEP_HEADER, KEEP_PARAM } from "@/lib/activity";
import { activityAt, activityMark, keeps, sessionSecret } from "@/lib/activityMark";
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
 *
 * Both cookies are signed for the account they were issued to
 * (lib/activityMark.ts), so they can't be typed in by hand to bring an ended
 * sign-in back: one that is missing, altered or another account's counts as
 * expired.
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

// Every cookie Auth.js could read as (part of) a session. It takes any name that starts with one of these two, so
// this is deliberately loose: nothing that might be a session may be left behind when a sign-in is ended below.
const sessionCookies = (req: NextRequest) => req.cookies.getAll().filter((c) => c.name.includes(SESSION_COOKIES[0]));

/**
 * Whose session the request carries. Read with Auth.js's own reader (the same cookie parsing, and the same joining
 * of a long session's pieces), so this check and the app can never disagree about which session is there.
 * `undefined` when there is none; `null` when one can't be opened (altered, out of date), or the two cookie names
 * hold different accounts, since which of them the app reads depends on how the site is reached.
 */
async function sessionAccount(req: NextRequest) {
  // Only the cookies: given the whole request, getToken would also accept a token from an Authorization header.
  const from = { headers: { cookie: req.headers.get("cookie") ?? "" } };
  let account: string | undefined;
  for (const cookieName of SESSION_COOKIES) {
    if (!(await getToken({ req: from, cookieName, raw: true }))) continue;
    const sub = (await getToken({ req: from, cookieName, secret: sessionSecret() }))?.sub;
    if (!sub || (account !== undefined && account !== sub)) return null;
    account = sub;
  }
  return account;
}

const isCallback = (req: NextRequest) => req.nextUrl.pathname.startsWith("/api/auth/callback/");

/** An emailed sign-in link asked to keep this device signed in: the mark rides on the page it returns to. */
function linkKeeps(req: NextRequest) {
  try {
    return new URL(req.nextUrl.searchParams.get("callbackUrl") ?? "", req.nextUrl.origin).searchParams.get(KEEP_PARAM) === "1";
  } catch {
    return false;
  }
}

/** The sign-in request as passed on, telling events.signIn (src/auth.ts) when the link asked to keep the device. */
function signInHeaders(req: NextRequest, base: Headers = new Headers(req.headers)) {
  if (linkKeeps(req)) base.set(KEEP_HEADER, "1");
  else base.delete(KEEP_HEADER);
  return base;
}

/** Counts this request as activity. `keep`: this device is kept signed in (the KEEP cookie is in place). */
async function mark(res: NextResponse, req: NextRequest, account: string, keep: boolean) {
  const secure = req.nextUrl.protocol === "https:";
  // No maxAge/expires unless kept: a browser-session cookie.
  res.cookies.set(MARKER, await activityMark(account), activityCookie(secure, keep));
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
  return (await maintenance(req)) ?? withoutKeepMark(req) ?? guessedAddress(req) ?? sessionActivity(req);
}

/**
 * Addresses people guess (V60, V75): /settings/staff is the Team page (the menu says "Invite staff"), and a visitor who
 * tries /support wants help, not the support team's sign-in (/help says where the console's sign-in is). Signed-in
 * people who don't answer support are sent to /help by app/support/layout.tsx.
 */
function guessedAddress(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname !== "/settings/staff" && !(pathname === "/support" && !sessionCookies(req).length)) return null;
  const url = req.nextUrl.clone();
  url.pathname = pathname === "/support" ? "/help" : "/settings/team";
  if (pathname === "/support") url.search = "?from=support";
  return NextResponse.redirect(url);
}

/** Back from a sign-in link that carried "keep me signed in": the same page, without the mark in its address. */
function withoutKeepMark(req: NextRequest) {
  if (!req.nextUrl.searchParams.has(KEEP_PARAM) || req.nextUrl.pathname.startsWith("/api/") || req.method !== "GET") return null;
  const url = req.nextUrl.clone();
  url.searchParams.delete(KEEP_PARAM);
  return NextResponse.redirect(url);
}

async function sessionActivity(req: NextRequest) {
  const account = await sessionAccount(req);
  // Completing a sign-in from signed out (email link, Google, dev login) starts the browser session. The sign-in
  // sets the activity cookie itself, once it knows whose it is (events.signIn in src/auth.ts), as it does KEEP.
  if (account === undefined) return isCallback(req) ? NextResponse.next({ request: { headers: signInHeaders(req) } }) : NextResponse.next();

  const keep = !!account && (await keeps(req.cookies.get(KEEP_COOKIE)?.value, account));
  const last = account ? await activityAt(req.cookies.get(MARKER)?.value, account) : null;
  const fresh = last !== null && Date.now() - last < (keep ? KEEP_DAYS * 86_400_000 : IDLE_MS);
  if (account && fresh) {
    // A sign-in completed over this one may be someone else's: again, it sets its own activity cookie.
    if (isCallback(req)) return NextResponse.next({ request: { headers: signInHeaders(req) } });
    return req.headers.get(BACKGROUND_HEADER) || req.headers.has(ACTION_HEADER) ? NextResponse.next() : mark(NextResponse.next(), req, account, keep);
  }

  const names = new Set(sessionCookies(req).map((c) => c.name));
  // Completing a new sign-in over an expired one: it goes ahead without the old session and sets
  // its own cookies and activity time (src/auth.ts). If the link was bad, the old cookies are
  // cleared on the next request.
  if (isCallback(req)) return NextResponse.next({ request: { headers: signInHeaders(req, withoutSession(req, names)) } });

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
