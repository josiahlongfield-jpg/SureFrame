// Signing in to connect Claude (lib/signInCode.ts): the email has a 6-digit code instead of a link, typed on the
// Check your email page so the window Claude opened finishes the sign-in. Other sign-ins keep the link only.
// Run against a server with AUTH_EMAIL_LINKS=true.
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
const codeFor = (email) => mails(email).at(-1)?.text.match(/to SureFrame: (\d{3} \d{3})/)?.[1];
// Claude's sign-in window lands here (src/app/oauth/authorize); the details don't matter for signing in.
const CLAUDE = "/oauth/authorize?response_type=code&client_id=test";

async function ask(page, email, next = CLAUDE) {
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
await ask(page, email);
const code = codeFor(email);
ok("signing in to connect Claude emails a 6-digit code", /^\d{3} \d{3}$/.test(code ?? ""), String(code));
const mail = mails(email).at(-1);
ok("the code is in the email's HTML too", mail.html.includes(code), "");
ok("and there's no sign-in link in it", !/https?:\/\//.test(mail.text) && !mail.html.includes("/login/confirm"), mail.text);
ok("the email says it's for connecting Claude", mail.subject.includes("connect Claude"), mail.subject);
ok("the page says to type it in this window", (await page.textContent("[data-testid=sent-to]")).includes("in this window"));
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
await page.waitForURL("**/oauth/authorize**", { timeout: 30000 }).catch(() => {});
ok("the right code signs in and goes back to Claude's Allow page", new URL(page.url()).pathname === "/oauth/authorize", page.url());
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

// ---------- every other sign-in: the link, and no code ----------
const ctx4 = await browser.newContext();
const p4 = await ctx4.newPage();
await ask(p4, email, "/library");
const normal = mails(email).at(-1);
ok("a normal sign-in email has the link and no code", /\/login\/confirm\?link=/.test(normal.text) && !/\d{3} \d{3}/.test(normal.text), normal.text);
ok("and its Check your email page has no code box", !(await p4.isVisible("[data-testid=code-form]")));
ok("no code is kept for it", (await prisma.signInCode.count({ where: { email } })) === 0);
await p4.goto(normal.text.match(/https?:\/\/\S+/)[0]);
await p4.click("[data-testid=confirm-sign-in]");
await p4.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
ok("the emailed link signs in", !new URL(p4.url()).pathname.startsWith("/login"), p4.url());

await browser.close();
await prisma.$disconnect();
