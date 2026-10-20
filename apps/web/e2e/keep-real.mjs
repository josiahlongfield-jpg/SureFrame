// "Keep me signed in on this device" in a real browser profile: the browser is really shut down (or killed, as in a
// crash or power cut) and started again on the same profile, rather than cookies being copied (e2e/keep-email.mjs).
// Run against a server with AUTH_EMAIL_LINKS=true.
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
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
await prisma.rateLimit.deleteMany();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const linkFor = (email) =>
  readdirSync(outbox)
    .map((f) => JSON.parse(readFileSync(`${outbox}/${f}`, "utf8")))
    .filter((m) => m.to === email)
    .at(-1)
    .text.match(/https?:\/\/\S+/)[0];
const open = (dir) => chromium.launchPersistentContext(dir, { executablePath: process.env.CHROMIUM });
/** Killed outright, as in a crash or the power going off: nothing gets the chance to save. */
const kill = (dir) => {
  try {
    execSync(`pkill -9 -f -- "--user-data-dir=${dir}"`);
  } catch {
    // Already gone.
  }
};
const where = async (ctx) => {
  const p = await ctx.newPage();
  await p.goto(BASE + "/library");
  await p.waitForURL("**/login**", { timeout: 5000 }).catch(() => {});
  const path = new URL(p.url()).pathname;
  await p.close();
  return path;
};

async function signIn(ctx, email, tick) {
  await agreed(email);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(BASE + "/login?next=/library");
  if (tick) await page.check("[data-testid=keep-signed-in]");
  await page.fill('input[name="email"]', email);
  await page.click("text=Email me a sign-in link");
  await page.waitForURL("**/login/check**");
  await page.goto(linkFor(email));
  await page.click("[data-testid=confirm-sign-in]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  if (new URL(page.url()).pathname === "/agree") await passAgree(page);
  await page.waitForURL("**/library", { timeout: 30000 });
}

for (const [how, end] of [
  ["closing the browser", async (ctx) => ctx.close()],
  ["a crash or power cut", async (ctx, dir) => kill(dir)],
]) {
  const dir = mkdtempSync(join(tmpdir(), "keep-real-"));
  const email = `real${Date.now()}@example.com`;
  let ctx = await open(dir);
  await signIn(ctx, email, true);
  // Some use first, so a crash isn't straight after signing in.
  for (const path of ["/clients", "/library"]) await (ctx.pages()[0] ?? (await ctx.newPage())).goto(BASE + path);
  await wait(35000);
  await end(ctx, dir);
  await wait(1000);
  ctx = await open(dir);
  let at = await where(ctx);
  ok(`ticked: still signed in after ${how}`, at === "/library", at);
  // And a second time, after using it again.
  await end(ctx, dir);
  await wait(1000);
  ctx = await open(dir);
  at = await where(ctx);
  ok(`ticked: and after ${how} again`, at === "/library", at);
  await ctx.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}

// Not ticked: closing the browser still signs out.
{
  const dir = mkdtempSync(join(tmpdir(), "keep-real-"));
  const email = `real-no${Date.now()}@example.com`;
  let ctx = await open(dir);
  await signIn(ctx, email, false);
  await ctx.close();
  ctx = await open(dir);
  const at = await where(ctx);
  ok("not ticked: closing the browser signs out", at.startsWith("/login"), at);
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
}

// Signed in without it, then turned on in Settings > Account > This device: from then it holds like a ticked sign-in.
{
  const dir = mkdtempSync(join(tmpdir(), "keep-real-"));
  const email = `real-later${Date.now()}@example.com`;
  let ctx = await open(dir);
  await signIn(ctx, email, false);
  const page = ctx.pages()[0];
  await page.goto(BASE + "/settings/account");
  ok("account page says this device isn't kept", !!(await page.waitForSelector("[data-testid=keep-device-off]", { timeout: 15000 }).catch(() => null)));
  await page.click("[data-testid=keep-device-toggle]");
  await page.waitForSelector("[data-testid=keep-device-on]");
  ok("turned on from the account page", true);
  ok("the button fits a 320px screen", await (async () => {
    await page.setViewportSize({ width: 320, height: 640 });
    return page.evaluate(() => document.documentElement.scrollWidth <= 320);
  })());
  // Closed, not crashed: after a crash Chromium brings back even the cookies meant to end with the browser, which
  // would hide whether turning it off works. Crashes are covered above.
  await ctx.close();
  ctx = await open(dir);
  let at = await where(ctx);
  ok("turned on later: still signed in after closing the browser", at === "/library", at);
  // Turned off again: closing the browser signs out once more.
  const p2 = await ctx.newPage();
  await p2.goto(BASE + "/settings/account");
  await p2.waitForSelector("[data-testid=keep-device-on]");
  await p2.click("[data-testid=keep-device-toggle]");
  await p2.waitForSelector("[data-testid=keep-device-off]");
  const left = (await ctx.cookies()).filter((c) => c.name.startsWith("sf_"));
  ok("turned off: nothing outlives the browser", !left.some((c) => ["sf_keep", "sf_active"].includes(c.name) && c.expires > 0), JSON.stringify(left.map((c) => [c.name, c.expires])));
  await ctx.close();
  ctx = await open(dir);
  at = await where(ctx);
  ok("turned off: closing the browser signs out", at.startsWith("/login"), at);
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
}

await prisma.$disconnect();
