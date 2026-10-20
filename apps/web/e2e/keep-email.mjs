// "Keep me signed in on this device" with the emailed sign-in link (the way people really sign in): once ticked, the
// sign-in survives closing the tab or the browser, a crash and a restart. Run against a server with AUTH_EMAIL_LINKS=true.
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { agreed, passAgree } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const outbox = ".data/outbox";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const linkFor = (email) =>
  readdirSync(outbox)
    .map((f) => JSON.parse(readFileSync(`${outbox}/${f}`, "utf8")))
    .filter((m) => m.to === email)
    .at(-1)
    .text.match(/https?:\/\/\S+/)[0];
// A browser that's been closed (or crashed, or the device switched off) keeps only cookies with an expiry date.
const reopen = async (ctx) => {
  const next = await browser.newContext();
  await next.addCookies((await ctx.cookies()).filter((c) => c.expires !== -1));
  return next;
};
const signedIn = async (ctx) => {
  const p = await ctx.newPage();
  await p.goto(BASE + "/library");
  await p.waitForURL("**/login**", { timeout: 5000 }).catch(() => {});
  const where = new URL(p.url()).pathname;
  await p.close();
  // Anywhere but the sign-in page (a new account may be asked for its business name first).
  return !where.startsWith("/login") && where;
};

async function signInByEmail(ctx, email, { tick, openLinkIn = ctx }) {
  await agreed(email);
  const page = await ctx.newPage();
  await page.goto(BASE + "/login?next=/library");
  if (tick) await page.check("[data-testid=keep-signed-in]");
  await page.fill('input[name="email"]', email);
  await page.click("text=Email me a sign-in link");
  await page.waitForURL("**/login/check**");
  const p2 = await openLinkIn.newPage();
  await p2.goto(linkFor(email));
  await p2.click("[data-testid=confirm-sign-in]");
  await p2.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  if (new URL(p2.url()).pathname === "/agree") await passAgree(p2);
  await p2.waitForURL("**/library", { timeout: 30000 });
  return p2;
}

// Ticked, link opened in the same browser.
const email = `keep${Date.now()}@example.com`;
const a = await browser.newContext();
const landed = await signInByEmail(a, email, { tick: true });
ok("the page it returns to doesn't show the mark in its address", !new URL(landed.url()).search.includes("sf_keep"), landed.url());
// Every tab closed, browser still open.
for (const p of a.pages()) await p.close();
ok("ticked: still signed in after closing every tab", (await signedIn(a)) === "/library");
const cookies = await a.cookies();
ok("ticked: remembered on this device", cookies.some((c) => c.name === "sf_keep" && c.expires > 0), JSON.stringify(cookies.map((c) => [c.name, c.expires])));
ok("ticked: the sign-in outlives the browser", (cookies.find((c) => c.name === "sf_active")?.expires ?? -1) > 0);
let b = await reopen(a);
let at = await signedIn(b);
ok("ticked: still signed in after closing the browser", at === "/library", String(at));
b = await reopen(b);
at = await signedIn(b);
ok("ticked: and after closing it again", at === "/library", String(at));

// Ticked, but the emailed link opens in a different browser (another app's, or the phone's default).
const email2 = `keep2${Date.now()}@example.com`;
const c = await browser.newContext();
const d = await browser.newContext();
await signInByEmail(c, email2, { tick: true, openLinkIn: d });
at = await signedIn(await reopen(d));
ok("ticked, link opened in another browser: that browser keeps it", at === "/library", String(at));
const email4 = `keep4${Date.now()}@example.com`;
const f = await browser.newContext();
const g = await browser.newContext();
await signInByEmail(f, email4, { tick: false, openLinkIn: g });
ok("not ticked, link opened in another browser: closing it signs out", !(await signedIn(await reopen(g))));

// Not ticked: closing the browser signs out, as before.
const email3 = `keep3${Date.now()}@example.com`;
const e = await browser.newContext();
await signInByEmail(e, email3, { tick: false });
ok("not ticked: closing the browser signs out", !(await signedIn(await reopen(e))));

await browser.close();
await prisma.$disconnect();
