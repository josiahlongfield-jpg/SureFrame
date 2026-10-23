// Sign-ins end when the browser is closed, or after a long stretch of no use,
// without cutting off API calls (uploads, replies) already under way.
import { chromium } from "@playwright/test";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(BASE + "/record");
const loginEmail = `timeout${Date.now()}@acme.com`;
await agreed(loginEmail);
await page.fill('input[name="email"]', loginEmail);
await page.click("text=Continue");
await page.waitForURL("**/record");
await page.click("text=I've saved it").catch(() => {});

await page.goto(BASE + "/library");
ok("signed in: library opens", new URL(page.url()).pathname === "/library");
const marker = (await ctx.cookies()).find((c) => c.name === "sf_active");
ok("activity cookie is a browser-session cookie", marker?.expires === -1, JSON.stringify(marker));

// A second tab in the same open browser stays signed in.
const tab = await ctx.newPage();
await tab.goto(BASE + "/library");
ok("new tab in the open browser stays signed in", new URL(tab.url()).pathname === "/library");
await tab.close();

// "Close the browser": a new browser keeps only cookies with an expiry date.
const kept = (await ctx.cookies()).filter((c) => c.expires !== -1);
ok("the 30-day session cookie is still there", kept.some((c) => c.name.includes("session-token")));
const reopened = await browser.newContext();
await reopened.addCookies(kept);
const p2 = await reopened.newPage();
await p2.goto(BASE + "/library");
// The page streams in, so the redirect to sign in can land just after load.
await p2.waitForURL("**/login**", { timeout: 15000 }).catch(() => {});
ok("after closing the browser: sent to sign in", new URL(p2.url()).pathname === "/login", p2.url());
ok("sign-in page explains why", !!(await p2.waitForSelector("[data-testid=signed-out-note]", { timeout: 10000 }).catch(() => null)));
ok("session cookie deleted", !(await reopened.cookies()).some((c) => c.name.includes("session-token")));
await p2.goto(BASE + "/library");
await p2.waitForURL("**/login**", { timeout: 15000 }).catch(() => {});
ok("stays signed out", new URL(p2.url()).pathname === "/login");
await reopened.close();

// Browser closed, then an API address typed in directly: signed out there too.
const closedApi = await browser.newContext();
await closedApi.addCookies((await ctx.cookies()).filter((c) => c.name !== "sf_active"));
const exp = await closedApi.request.get(BASE + "/api/account/export");
ok("after closing the browser: API calls are signed out", exp.status() === 401, String(exp.status()));
ok("and that clears the old session", !(await closedApi.cookies()).some((c) => c.name.includes("session-token")));
await closedApi.close();

// Idle for longer than the limit: an API call doesn't bring the session back,
// and the next page load is signed out.
const idle = await browser.newContext();
await idle.addCookies((await ctx.cookies()).map((c) => (c.name === "sf_active" ? { ...c, value: String(Date.now() - 9 * 3_600_000) } : c)));
const p3 = await idle.newPage();
const api = await (await idle.request.get(BASE + "/api/auth/session")).json();
ok("idle: API calls are signed out", !api?.user, JSON.stringify(api));
await p3.goto(BASE + "/library");
await p3.waitForURL("**/login**", { timeout: 15000 }).catch(() => {});
ok("idle over 8 hours: next page load signs out", new URL(p3.url()).pathname === "/login", p3.url());
await idle.close();

// Recent activity keeps you in.
const active = await browser.newContext();
const hourAgo = String(Date.now() - 3_600_000);
await active.addCookies((await ctx.cookies()).map((c) => (c.name === "sf_active" ? { ...c, value: hourAgo } : c)));
// A background check (new replies) works but doesn't count as using the site.
const bg = await (await active.request.get(BASE + "/api/auth/session", { headers: { "x-sf-background": "1" } })).json();
ok("background check while active: still signed in", !!bg?.user, JSON.stringify(bg));
ok("background check doesn't extend the session", (await active.cookies()).find((c) => c.name === "sf_active")?.value === hourAgo);
const fg = await (await active.request.get(BASE + "/api/auth/session")).json();
ok("a normal API call while active works", !!fg?.user);
ok("and counts as activity", (await active.cookies()).find((c) => c.name === "sf_active")?.value !== hourAgo);
const p4 = await active.newPage();
await p4.goto(BASE + "/library");
await p4.waitForTimeout(2000);
ok("used within the last 8 hours: still signed in", new URL(p4.url()).pathname === "/library", p4.url());

// Signing in again works normally and starts a fresh session.
const again = await browser.newContext();
const p5 = await again.newPage();
await p5.goto(BASE + "/login");
ok("plain visit to sign-in has no signed-out note", !(await p5.isVisible("[data-testid=signed-out-note]")));

// "Keep me signed in on this device": off by default (above); ticked, it lasts 30 days from that sign-in.
const DAY = 86_400_000;
const keptCtx = await browser.newContext();
const k1 = await keptCtx.newPage();
await k1.goto(BASE + "/login?next=%2Flibrary");
ok("Keep me signed in starts unticked", !(await k1.isChecked("[data-testid=keep-signed-in]")));
await k1.check("[data-testid=keep-signed-in]");
await k1.fill('input[name="email"]', loginEmail);
await k1.click("text=Continue");
await k1.waitForURL("**/library");
const keepCookie = (await keptCtx.cookies()).find((c) => c.name === "sf_keep");
ok("kept: remembered for 30 days from this sign-in", !!keepCookie && Math.abs(keepCookie.expires * 1000 - (Date.now() + 30 * DAY)) < 60_000, JSON.stringify(keepCookie));
ok("kept: the activity cookie outlives the browser", ((await keptCtx.cookies()).find((c) => c.name === "sf_active")?.expires ?? -1) > 0);
const keptReopen = await browser.newContext();
await keptReopen.addCookies((await keptCtx.cookies()).filter((c) => c.expires !== -1));
const k2 = await keptReopen.newPage();
await k2.goto(BASE + "/library");
await k2.waitForURL("**/login**", { timeout: 5000 }).catch(() => {});
ok("kept: still signed in after closing the browser", new URL(k2.url()).pathname === "/library", k2.url());
await keptReopen.close();
const keptIdle = await browser.newContext();
await keptIdle.addCookies((await keptCtx.cookies()).map((c) => (c.name === "sf_active" ? { ...c, value: String(Date.now() - 3 * DAY) } : c)));
const k3 = await keptIdle.newPage();
await k3.goto(BASE + "/library");
await k3.waitForURL("**/login**", { timeout: 5000 }).catch(() => {});
ok("kept: a few days unused is fine", new URL(k3.url()).pathname === "/library", k3.url());
await keptIdle.close();
const keptLong = await browser.newContext();
await keptLong.addCookies((await keptCtx.cookies()).map((c) => (c.name === "sf_active" ? { ...c, value: String(Date.now() - 31 * DAY) } : c)));
const k4 = await keptLong.newPage();
await k4.goto(BASE + "/library");
await k4.waitForURL("**/login**", { timeout: 15000 }).catch(() => {});
ok("kept: over 30 days unused signs out", new URL(k4.url()).pathname === "/login", k4.url());
ok("and forgets the choice", !(await keptLong.cookies()).some((c) => c.name === "sf_keep"));
await keptLong.close();
// The next sign-in on that browser without the tick goes back to the default.
const k5 = await keptCtx.newPage();
await keptCtx.clearCookies({ name: /session-token/ });
await k5.goto(BASE + "/login?next=%2Flibrary");
await k5.fill('input[name="email"]', loginEmail);
await k5.click("text=Continue");
await k5.waitForURL("**/library");
ok("signing in again unticked: not kept", !(await keptCtx.cookies()).some((c) => c.name === "sf_keep"));
ok("and the activity cookie is a browser-session cookie again", (await keptCtx.cookies()).find((c) => c.name === "sf_active")?.expires === -1);
await keptCtx.close();

// "Sign out everywhere" on Settings > Account > This device (Decision 8): asks first, then every sign-in ends, this one
// included, and the sign-in page says why. Signing in again works straight away.
const signIn = async (ctx, viewport) => {
  const p = await ctx.newPage();
  if (viewport) await p.setViewportSize(viewport);
  await p.goto(BASE + "/login?next=%2Flibrary");
  await p.fill('input[name="email"]', loginEmail);
  await p.click("text=Continue");
  await p.waitForURL("**/library");
  return p;
};
const here = await browser.newContext();
const elsewhere = await browser.newContext();
const ep = await signIn(here, { width: 320, height: 700 });
const other = await signIn(elsewhere);
await ep.goto(BASE + "/settings/account#device");
ok("sign out everywhere: under This device", (await ep.textContent("[data-testid=keep-device]")).includes("Sign out everywhere"));
await ep.click("[data-testid=sign-out-everywhere]");
const confirmText = await ep.textContent("[data-testid=sign-out-everywhere-confirm]").catch(() => "");
ok("sign out everywhere: asks first, saying this device is included", confirmText.includes("Sign out on every device?") && confirmText.includes("this one included"), confirmText);
ok("sign out everywhere: the question fits 320px", await ep.evaluate(() => document.documentElement.scrollWidth <= 320));
await ep.click("[data-testid=sign-out-everywhere-confirm] >> text=Cancel");
await other.goto(BASE + "/library");
ok("sign out everywhere: Cancel signs nobody out", new URL(other.url()).pathname === "/library" && (await ep.locator("[data-testid=sign-out-everywhere-confirm]").count()) === 0);
await ep.click("[data-testid=sign-out-everywhere]");
await ep.click("[data-testid=sign-out-everywhere-yes]");
await ep.waitForURL("**/login**", { timeout: 15000 }).catch(() => {});
const why = await ep.textContent("[data-testid=everywhere-note]").catch(() => "");
ok("sign out everywhere: this browser is signed out and told why", new URL(ep.url()).pathname === "/login" && why.includes("You signed out everywhere") && why.includes("this one included"), why || ep.url());
// The page streams in, so its redirect to the sign-in page can land a moment after it opens.
const lands = (p) => p.waitForURL((u) => u.pathname === "/login", { timeout: 30000 }).then(() => true, () => false);
await ep.goto(BASE + "/library");
ok("sign out everywhere: this browser stays signed out", await lands(ep), ep.url());
await other.goto(BASE + "/library");
ok("sign out everywhere: the other browser is signed out too", await lands(other), other.url());
const backIn = await signIn(here);
ok("sign out everywhere: signing in again works at once", new URL(backIn.url()).pathname === "/library");
await here.close();
await elsewhere.close();

await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
