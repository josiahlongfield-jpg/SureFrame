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
await prisma.supportUse.deleteMany();
const fake = await startFakeAnthropic();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });

// Each browser here is a different network (the help chat's allowances count per network as well as per account).
let nets = 0;
const page = async (opts = {}) => (await browser.newContext({ ...opts, extraHTTPHeaders: { "x-real-ip": `10.7.0.${++nets}` } })).newPage();

async function ask(page, text) {
  const before = await page.locator("[aria-live=polite] .whitespace-pre-wrap").count();
  await page.fill('textarea[aria-label="Your message"]', text);
  await page.keyboard.press("Enter");
  await page.waitForFunction((n) => document.querySelectorAll("[aria-live=polite] .whitespace-pre-wrap").length >= n + 2, before, { timeout: 30000 });
  return (await page.locator("[aria-live=polite] .whitespace-pre-wrap").last().textContent()).trim();
}

// 1. A visitor on the home page opens Help and asks a question
const visitor = await page({ viewport: { width: 1280, height: 900 } });
await visitor.goto(BASE + "/");
await visitor.click("button:has-text('Help')");
ok("help panel opens", await visitor.isVisible("role=dialog[name='SureFrame help']"));
// The panel says a visitor's limits up front (O80, V40), and that the email is needed for a person (V38).
ok("panel: says a visitor's limits before they're reached", (await visitor.textContent("[data-testid=help-panel-limits]").catch(() => "")).includes("8 answers a day") && (await visitor.textContent("[data-testid=help-panel-limits]")).includes("once every 30 days"));
ok("panel: the email box says it's needed to talk to a person", (await visitor.textContent("#help-email-note")).includes("needed to talk to a person") && !(await visitor.textContent("#help-email-note")).includes("optional"));
await visitor.fill('input[aria-label="Your email"]', "visitor@example.com");
const a1 = await ask(visitor, "How do I add a client?");
ok("assistant answers", a1.includes("Clients page"), a1);
const call = requests.at(-1);
const system = [].concat(call.body.system);
const lastBlock = [].concat(call.body.messages.findLast((m) => m.role === "user").content).at(-1);
ok("uses the Claude API with the guide cached", call.body.model === "claude-opus-5-5" && system.some((b) => b.text?.includes("help guide") && b.cache_control?.type === "ephemeral") && lastBlock?.cache_control?.type === "ephemeral", JSON.stringify({ system: system.map((b) => b.cache_control), lastBlock: lastBlock?.cache_control }));
ok("tells the assistant the visitor isn't signed in", call.body.messages.some((m) => m.role === "system" && m.content.includes("not signed in")));
const note = call.body.messages.find((m) => m.role === "system")?.content ?? "";
ok("visitor: the assistant keeps to brief, general answers", note.includes("a website visitor without an account") && note.includes("not a full help service") && note.includes("/faq") && call.body.max_tokens <= 1200, note.slice(0, 200));

// 2. A refund is handed to a person
const a2 = await ask(visitor, "I was charged twice, I want a refund");
ok("refund handed over", a2.includes("passed this to the team"), a2);
await visitor.waitForSelector("[data-testid=with-person]");
const mail = outbox().find((m) => m.to === AGENT);
ok("support inbox emailed", !!mail && mail.subject.startsWith("[Urgent]") && mail.text.includes("double charge") && mail.replyTo === "visitor@example.com", mail?.subject);
const link = mail.text.match(/https?:\/\/\S+\/support\/\S+/)?.[0];
ok("email links to the conversation", !!link, link);
// The customer is told by email too, since the visitor gave an address (V36).
const ackMail = outbox().find((m) => m.to === "visitor@example.com" && m.subject === "Your question is with a person at SureFrame");
ok("hand-over: the visitor gets a short email saying a person has it", !!ackMail && ackMail.text.includes("within 2 business days") && ackMail.text.includes("/help#t=") && ackMail.text.includes("If you didn't ask"), ackMail?.text?.slice(0, 200));
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
ok("its tab says Page not found too, not Support inbox", (await other.title()).startsWith("Page not found"), await other.title());
ok("with a real 404", (await other.request.get(BASE + "/support/accounts")).status() === 404);
// ...and isn't offered to them: no Support in their Settings menu or on the Settings page.
await other.goto(BASE + "/library");
await other.click("[data-testid=settings-menu-button]");
await other.waitForSelector("[data-testid=settings-menu]");
ok("customers' Settings menu has no Support", (await other.locator("[data-testid=settings-menu] a[href='/support']").count()) === 0);
await other.goto(BASE + "/settings");
ok("nor does their Settings page", (await other.locator("main a[href='/support']").count()) === 0);

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
await agent.waitForSelector("text=summary", { timeout: 15000 }).catch(() => {});
ok("agent sees the summary", (await agent.textContent("main")).includes("Customer wants a refund"));
await agent.screenshot({ path: `${shots}/support-agent.png`, fullPage: true });
await agent.fill('textarea[aria-label="Your reply"]', "Sorry about that. I've refunded the second charge.");
await agent.click("text=Send reply by email");
await agent.waitForLoadState("networkidle");
// The reply email can land a moment after the page settles.
let sent;
for (let i = 0; i < 20 && !sent; i++) {
  sent = outbox().find((m) => m.to === "visitor@example.com" && m.subject === "Reply from SureFrame support");
  if (!sent) await new Promise((r) => setTimeout(r, 500));
}
ok("customer emailed the reply", !!sent && sent.text.includes("refunded the second charge") && sent.text.includes("/help#t="));

// 6. The visitor sees it from the email link
const fromEmail = await page();
await fromEmail.goto(sent.text.match(/https?:\/\/\S+\/help#t=\S+/)[0].replace(/^https?:\/\/[^/]+/, BASE));
await fromEmail.waitForSelector("text=SureFrame team");
ok("reply shows in the chat", (await fromEmail.textContent("main")).includes("refunded the second charge"));
ok("summary never reaches the customer", !(await fromEmail.content()).includes("Customer wants a refund"));
ok("token removed from the address bar", !fromEmail.url().includes("#t="));
// After the team's reply the status line says so, not that it's still waiting for a person (P15).
const repliedLine = (await fromEmail.textContent("[data-testid=with-person]").catch(() => "")).trim();
ok("after a person replies, the chat says the team replied", repliedLine.startsWith("SureFrame team replied.") && !repliedLine.includes("Passed to a person"), repliedLine);
const callsBeforeFollowUp = requests.length;
const ack = await ask(fromEmail, "Thanks! Will it show on my statement?");
ok("after a person replies, follow-ups go to them", ack.includes("added that to your conversation") && requests.length === callsBeforeFollowUp, ack);
await fromEmail.screenshot({ path: `${shots}/support-help-page.png` });

// 7. A signed-in customer asks about their plan
const owner = await page();
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
ok("Free plan: the assistant is told it's not paying", requests.at(-1).body.messages.some((m) => m.role === "system" && m.content.includes("on the Free plan (not paying)")));

// 8. The assistant failing still reaches a person
const a4 = await ask(owner, "explode");
ok("failure hands over", a4.includes("passed your message to the team"), a4);

// 8b. "Talk to a person" hands over straight away, without the assistant, and says so (Decision 3, 18 October 2026).
// A Free plan can do that once a week: the failure above already used it (Josiah, 18 October 2026).
await owner.click("[data-testid=new-conversation]");
const inv = `inv${Date.now()}`;
await owner.fill('textarea[aria-label="Your message"]', `Can someone check my invoice ${inv} from last month?`);
const callsBeforeRefusal = requests.length;
await owner.click("[data-testid=talk-to-person]");
const weekly = await owner.waitForSelector("form [role=alert]", { timeout: 15000 }).then((e) => e.textContent(), () => "");
ok("Free plan: a second person in a week is refused, with when to ask again", weekly.includes("once a week") && /You can ask again from \d{1,2} [A-Z][a-z]{2,3} \d{4}/.test(weekly) && weekly.includes("Paid plans can talk to a person any time"), weekly);
ok("Free plan: refused without a hand-over, the AI or losing the message", (await owner.locator("[data-testid=with-person]").count()) === 0 && requests.length === callsBeforeRefusal && (await owner.inputValue('textarea[aria-label="Your message"]')).includes(inv));
ok("Free plan: Talk to a person is off until the allowance lifts", (await owner.locator("[data-testid=talk-to-person]").count()) === 1 && (await owner.isDisabled("[data-testid=talk-to-person]")));
// Paying businesses can ask any time (a fresh page: the one above remembers the refusal until it lifts).
await prisma.workspace.updateMany({ where: { members: { some: { user: { email: planEmail } } } }, data: { plan: "SOLO" } });
await owner.reload();
await owner.click("button:has-text('Help')");
ok("panel: nothing about limits for a paying business", (await owner.locator("[data-testid=help-panel-limits]").count()) === 0);
await owner.fill('textarea[aria-label="Your message"]', `Can someone check my invoice ${inv} from last month?`);
const callsBeforeTalk = requests.length;
const mailsBeforeTalk = outbox().length;
await owner.click("[data-testid=talk-to-person]");
await owner.waitForSelector("[data-testid=with-person]");
const passed = (await owner.textContent("[data-testid=with-person]")).trim();
ok("talk to a person: the chat confirms it, with when and where", passed === "Passed to a person: we reply within 2 business days, here and by email.", passed);
ok("talk to a person: the assistant isn't asked", requests.length === callsBeforeTalk);
const talkMail = outbox().slice(mailsBeforeTalk).find((m) => m.to === AGENT);
ok("talk to a person: support is emailed, with the customer's words", !!talkMail && talkMail.text.includes("Talk to a person") && talkMail.text.includes(`check my invoice ${inv}`) && talkMail.replyTo === planEmail, talkMail?.text?.slice(0, 200));
ok("talk to a person: the button goes once it's done", (await owner.locator("[data-testid=talk-to-person]").count()) === 0);

// 8c. A visitor needs an email to talk to a person, and can do it once every 30 days (by network and by email)
const asker = await page({ viewport: { width: 1280, height: 900 } });
await asker.goto(BASE + "/help");
ok("help page: says what visitors get", (await asker.textContent("[data-testid=help-limits]")).includes("once every 30 days") && (await asker.locator("[data-testid=help-email]").count()) === 0);
await asker.click("[data-testid=talk-to-person]");
ok("visitor: asked where to reply before handing over", (await asker.textContent("#help-email-note")).includes("Where should a person reply?") && (await asker.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Your email");
ok("visitor: nothing sent yet, and no way on without an email", (await asker.locator("[data-testid=with-person]").count()) === 0 && (await asker.locator("[data-testid=person-without-email]").count()) === 0);
const noEmail = await fetch(BASE + "/api/support", { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": "10.7.1.1" }, body: JSON.stringify({ body: "hello", person: true }) });
ok("visitor without email: the server refuses a person too", noEmail.status === 429 && ((await noEmail.json()).error ?? "").includes("add your email"));
await asker.fill('input[aria-label="Your email"]', "visitor2@example.com");
await asker.click("[data-testid=talk-to-person]");
await asker.waitForSelector("[data-testid=with-person]");
ok("visitor with email: passed on, here and by email", (await asker.textContent("[data-testid=with-person]")).includes("here and by email"));
ok("visitor with email: told by email too", outbox().some((m) => m.to === "visitor2@example.com" && m.subject === "Your question is with a person at SureFrame"));
await asker.click("[data-testid=new-conversation]");
// With nothing typed: the refusal mustn't leave "I'd like to talk to a person" in the box (V37).
await asker.click("[data-testid=talk-to-person]");
const monthly = await asker.waitForSelector("form [role=alert]", { timeout: 15000 }).then((e) => e.textContent(), () => "");
ok("visitor: a second person within 30 days is refused, with when to ask again", monthly.includes("once every 30 days") && monthly.includes("You can ask again from") && monthly.includes("you've already done that"), monthly);
ok("visitor: the refusal leaves the message box empty", (await asker.inputValue('textarea[aria-label="Your message"]')) === "");
ok("visitor: Talk to a person is off after the refusal, Send isn't blocked by it", (await asker.locator("[data-testid=talk-to-person]").count()) === 1 && (await asker.isDisabled("[data-testid=talk-to-person]")) && (await asker.fill('textarea[aria-label="Your message"]', "x").then(() => asker.isEnabled("form button:has-text('Send')"))));
await asker.fill('textarea[aria-label="Your message"]', "");
const sameEmail = await fetch(BASE + "/api/support", { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": "10.7.1.2" }, body: JSON.stringify({ body: "hi", email: "Visitor2@example.com", person: true }) });
ok("visitor: the same email from another network is refused too", sameEmail.status === 429 && ((await sameEmail.json()).error ?? "").includes("once every 30 days"));
// Across all visitors, at most 5 people a day (two so far: the refund and visitor2).
await prisma.supportUse.createMany({ data: [1, 2, 3].map(() => ({ kind: "handover", key: "all:visitor" })) });
const crowd = await fetch(BASE + "/api/support", { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": "10.7.1.3" }, body: JSON.stringify({ body: "hi", email: "visitor3@example.com", person: true }) });
ok("visitors: past the day's ceiling, refused", crowd.status === 429 && ((await crowd.json()).error ?? "").includes("can't take more questions from website visitors today"));
await prisma.supportUse.deleteMany({ where: { kind: "handover", key: "all:visitor" } });
// Someone else on the same network used it: the refusal says so, rather than "you" (A1, V88).
const shared = (email) => fetch(BASE + "/api/support", { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": "10.7.1.9" }, body: JSON.stringify({ body: "hi", email, person: true }) });
const firstOnNet = await shared("net-one@example.com");
ok("network: the first visitor on it is passed to a person", firstOnNet.status === 200 && (await firstOnNet.json()).status === "NEEDS_HUMAN");
const secondOnNet = await shared("net-two@example.com");
const netBody = await secondOnNet.json();
ok("network: a second visitor is told someone on their network used it", secondOnNet.status === 429 && (netBody.error ?? "").includes("someone on your network") && !(netBody.error ?? "").includes("you've already"), netBody.error);
ok("network: the refusal says when it lifts and what it stops", netBody.stops === "person" && !Number.isNaN(Date.parse(netBody.until)));
await prisma.supportUse.deleteMany({ where: { kind: "handover", key: "all:visitor" } });

// 8c2. A visitor gets 8 AI answers a day; then the chat says when they can ask again
const chatty = await page({ viewport: { width: 1280, height: 900 } });
await chatty.goto(BASE + "/help");
for (let i = 0; i < 8; i++) await ask(chatty, `How do I add a client? (${i})`);
await chatty.fill('textarea[aria-label="Your message"]', "And one more question");
const callsBeforeNinth = requests.length;
await chatty.keyboard.press("Enter");
const daily = await chatty.waitForSelector("form [role=alert]", { timeout: 15000 }).then((e) => e.textContent(), () => "");
ok("visitor: the 9th answer in a day is refused, with when to ask again", daily.includes("8 answers a day") && daily.includes("You can ask again from") && requests.length === callsBeforeNinth, daily);
ok("visitor: the limit doesn't point to the support email", !daily.includes("@"));
ok("visitor: the limit names the network, not the visitor", daily.includes("used on your network"), daily);
ok("visitor: Send stays off while the limit lasts", (await chatty.inputValue('textarea[aria-label="Your message"]')) === "And one more question" && (await chatty.isDisabled("form button:has-text('Send')")));
const callsBeforeEnter = requests.length;
await chatty.keyboard.press("Enter");
await chatty.waitForTimeout(500);
ok("visitor: Enter doesn't send while the limit lasts", requests.length === callsBeforeEnter);

// 8d. The inbox: the hand-over is under Needs you, in the customer's words; closed ones can be found and reopened
await agent.goto(BASE + "/support");
const inbox = await agent.textContent("[data-testid=inbox-list]");
ok("inbox: the hand-over is under Needs you, with the customer's question", inbox.includes(planEmail) && inbox.includes(`Can someone check my invoice ${inv}`), inbox.slice(0, 300));
const rows = await agent.$$eval("[data-testid=inbox-list] li", (lis) => lis.map((li) => li.textContent));
ok("inbox: businesses on a plan come first, tagged", rows[0]?.includes(planEmail) && rows[0]?.includes("Plan given free") && rows.some((r) => r.includes("visitor2@example.com") && r.includes("Visitor")), rows.slice(0, 4).join(" | ").slice(0, 300));
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
// The keyboard: focus goes into the dialog and stays there; Escape closes it and goes back to Close (P61).
const inDialog = () => agent.evaluate(() => !!document.activeElement?.closest("[data-testid=close-ticket-dialog]"));
let keptIn = await inDialog();
for (let i = 0; i < 4; i++) {
  await agent.keyboard.press("Tab");
  keptIn &&= await inDialog();
}
await agent.keyboard.press("Shift+Tab");
keptIn &&= await inDialog();
ok("ticket: Tab stays inside the Close dialog", keptIn);
await agent.keyboard.press("Escape");
const backOnClose = await agent.waitForFunction(() => document.activeElement?.dataset.testid === "close-ticket", null, { timeout: 5000 }).then(() => true, () => false);
ok("ticket: Escape closes it and focus goes back to Close", (await agent.locator("[data-testid=close-ticket-dialog]").count()) === 0 && backOnClose);
await agent.click("[data-testid=close-ticket]");
await agent.click("[data-testid=close-ticket-dialog] >> text=Close it");
await agent.waitForSelector("[data-testid=ticket-done]");
await agent.goto(BASE + "/support?show=open");
ok("closed: gone from the open lists", !(await agent.textContent("body")).includes(inv));
await agent.goto(`${BASE}/support?show=closed&q=${inv}`);
ok("closed: found under Closed by searching", (await agent.textContent("[data-testid=inbox-list]").catch(() => "")).includes(planEmail));
ok("closed: the card says when it was closed", /^Closed \d{1,2} [A-Z][a-z]{2,3} \d{4}/.test((await agent.textContent("[data-testid=inbox-time]").catch(() => "")).trim()));
// A search looks through every list, not only the one it's started from (P6).
await agent.goto(`${BASE}/support?q=${inv}`);
ok("search from Needs you finds a closed conversation too", (await agent.textContent("[data-testid=inbox-list]").catch(() => "")).includes(planEmail) && (await agent.textContent("[data-testid=inbox-search-note]")).includes("open and closed"));
await agent.goto(ticketUrl);
await agent.click("[data-testid=reopen-ticket]");
await agent.waitForSelector("[data-testid=ticket-done]");
await agent.goto(BASE + "/support");
ok("reopened: back under Needs you", (await agent.textContent("[data-testid=inbox-list]")).includes(inv));
await agent.goto(ticketUrl);
ok("delete: says what the customer will see (P16)", (await agent.textContent("[data-testid=delete-ticket-note]")).includes("The customer isn’t emailed"));
await agent.click("[data-testid=delete-ticket]");
ok("delete: asks first, in the page", await agent.isVisible("[data-testid=delete-ticket-dialog]"));
await agent.click("[data-testid=delete-ticket-dialog] >> text=Cancel");
await agent.reload();
ok("delete: Cancel keeps it", (await agent.textContent("body")).includes(inv));
// Deleting it is written to the support log (P13), and its old address says it was deleted, in the support pages (P12).
await agent.click("[data-testid=delete-ticket]");
await agent.click("[data-testid=delete-ticket-dialog] >> text=Delete it");
await agent.waitForURL((u) => u.pathname === "/support", { timeout: 15000 }).catch(() => {});
const ticketId = ticketUrl.split("/").pop();
const delRow = await prisma.adminAction.findFirst({ where: { action: "support.delete", details: { path: ["ticketId"], equals: ticketId } } });
ok("delete: written to the support log, without what was said", delRow?.actorEmail === AGENT && delRow.target === planEmail && !JSON.stringify(delRow.details).includes(inv));
// The customer's chat says it ended, rather than going blank (P16); support is told that's all they see.
await owner.reload();
await owner.click("button:has-text('Help')");
ok("delete: the customer's chat says the conversation ended and was removed (P16)", (await owner.textContent("[data-testid=chat-gone]", { timeout: 15000 }).catch(() => "")).includes("Your earlier conversation has ended and was removed"));
await agent.goto(ticketUrl);
ok("delete: the old address says it was deleted, in the support pages", (await agent.textContent("[data-testid=ticket-gone]").catch(() => "")).includes("This conversation was deleted") && (await agent.locator("[data-testid=support-nav]").count()) === 1);
await agent.goto(BASE + "/support/log?action=support.delete");
ok("delete: shown in the support log", (await agent.textContent("[data-testid=history]").catch(() => "")).includes("Support conversation deleted"));
// The support pages' links stay on one row on a narrow phone, scrolling sideways (P59).
await agent.setViewportSize({ width: 320, height: 700 });
await agent.goto(BASE + "/support/offers");
const navRow = await agent.evaluate(() => {
  const nav = document.querySelector("[data-testid=support-nav]");
  const links = [...nav.querySelectorAll("a")].map((a) => a.getBoundingClientRect().top);
  const on = nav.querySelector("[aria-current=page]").getBoundingClientRect();
  const box = nav.getBoundingClientRect();
  return { oneRow: new Set(links.map(Math.round)).size === 1, onShown: on.left >= box.left - 1 && on.right <= box.right + 1, wide: document.documentElement.scrollWidth <= innerWidth };
});
ok("320px: the support links stay on one row, the current one in view, no sideways page scroll", navRow.oneRow && navRow.onShown && navRow.wide, JSON.stringify(navRow));
await agent.setViewportSize({ width: 1280, height: 1000 });
await agent.goto(BASE + "/library");
await agent.click("[data-testid=settings-menu-button]");
ok("app: Support is in the Settings menu for the support address", (await agent.getAttribute("[data-testid=settings-menu] a:has-text('Support')", "href")) === "/support");

// 8e. The help panel and the keyboard: focus goes in, Tab stays in, Escape closes and goes back to Help
const kb = await page({ viewport: { width: 1280, height: 900 } });
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

// 8f. Phones: the Help button floats in the corner without scrolling to the end, steps aside while scrolling down
// or typing, and the page keeps room at its end; the panel leaves room for the conversation
const small = await (await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true })).newPage();
await small.goto(BASE + "/");
await small.waitForSelector("[data-testid=help-button]");
const place = await small.evaluate(() => {
  const r = document.querySelector("[data-testid=help-button]").getBoundingClientRect();
  return { position: getComputedStyle(document.querySelector("[data-testid=help-button]")).position, bottom: innerHeight - r.bottom, right: innerWidth - r.right, top: r.top };
});
ok("320px: Help floats in the bottom-right corner on the first screen", place.position === "fixed" && place.top < 568 && place.bottom >= 8 && place.bottom <= 24 && place.right >= 8 && place.right <= 24, JSON.stringify(place));
const shown = () => small.evaluate(() => { const b = document.querySelector("[data-testid=help-button]"); return getComputedStyle(b).opacity === "1" && !b.dataset.tucked; });
await small.mouse.wheel(0, 400);
await small.evaluate(() => window.scrollBy(0, 300));
ok("320px: it steps aside while the page is scrolled down", await small.waitForFunction(() => document.querySelector("[data-testid=help-button]").dataset.tucked === "true", null, { timeout: 3000 }).then(() => true, () => false));
ok("320px: and comes back once scrolling stops", await small.waitForFunction(() => !document.querySelector("[data-testid=help-button]").dataset.tucked, null, { timeout: 4000 }).then(() => true, () => false));
await small.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await small.waitForTimeout(1600);
const end = await small.evaluate(() => {
  const b = document.querySelector("[data-testid=help-button]").getBoundingClientRect();
  // The last thing on the page (the footer's links) is clear of the button at the end of the page.
  const links = [...document.querySelectorAll("footer a")].map((a) => a.getBoundingClientRect());
  return { overlaps: links.filter((l) => l.right > b.left && l.left < b.right && l.bottom > b.top && l.top < b.bottom).length };
});
ok("320px: at the end of the page it covers none of the footer's links", end.overlaps === 0, JSON.stringify(end));
ok("320px: it's showing at the end of the page", await shown());
// Typing in a field (on-screen keyboard up) tucks it away too, and leaving the field brings it back.
await small.evaluate(() => { const i = document.createElement("input"); i.id = "probe"; document.querySelector("main").prepend(i); });
await small.focus("#probe");
ok("320px: it steps aside while a field is being typed in", await small.waitForFunction(() => document.querySelector("[data-testid=help-button]").dataset.tucked === "true", null, { timeout: 3000 }).then(() => true, () => false));
await small.evaluate(() => document.getElementById("probe").blur());
ok("320px: and is back when the field is left", await small.waitForFunction(() => !document.querySelector("[data-testid=help-button]").dataset.tucked, null, { timeout: 3000 }).then(() => true, () => false));
await small.evaluate(() => document.getElementById("probe").remove());
await small.click("[data-testid=help-button]");
await small.waitForSelector("role=dialog[name='SureFrame help']");
const room = await small.evaluate(() => document.querySelector("[role=dialog] [aria-live=polite]").clientHeight);
ok("320px: the conversation gets room in the panel", room >= 240, String(room));
ok("320px: no sideways scroll with the panel open", await small.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
// The page behind the open sheet doesn't scroll (V87).
const behind = await small.evaluate(() => scrollY);
await small.mouse.move(4, 300);
await small.mouse.wheel(0, 500);
await small.waitForTimeout(300);
ok("320px: the page behind the help sheet doesn't scroll", (await small.evaluate(() => scrollY)) === behind && (await small.evaluate(() => getComputedStyle(document.documentElement).overflow)) === "hidden");
await small.screenshot({ path: `${shots}/support-help-320.png` });
await small.click("button[aria-label='Close help']");
ok("320px: the page scrolls again once it's closed", (await small.evaluate(() => getComputedStyle(document.documentElement).overflow)) !== "hidden");
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
