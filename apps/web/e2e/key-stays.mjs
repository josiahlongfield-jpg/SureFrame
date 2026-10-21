// The device's encryption key outlives signing out: signing in again in the same browser (after Sign out, after the
// sign-in lapsing, after the browser is closed and opened again) never asks for the recovery key. Run on a computer
// and on phone and tablet screens, each in a real browser profile. Run against a server with AUTH_EMAIL_LINKS=true.
import { chromium, devices } from "@playwright/test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { agreed, passAgree } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const outbox = ".data/outbox";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const prisma = new PrismaClient();
const linkFor = (email) =>
  readdirSync(outbox)
    .map((f) => JSON.parse(readFileSync(`${outbox}/${f}`, "utf8")))
    .filter((m) => m.to === email)
    .at(-1)
    .text.match(/https?:\/\/\S+/)[0];

async function signIn(ctx, email) {
  await prisma.rateLimit.deleteMany();
  await agreed(email);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const before = readdirSync(outbox).length;
  await page.goto(BASE + "/login?next=/library");
  await page.fill('input[name="email"]', email);
  await page.click("text=Email me a sign-in link");
  await page.waitForURL("**/login/check**");
  for (let i = 0; i < 50 && readdirSync(outbox).length === before; i++) await page.waitForTimeout(100);
  await page.goto(linkFor(email));
  await page.click("[data-testid=confirm-sign-in]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  if (new URL(page.url()).pathname === "/agree") await passAgree(page);
  if (!new URL(page.url()).pathname.startsWith("/library")) await page.goto(BASE + "/library");
  return page;
}

/** Whether the library opened without asking for the recovery key, and the key this browser holds. */
async function unlocked(page) {
  await page.waitForLoadState("load");
  // The gate checks the stored key first; give it time to settle either way.
  await page.waitForFunction(() => !document.body.textContent.includes("Unlocking"), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const asks = await page.isVisible("text=Unlock your videos in this browser");
  const key = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("framecast.key.")).map((k) => k + "=" + localStorage.getItem(k)).sort().join("|"));
  return { asks, key };
}

const phone = (name) => {
  const d = { ...devices[name] };
  delete d.defaultBrowserType;
  return d;
};
const setups = [
  ["computer", { viewport: { width: 1280, height: 800 } }],
  ["iPhone", phone("iPhone 13")],
  ["Android phone", phone("Pixel 7")],
  ["iPad", phone("iPad (gen 7)")],
];

for (const [name, opts] of setups) {
  const dir = mkdtempSync(join(tmpdir(), "key-stays-"));
  const open = () => chromium.launchPersistentContext(dir, { executablePath: process.env.CHROMIUM, ...opts });
  const email = `keystays-${name.replace(/\W/g, "").toLowerCase()}-${Date.now()}@example.com`;
  let ctx = await open();
  let page = await signIn(ctx, email);
  const first = await unlocked(page);
  ok(`${name}: first sign-in makes this browser's key without asking`, !first.asks && !!first.key, JSON.stringify(first));

  // Signed out with the Sign out button (in the menu on small screens).
  if (await page.isVisible("button:has-text('Sign out')")) await page.click("button:has-text('Sign out')");
  else {
    await page.click("[data-testid=menu-button]");
    await page.click("[data-testid=app-menu] button:has-text('Sign out')");
  }
  await page.waitForURL((u) => !u.pathname.startsWith("/library"), { timeout: 15000 });
  page = await signIn(ctx, email);
  let now = await unlocked(page);
  ok(`${name}: after Sign out and signing in again, no recovery key asked`, !now.asks && now.key === first.key, JSON.stringify({ now, first: first.key }));

  // The sign-in lapses (8 hours unused, or its cookies cleared).
  await ctx.clearCookies();
  page = await signIn(ctx, email);
  now = await unlocked(page);
  ok(`${name}: after the sign-in lapses, no recovery key asked`, !now.asks && now.key === first.key, JSON.stringify(now));

  // The browser is closed and opened again.
  await ctx.close();
  ctx = await open();
  page = await signIn(ctx, email);
  now = await unlocked(page);
  ok(`${name}: after closing and reopening the browser, no recovery key asked`, !now.asks && now.key === first.key, JSON.stringify(now));
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
}

// A different browser (as when an email app opens the link in its own browser) has no key, so it asks: expected.
{
  const ctx = await chromium.launch({ executablePath: process.env.CHROMIUM }).then((b) => b.newContext());
  const email = `keystays-other-${Date.now()}@example.com`;
  const dir = mkdtempSync(join(tmpdir(), "key-stays-"));
  const home = await chromium.launchPersistentContext(dir, { executablePath: process.env.CHROMIUM });
  await unlocked(await signIn(home, email));
  await home.close();
  const other = await unlocked(await signIn(ctx, email));
  ok("a different browser asks for the recovery key once (expected)", other.asks, JSON.stringify(other));
  await ctx.browser().close();
  rmSync(dir, { recursive: true, force: true });
}

await prisma.$disconnect();
