// The support assistant. A visitor asks a question and the assistant answers;
// a refund request is handed to a person, who is emailed and answers from the
// /support inbox; the reply appears in the visitor's chat and by email. A
// signed-in customer's plan question uses their account. A failing assistant
// still hands over. Needs the app running with SUPPORT_EMAIL=owner@test.dev,
// ANTHROPIC_API_KEY=test and ANTHROPIC_BASE_URL=http://localhost:12112.
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { requests, startFakeAnthropic } from "./fake-anthropic.mjs";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const AGENT = "owner@test.dev";
const shots = process.argv[2] ?? "/tmp";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
  if (!cond) process.exitCode = 1;
};
const outbox = () => {
  try {
    return readdirSync(".data/outbox").sort().map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8")));
  } catch {
    return [];
  }
};
rmSync(".data/outbox", { recursive: true, force: true });
// Earlier runs share this machine's IP; start with fresh rate-limit windows.
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
const fake = await startFakeAnthropic();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });

async function ask(page, text) {
  const before = await page.locator("[aria-live=polite] .whitespace-pre-wrap").count();
  await page.fill('textarea[aria-label="Your message"]', text);
  await page.keyboard.press("Enter");
  await page.waitForFunction((n) => document.querySelectorAll("[aria-live=polite] .whitespace-pre-wrap").length >= n + 2, before, { timeout: 30000 });
  return (await page.locator("[aria-live=polite] .whitespace-pre-wrap").last().textContent()).trim();
}

// 1. A visitor on the home page opens Help and asks a question
const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await visitor.goto(BASE + "/");
await visitor.click("button:has-text('Help')");
ok("help panel opens", await visitor.isVisible("role=dialog[name='SureFrame help']"));
await visitor.fill('input[aria-label="Your email"]', "visitor@example.com");
const a1 = await ask(visitor, "How do I add a client?");
ok("assistant answers", a1.includes("Clients page"), a1);
const call = requests.at(-1);
const system = [].concat(call.body.system);
const lastBlock = [].concat(call.body.messages.findLast((m) => m.role === "user").content).at(-1);
ok("uses the Claude API with the guide cached", call.body.model === "claude-opus-5-5" && system.some((b) => b.text?.includes("help guide") && b.cache_control?.type === "ephemeral") && lastBlock?.cache_control?.type === "ephemeral", JSON.stringify({ system: system.map((b) => b.cache_control), lastBlock: lastBlock?.cache_control }));
ok("tells the assistant the visitor isn't signed in", call.body.messages.some((m) => m.role === "system" && m.content.includes("not signed in")));

// 2. A refund is handed to a person
const a2 = await ask(visitor, "I was charged twice, I want a refund");
ok("refund handed over", a2.includes("passed this to the team"), a2);
await visitor.waitForSelector("[data-testid=with-person]");
const mail = outbox().find((m) => m.to === AGENT);
ok("support inbox emailed", !!mail && mail.subject.startsWith("[Urgent]") && mail.text.includes("double charge") && mail.replyTo === "visitor@example.com", mail?.subject);
const link = mail.text.match(/https?:\/\/\S+\/support\/\S+/)?.[0];
ok("email links to the conversation", !!link, link);
await visitor.screenshot({ path: `${shots}/support-visitor.png` });

// 3. Before a person replies, the assistant keeps helping, and the team hears about it
const mailsBefore = outbox().length;
const a3b = await ask(visitor, "Also, how do I add a client?");
ok("assistant still answers while waiting for a person", a3b.includes("Clients page"), a3b);
ok("system note says it's already with the team", requests.at(-1).body.messages.some((m) => m.role === "system" && m.content.includes("already been passed to the team")));
ok("inbox told about the new message", outbox().slice(mailsBefore).some((m) => m.to === AGENT && m.subject.includes("(new message)")));

// 4. Not an agent: the inbox is hidden
const other = await (await browser.newContext()).newPage();
await other.goto(BASE + "/support");
const otherEmail = `someone${Date.now()}@peak.com`;
await agreed(otherEmail);
await other.fill('input[name="email"]', otherEmail);
await other.click("text=Continue");
await other.waitForURL("**/support");
await other.waitForSelector("text=Page not found");
ok("inbox hidden from customers", !(await other.textContent("body")).includes("visitor@example.com"));
ok("with a real 404", (await other.request.get(BASE + "/support/accounts")).status() === 404);

// 5. The agent answers from the inbox
const agentCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const agent = await agentCtx.newPage();
await agent.goto(BASE + "/support");
await agreed(AGENT);
await agent.fill('input[name="email"]', AGENT);
await agent.click("text=Continue");
await agent.waitForURL("**/support");
// Past the loading screen (app/support/loading.tsx).
await agent.waitForSelector("[data-testid=inbox-list]");
ok("inbox lists the ticket as urgent", (await agent.textContent("main")).includes("visitor@example.com") && (await agent.textContent("main")).toLowerCase().includes("urgent"));
await agent.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
ok("agent sees the summary", (await agent.textContent("main")).includes("Customer wants a refund"));
await agent.screenshot({ path: `${shots}/support-agent.png`, fullPage: true });
await agent.fill('textarea[aria-label="Your reply"]', "Sorry about that. I've refunded the second charge.");
await agent.click("text=Send reply by email");
await agent.waitForLoadState("networkidle");
const sent = outbox().find((m) => m.to === "visitor@example.com");
ok("customer emailed the reply", !!sent && sent.text.includes("refunded the second charge") && sent.text.includes("/help#t="));

// 6. The visitor sees it from the email link
const fromEmail = await (await browser.newContext()).newPage();
await fromEmail.goto(sent.text.match(/https?:\/\/\S+\/help#t=\S+/)[0].replace(/^https?:\/\/[^/]+/, BASE));
await fromEmail.waitForSelector("text=SureFrame team");
ok("reply shows in the chat", (await fromEmail.textContent("main")).includes("refunded the second charge"));
ok("summary never reaches the customer", !(await fromEmail.content()).includes("Customer wants a refund"));
ok("token removed from the address bar", !fromEmail.url().includes("#t="));
const callsBeforeFollowUp = requests.length;
const ack = await ask(fromEmail, "Thanks! Will it show on my statement?");
ok("after a person replies, follow-ups go to them", ack.includes("added that to your conversation") && requests.length === callsBeforeFollowUp, ack);
await fromEmail.screenshot({ path: `${shots}/support-help-page.png` });

// 7. A signed-in customer asks about their plan
const owner = await (await browser.newContext()).newPage();
await owner.goto(BASE + "/settings/billing");
const planEmail = `plan${Date.now()}@peak.com`;
await agreed(planEmail);
await owner.fill('input[name="email"]', planEmail);
await owner.click("text=Continue");
await owner.waitForURL("**/settings/billing");
await owner.click("button:has-text('Help')");
ok("no email box when signed in", !(await owner.isVisible('input[aria-label="Your email"]')));
const a3 = await ask(owner, "What's my plan?");
ok("assistant reads the account", a3.includes("Free plan"), a3);

// 8. The assistant failing still reaches a person
const a4 = await ask(owner, "explode");
ok("failure hands over", a4.includes("passed your message to the team"), a4);

// 8b. "Talk to a person" hands over straight away, without the assistant, and says so (Decision 3, 18 October 2026)
await owner.click("[data-testid=new-conversation]");
const callsBeforeTalk = requests.length;
const mailsBeforeTalk = outbox().length;
const inv = `inv${Date.now()}`;
await owner.fill('textarea[aria-label="Your message"]', `Can someone check my invoice ${inv} from last month?`);
await owner.click("[data-testid=talk-to-person]");
await owner.waitForSelector("[data-testid=with-person]");
const passed = (await owner.textContent("[data-testid=with-person]")).trim();
ok("talk to a person: the chat confirms it, with when and where", passed === "Passed to a person: we reply within 2 business days, here and by email.", passed);
ok("talk to a person: the assistant isn't asked", requests.length === callsBeforeTalk);
const talkMail = outbox().slice(mailsBeforeTalk).find((m) => m.to === AGENT);
ok("talk to a person: support is emailed, with the customer's words", !!talkMail && talkMail.text.includes("Talk to a person") && talkMail.text.includes(`check my invoice ${inv}`) && talkMail.replyTo === planEmail, talkMail?.text?.slice(0, 200));
ok("talk to a person: the button goes once it's done", (await owner.locator("[data-testid=talk-to-person]").count()) === 0);

// 8c. A visitor with no email is asked for one first, and can go on without it
const asker = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await asker.goto(BASE + "/help");
await asker.click("[data-testid=talk-to-person]");
ok("visitor: asked where to reply before handing over", (await asker.textContent("#help-email-note")).includes("Where should a person reply?") && (await asker.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Your email");
ok("visitor: nothing sent yet", (await asker.locator("[data-testid=with-person]").count()) === 0);
await asker.click("[data-testid=person-without-email]");
await asker.waitForSelector("[data-testid=with-person]");
ok("visitor without email: passed on, reply here only", (await asker.textContent("[data-testid=with-person]")).includes("here in this chat. Add your email below"));
const asker2 = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await asker2.goto(BASE + "/help");
await asker2.fill('input[aria-label="Your email"]', "visitor2@example.com");
await asker2.click("[data-testid=talk-to-person]");
await asker2.waitForSelector("[data-testid=with-person]");
ok("visitor with email: passed on, here and by email", (await asker2.textContent("[data-testid=with-person]")).includes("here and by email"));

// 8d. The inbox: the hand-over is under Needs you, in the customer's words; closed ones can be found and reopened
await agent.goto(BASE + "/support");
const inbox = await agent.textContent("[data-testid=inbox-list]");
ok("inbox: the hand-over is under Needs you, with the customer's question", inbox.includes(planEmail) && inbox.includes(`Can someone check my invoice ${inv}`), inbox.slice(0, 300));
ok("inbox: rows quote the customer, not the assistant", !inbox.includes("I've passed this to the team") && !inbox.includes("open the Clients page"));
ok("inbox: times in Queensland time", /\d{1,2} [A-Z][a-z]{2,3} \d{4}, \d{1,2}:\d\d [ap]m AEST/.test(inbox) && !inbox.includes("UTC"));
ok("inbox: no delete-everything box, a link to its own page instead", (await agent.locator("button:has-text('Delete everything')").count()) === 0 && !!(await agent.waitForSelector("[data-testid=clear-link]", { timeout: 10000 }).catch(() => null)));
ok("support pages: SureFrame's bar with a way back to the app", (await agent.getAttribute("[data-testid=back-to-app]", "href")) === "/library");
const navs = [];
for (const p of ["/support", "/support/lookup", "/support/log", "/support/accounts", "/support/offers", "/support/clear"]) {
  await agent.goto(BASE + p);
  navs.push((await agent.textContent("[data-testid=support-nav]")).trim());
}
ok("support pages: the same links on every page, Discounts included", navs.every((n) => n === navs[0]) && navs[0] === "InboxLook upSupport logFree plansDiscounts", navs.join(" | "));
await agent.goto(BASE + "/support");
await agent.click(`[data-testid=inbox-list] a:has-text('${inv}')`);
await agent.waitForSelector("text=Look up this account");
await agent.click("text=Send reply by email");
ok("ticket: an empty reply says so in the page", !!(await agent.waitForSelector("text=Write your reply first.", { timeout: 15000 }).catch(() => null)));
await agent.fill('textarea[aria-label="Your reply"]', "I've had a look at your invoice: it's right.");
await agent.click("text=Send reply by email");
ok("ticket: after replying, says where it went", (await agent.waitForSelector("[data-testid=reply-sent]", { timeout: 15000 }).then((e) => e.textContent()).catch(() => "")).includes(`Reply sent by email to ${planEmail}`));
const ticketUrl = agent.url().split("?")[0];
await agent.click("[data-testid=close-ticket]");
ok("ticket: Close asks first, in the page", await agent.isVisible("[data-testid=close-ticket-dialog]"));
await agent.click("[data-testid=close-ticket-dialog] >> text=Close it");
await agent.waitForSelector("[data-testid=ticket-done]");
await agent.goto(BASE + "/support?show=open");
ok("closed: gone from the open lists", !(await agent.textContent("body")).includes(inv));
await agent.goto(`${BASE}/support?show=closed&q=${inv}`);
ok("closed: found under Closed by searching", (await agent.textContent("[data-testid=inbox-list]").catch(() => "")).includes(planEmail));
await agent.goto(ticketUrl);
await agent.click("[data-testid=reopen-ticket]");
await agent.waitForSelector("[data-testid=ticket-done]");
await agent.goto(BASE + "/support");
ok("reopened: back under Needs you", (await agent.textContent("[data-testid=inbox-list]")).includes(inv));
await agent.goto(ticketUrl);
await agent.click("[data-testid=delete-ticket]");
ok("delete: asks first, in the page", await agent.isVisible("[data-testid=delete-ticket-dialog]"));
await agent.click("[data-testid=delete-ticket-dialog] >> text=Cancel");
await agent.reload();
ok("delete: Cancel keeps it", (await agent.textContent("body")).includes(inv));
await agent.goto(BASE + "/library");
await agent.click("[data-testid=settings-menu-button]");
ok("app: Support is in the Settings menu for the support address", (await agent.getAttribute("[data-testid=settings-menu] a:has-text('Support')", "href")) === "/support");

// 8e. The help panel and the keyboard: focus goes in, Tab stays in, Escape closes and goes back to Help
const kb = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await kb.goto(BASE + "/pricing");
await kb.focus("[data-testid=help-button]");
await kb.keyboard.press("Enter");
await kb.waitForSelector("role=dialog[name='SureFrame help']");
const inPanel = () => kb.evaluate(() => !!document.activeElement?.closest("[role=dialog]"));
ok("panel: takes focus when opened", await inPanel());
let stayed = true;
for (let i = 0; i < 12; i++) {
  await kb.keyboard.press("Tab");
  stayed &&= await inPanel();
}
for (let i = 0; i < 4; i++) {
  await kb.keyboard.press("Shift+Tab");
  stayed &&= await inPanel();
}
ok("panel: Tab and Shift+Tab stay inside it", stayed);
await kb.keyboard.press("Escape");
const backOnHelp = await kb.waitForFunction(() => document.activeElement?.dataset.testid === "help-button", null, { timeout: 5000 }).then(() => true, () => false);
ok("panel: Escape closes it and focus goes back to Help", (await kb.locator("role=dialog[name='SureFrame help']").count()) === 0 && backOnHelp);

// 8f. Phones: the Help button never sits over the page; the panel leaves room for the conversation
const small = await (await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true })).newPage();
await small.goto(BASE + "/");
await small.waitForSelector("[data-testid=help-button]", { state: "attached" });
const place = await small.evaluate(() => {
  const b = document.querySelector("[data-testid=help-button]");
  const r = b.getBoundingClientRect();
  return { position: getComputedStyle(b).position, top: r.top + scrollY, page: document.documentElement.scrollHeight, inView: r.top < innerHeight };
});
ok("320px: Help sits at the end of the page, not over it", place.position === "absolute" && !place.inView && place.page - place.top < 80, JSON.stringify(place));
await small.click("[data-testid=help-button]");
await small.waitForSelector("role=dialog[name='SureFrame help']");
const room = await small.evaluate(() => document.querySelector("[role=dialog] [aria-live=polite]").clientHeight);
ok("320px: the conversation gets room in the panel", room >= 240, String(room));
ok("320px: no sideways scroll with the panel open", await small.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await small.screenshot({ path: `${shots}/support-help-320.png` });
await owner.setViewportSize({ width: 390, height: 844 });
await owner.goto(BASE + "/library");
await owner.click("[data-testid=menu-button]");
await owner.click("[data-testid=menu-help]");
ok("phone: Help in the app's menu opens the chat", await owner.isVisible("role=dialog[name='SureFrame help']"));

// 9. Validation
const bad = await fetch(BASE + "/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: "" }) });
ok("empty message refused", bad.status === 400);
const missing = await fetch(BASE + "/api/support", { headers: { "x-support-token": "x".repeat(32) } });
ok("unknown conversation is 404", missing.status === 404);

// 10. Daily allowance: a visitor who isn't signed in gets 25 help-chat messages a day.
const day = 86_400_000;
await prisma.rateLimit.upsert({
  where: { key_windowStart: { key: "support-day:ip:127.0.0.1", windowStart: new Date(Math.floor(Date.now() / day) * day) } },
  create: { key: "support-day:ip:127.0.0.1", windowStart: new Date(Math.floor(Date.now() / day) * day), count: 25 },
  update: { count: 25 },
});
const over = await fetch(BASE + "/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: "one more" }) });
ok("over the daily allowance: refused", over.status === 429, String(over.status));
ok("says to email instead", ((await over.json()).error ?? "").includes("today's limit"));
await prisma.rateLimit.deleteMany({ where: { key: "support-day:ip:127.0.0.1" } });
await prisma.$disconnect();

await browser.close();
fake.close();
