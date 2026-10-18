// Email-link sign-in. Run against a server started with AUTH_EMAIL_LINKS=true
// (no RESEND_API_KEY), which writes emails to .data/outbox.
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { passAgree } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const outbox = ".data/outbox";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
// Earlier runs share this machine's IP; start with fresh rate-limit windows.
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage();
const email = `link${Date.now()}@example.com`;

await page.goto(BASE + "/login?next=/clients");
ok("password form hidden when email links are on", !(await page.isVisible('input[name="password"]')));
ok("Keep me signed in comes before the button, in tab order", await page.evaluate(() => {
  const keep = document.querySelector("[data-testid=keep-signed-in]");
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Email me a sign-in link"));
  return !!keep && !!button && !!(keep.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING);
}));
await page.fill('input[name="email"]', email);
await page.click("text=Email me a sign-in link");
await page.waitForURL("**/login/check**");
ok("check-your-email page shown", !!(await page.waitForSelector("text=Check your email", { timeout: 15000 }).catch(() => null)));
ok("it shows the whole address, never split mid-word by force", (await page.textContent("[data-testid=sent-to-address]")) === email && (await page.$eval("[data-testid=sent-to-address]", (e) => getComputedStyle(e).wordBreak)) !== "break-all");

const mail = readdirSync(outbox)
  .map((f) => JSON.parse(readFileSync(`${outbox}/${f}`, "utf8")))
  .find((m) => m.to === email);
ok("sign-in email sent", !!mail);
ok("email is branded", /SureFrame sign-in link/.test(mail?.subject ?? ""));
const link = mail.text.match(/https?:\/\/\S+/)[0];

// Opening the link (as a mail scanner would) doesn't use it up.
const scanner = await (await browser.newContext()).newPage();
await scanner.goto(link);
ok("the emailed link opens a confirm page", await scanner.isVisible("[data-testid=confirm-sign-in]"));
ok("a link that isn't ours is refused", await (async () => {
  await scanner.goto(BASE + "/login/confirm?link=" + encodeURIComponent("https://evil.example/x"));
  return (await scanner.waitForSelector("text=This link doesn't work", { timeout: 15000 }).then(() => true, () => false)) && !(await scanner.isVisible("[data-testid=confirm-sign-in]"));
})());

await page.goto(link);
await page.click("[data-testid=confirm-sign-in]");
// A new account agrees to the Terms of Service and Privacy Policy first (e2e/agree-gate.mjs), then carries on.
await page.waitForURL((u) => u.pathname === "/agree", { timeout: 30000 });
ok("a new account is asked to agree to the terms first", new URL(page.url()).searchParams.get("next") === "/clients");
await passAgree(page);
await page.waitForURL("**/clients");
ok("link signs in and returns to the page asked for", true);

const other = await (await browser.newContext()).newPage();
await other.goto(link);
await other.click("[data-testid=confirm-sign-in]");
// Wait for the redirect away from the confirm page, which "**/login**" alone would match straight away.
await other.waitForURL((u) => u.pathname === "/login");
ok("a used link is refused with a clear message", await other.waitForSelector("text=expired or was already used", { timeout: 15000 }).then(() => true, () => false));
// A closed account (waiting to be deleted) signing in by email is offered to keep it.
const closedEmail = `link-closed${Date.now()}@example.com`;
await prisma.user.create({ data: { email: closedEmail, deletionRequestedAt: new Date(Date.now() - 60_000), deleteAt: new Date(Date.now() + 29 * 86_400_000) } });
const closed = await (await browser.newContext()).newPage();
await closed.goto(BASE + "/login?next=/library");
await closed.fill('input[name="email"]', closedEmail);
await closed.click("text=Email me a sign-in link");
await closed.waitForURL("**/login/check**");
const closedMail = readdirSync(outbox)
  .map((f) => JSON.parse(readFileSync(`${outbox}/${f}`, "utf8")))
  .find((m) => m.to === closedEmail);
await closed.goto(closedMail.text.match(/https?:\/\/\S+/)[0]);
await closed.click("[data-testid=confirm-sign-in]");
await closed.waitForURL("**/account/restore", { timeout: 30000 });
ok("a closed account signing in by email is offered to keep it", await closed.waitForSelector("button:text-is('Keep my account')", { timeout: 15000 }).then(() => true, () => false));

// An account support closed gets no link: the page carries on as for anyone (it doesn't say which accounts are closed),
// and the email to that inbox says the account is closed, as the closure email did.
const shutEmail = `link-shut${Date.now()}@example.com`;
await prisma.user.create({ data: { email: shutEmail, closedAt: new Date(Date.now() - 86_400_000), deleteAt: new Date(Date.now() + 29 * 86_400_000) } });
const shut = await (await browser.newContext()).newPage();
await shut.goto(BASE + "/login?next=/library");
await shut.fill('input[name="email"]', shutEmail);
await shut.click("text=Email me a sign-in link");
await shut.waitForURL("**/login/check**");
ok("a support-closed account sees the usual check page", !!(await shut.waitForSelector("text=Check your email", { timeout: 15000 }).catch(() => null)));
const shutMail = readdirSync(outbox)
  .map((f) => JSON.parse(readFileSync(`${outbox}/${f}`, "utf8")))
  .filter((m) => m.to === shutEmail);
ok(
  "and is emailed that it's closed, with no sign-in link",
  shutMail.length === 1 && /account is closed/.test(shutMail[0].subject) && /no sign-in link was sent/.test(shutMail[0].text) && !/login\/confirm|api\/auth\/callback/.test(shutMail[0].text),
);

// Five links per address per hour: the sixth request is refused politely.
const spam = await (await browser.newContext()).newPage();
for (let i = 0; i < 5; i++) {
  await spam.goto(BASE + "/login");
  await spam.fill('input[name="email"]', email);
  await spam.click("text=Email me a sign-in link");
  await spam.waitForURL((u) => u.pathname === "/login/check" || u.searchParams.get("error") === "rate");
}
// Load the refused address afresh: headless Chromium here can leave a same-page redirect on the loading screen.
if (new URL(spam.url()).searchParams.get("error")) await spam.goto(spam.url());
ok("sign-in emails to one address are limited", await spam.waitForSelector("text=Too many sign-in emails", { timeout: 15000 }).then(() => true, () => false), spam.url());
await browser.close();
await prisma.$disconnect();
