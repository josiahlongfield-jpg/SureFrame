// Founder gives a tester a free Studio plan from /support/accounts.
// Needs the app running with AUTH_DEV_LOGIN=true and SUPPORT_EMAIL=owner@test.dev.
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
let failed = 0;
const ok = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"} ${name}`); if (!cond) failed++; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
async function signIn(email, next) {
  // Agreed to the current Terms and Privacy Policy, so signing in isn't stopped at /agree (e2e/agree.mjs).
  await agreed(email);
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/login?next=${next}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname === next, { timeout: 60000 });
  return page;
}
const tester = `trial${Date.now()}@example.com`;
const t = await signIn(tester, "/settings/billing");
ok("tester starts on Free", (await t.textContent("main")).includes("Free plan"));

const stranger = await signIn(`x${Date.now()}@example.com`, "/library");
await stranger.goto(BASE + "/support/accounts");
// Someone who doesn't answer support is sent to Help instead of the console (V60).
ok("non-founder can't open free plans page: sent to Help", await stranger.waitForURL((u) => u.pathname === "/help", { timeout: 15000 }).then(() => true, () => false), stranger.url());
ok("non-founder sees no free plans", !(await stranger.isVisible("text=Currently free")));

const owner = await signIn("owner@test.dev", "/support/accounts");
await owner.fill('input[name="email"]', "nobody@example.com");
await owner.fill('textarea[name="reason"]', "Trial for a partner");
await owner.click("text=Save");
// The plan starts unchosen (it used to default to Studio), and a refusal keeps what was typed.
await owner.waitForSelector("text=Choose a plan, or Back to Free");
ok("asks for a plan in the page", (await owner.inputValue('input[name="email"]')) === "nobody@example.com");
await owner.selectOption("select", "STUDIO");
await owner.click("text=Save");
await owner.waitForSelector("text=hasn't signed up yet");
ok("unknown email is refused", true);
await owner.fill('input[name="email"]', tester.toUpperCase());
await owner.selectOption("select", "STUDIO");
await owner.fill('textarea[name="reason"]', "Trial for a partner");
await owner.click("text=Save");
await owner.waitForSelector("text=free of charge");
ok("listed as currently free", (await owner.textContent("main")).includes(tester));

await t.goto(BASE + "/settings/billing");
const text = await t.textContent("main");
ok("tester now on Studio", text.includes("Studio plan"));
ok("billing says complimentary", text.includes("Complimentary"));
ok("can still choose a paid plan", text.includes("Choose a paid plan"));

await owner.fill('input[name="email"]', tester);
await owner.selectOption("select", "FREE");
await owner.fill('textarea[name="reason"]', "Trial ended");
await owner.click("text=Save");
await owner.waitForSelector("text=back on the Free plan");
await t.goto(BASE + "/settings/billing");
ok("taken back to Free", (await t.textContent("main")).includes("Free plan"));

await browser.close();
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
