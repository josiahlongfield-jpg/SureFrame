// The 6-digit code in sign-in emails (lib/signInCode.ts): typed on the Check your email page, it signs in that same
// window, so it works when the link would open somewhere else. Run against a server with AUTH_EMAIL_LINKS=true.
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
const mails = (email) =>
  readdirSync(outbox)
    .sort()
    .map((f) => JSON.parse(readFileSync(`${outbox}/${f}`, "utf8")))
    .filter((m) => m.to === email);
const codeFor = (email) => mails(email).at(-1)?.text.match(/sign-in page: (\d{3} \d{3})/)?.[1];

async function ask(page, email, next = "/library") {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Email me a sign-in link");
  await page.waitForURL("**/login/check**");
  await page.waitForSelector("[data-testid=code-form]", { timeout: 10000 }).catch(() => {});
}
async function type(page, code) {
  await page.fill("[data-testid=code-input]", code);
  await Promise.all([page.waitForNavigation({ timeout: 30000 }).catch(() => {}), page.click("[data-testid=code-submit]")]);
}
const alertText = (page) => page.locator("[data-testid=check-error]").textContent({ timeout: 10000 }).catch(() => "");

// ---------- the email carries a code, and the right code signs in this window ----------
const email = `code${Date.now()}@example.com`;
await agreed(email);
const ctx = await browser.newContext();
const page = await ctx.newPage();
await ask(page, email, "/settings/connections");
const code = codeFor(email);
ok("the sign-in email has a 6-digit code", /^\d{3} \d{3}$/.test(code ?? ""), String(code));
const mail = mails(email).at(-1);
ok("the code is in the email's HTML too", mail.html.includes(code), "");
ok("the email still has the sign-in link", /https?:\/\/\S+\/login\/confirm\?link=/.test(mail.text));
ok("the Check your email page has a code box", await page.isVisible("[data-testid=code-form]"));
await page.setViewportSize({ width: 320, height: 700 });
ok("the Check your email page fits a small phone", await page.evaluate(() => document.documentElement.scrollWidth <= 320));
await page.setViewportSize({ width: 1280, height: 800 });

await page.fill("[data-testid=code-input]", "12");
ok("a short code is held back by the box itself", !(await page.evaluate(() => document.querySelector("[data-testid=code-input]").checkValidity())));
const short = await ctx.request.post(`${BASE}/login/code`, { form: { code: "12", next: "/library" }, maxRedirects: 0 });
ok("a short code sent anyway is refused with a reason", (short.headers().location ?? "").includes("error=code-code"), short.headers().location);
const wrong = code === "000 000" ? "111 111" : "000 000";
await type(page, wrong);
ok("a wrong code says so", (await alertText(page)).includes("isn't right"), await alertText(page));
ok("the box is still there after a wrong code", await page.isVisible("[data-testid=code-input]"));
await type(page, code);
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
if (new URL(page.url()).pathname === "/agree") await passAgree(page);
await page.waitForURL("**/settings/connections", { timeout: 30000 }).catch(() => {});
ok("the right code signs in and goes where they were heading", new URL(page.url()).pathname === "/settings/connections", page.url());
ok("the code is used up", (await prisma.signInCode.count({ where: { email } })) === 0);

// ---------- a used code, a replaced code, and too many tries ----------
const ctx2 = await browser.newContext();
const p2 = await ctx2.newPage();
await ask(p2, email);
const first = codeFor(email);
await p2.click("[data-testid=send-again]", { timeout: 40000 });
await p2.waitForURL("**/login/check**again=1**");
await p2.waitForSelector("[data-testid=code-form]");
const second = codeFor(email);
if (first !== second) {
  await type(p2, first);
  ok("an older email's code stops working once a newer one is sent", (await alertText(p2)).includes("latest email") && new URL(p2.url()).pathname.startsWith("/login"), await alertText(p2));
} else ok("an older email's code stops working once a newer one is sent (same code drawn, skipped)", true);
const bad = second === "000 000" ? "111 111" : "000 000";
for (let i = 0; i < 5; i++) await type(p2, bad);
await type(p2, second);
ok("after 5 wrong tries even the right code is refused", (await alertText(p2)).includes("Too many wrong tries"), await alertText(p2));
ok("and nobody is signed in", new URL(p2.url()).pathname.startsWith("/login"));

// ---------- a code needs the window that asked for it ----------
const ctx3 = await browser.newContext();
const p3 = await ctx3.newPage();
await ask(p3, email);
const third = codeFor(email);
const other = await browser.newContext();
const res = await other.request.post(`${BASE}/login/code`, { form: { code: third, next: "/library" }, maxRedirects: 0 });
ok("a code sent from a browser that didn't ask is refused", res.status() === 303 && (res.headers().location ?? "").includes("error=code-expired"), `${res.status()} ${res.headers().location}`);
await type(p3, third);
await p3.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
ok("the window that asked can still use it", !new URL(p3.url()).pathname.startsWith("/login"), p3.url());

// ---------- the link still works on its own ----------
const ctx4 = await browser.newContext();
const p4 = await ctx4.newPage();
await ask(p4, email);
const link = mails(email).at(-1).text.match(/https?:\/\/\S+/)[0];
await p4.goto(link);
await p4.click("[data-testid=confirm-sign-in]");
await p4.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
ok("the emailed link still signs in", !new URL(p4.url()).pathname.startsWith("/login"), p4.url());

await browser.close();
await prisma.$disconnect();
