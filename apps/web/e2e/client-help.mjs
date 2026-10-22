// The help chat on client pages (components/ClientHelp.tsx, api/client-help, lib/support/clientHelp.ts):
// - a Help button in the client top bar on the video page, the inbox, the "can't open" card and the emails page,
//   opening a panel under the bar that pushes the page down (never over the player or reply box), fits 320px,
//   and closes with Escape (focus back on Help); the business help chat isn't on these pages;
// - answers come from the client guide; when it can't help, it names the business whose link this is and the
//   reply-to address its emails use (the assigned staff member's own first), never SureFrame, and nothing goes
//   to the support inbox (no tickets, no emails); the AI gets no title, address or content;
// - only the client whose link this is can use it (this device's cookie, or the emails page's signed link);
// - each question is recorded (text and business only), and the support address gets a weekly digest from
//   the daily job, once a week; questions over 90 days old are pruned.
// Needs the app running with SUPPORT_EMAIL=owner@test.dev, ANTHROPIC_API_KEY=test, ANTHROPIC_BASE_URL=http://localhost:12112,
// CRON_SECRET, no RESEND_API_KEY (mail goes to .data/outbox). Starts the fake AI (hold the stubs lock).
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { requests, startFakeAnthropic } from "./fake-anthropic.mjs";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret";
const SUPPORT = "owner@test.dev";
const shots = process.argv[2] ?? "/tmp/claude-0/client-help-shots";
mkdirSync(shots, { recursive: true });
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};
const stamp = Date.now();
const outbox = () => (existsSync(".data/outbox") ? readdirSync(".data/outbox").sort().map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8"))) : []);
const cron = async () => {
  const r = await fetch(`${BASE}/api/cron/purge`, { headers: { Authorization: `Bearer ${CRON}` } });
  return r.status === 200 ? r.json() : { status: r.status };
};
const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const fake = await startFakeAnthropic();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });

// ---------- Two businesses, each with a client on the same phone ----------
const ownerA = await agreed(`clienthelp-a${stamp}@example.com`, { name: "Team member 1" });
const ownerB = await agreed(`clienthelp-b${stamp}@example.com`, { name: "Team member 2" });
const wsA = await prisma.workspace.create({ data: { name: `Business A ${stamp}`, reminderReplyTo: `replies-a${stamp}@example.com`, members: { create: { userId: ownerA.id, role: "OWNER" } } } });
const wsB = await prisma.workspace.create({ data: { name: `Business B ${stamp}`, members: { create: { userId: ownerB.id, role: "OWNER" } } } });
const clientA = await prisma.client.create({ data: { name: "Client A", email: `clienta${stamp}@example.com`, token: `ch-a-${stamp}-${"x".repeat(20)}`, workspaceId: wsA.id } });
const clientB = await prisma.client.create({ data: { name: "Client A", token: `ch-b-${stamp}-${"y".repeat(20)}`, workspaceId: wsB.id } });
const TITLE = `Private plan ${stamp}`;
const video = await prisma.video.create({
  data: { id: `ch${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/ch`, status: "UPLOADED", encrypted: true, teamKeyWrap: "t".repeat(60), clientKeyWrap: "k".repeat(60), workspaceId: wsA.id, ownerId: ownerA.id, clientId: clientA.id, title: TITLE },
});
const nameA = wsA.name;
const nameB = wsB.name;
const ticketsBefore = await prisma.supportTicket.count();
const mailsBefore = outbox().length;
const post = (page, data) => page.request.post(`${BASE}/api/client-help`, { data, failOnStatusCode: false });

// ---------- Refused without the client's link ----------
const stranger = await (await browser.newContext()).newPage();
await stranger.goto(`${BASE}/v/${video.id}`);
ok("private page without the link: no Help", (await stranger.locator("[data-testid=client-help-button]").count()) === 0);
const q = (text) => ({ clientId: clientA.id, page: "video", messages: [{ role: "client", text }] });
ok("API refuses a device without the client's link", (await post(stranger, q("How do I reply?"))).status() === 404);
ok("API refuses a wrong email signature", (await post(stranger, { ...q("How do I reply?"), page: "emails", s: "nope" })).status() === 404);
ok("API refuses an unknown client", (await post(stranger, { ...q("How do I reply?"), clientId: "nobody" })).status() === 404);

// ---------- The client's phone, 320px wide ----------
const phoneCtx = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
const phone = await phoneCtx.newPage();
await phone.goto(`${BASE}/c/${clientA.token}?v=${video.id}`);
await phone.waitForURL(`**/v/${video.id}`);
await phone.waitForSelector("[data-testid=client-help-button]");
ok("video page: Help in the top bar", await phone.isVisible("header [data-testid=client-help-button]"));
ok("video page: not the business help chat", (await phone.locator("[data-testid=help-button]").count()) === 0);
ok("video page with Help fits 320px", await fits(phone));

async function ask(page, text) {
  const before = await page.locator("[data-testid=client-help-messages] .whitespace-pre-wrap").count();
  await page.fill("textarea[aria-label='Your question']", text);
  await page.keyboard.press("Enter");
  await page.waitForFunction((n) => document.querySelectorAll("[data-testid=client-help-messages] .whitespace-pre-wrap").length >= n + 2, before, { timeout: 30000 });
  return (await page.locator("[data-testid=client-help-messages] .whitespace-pre-wrap").last().textContent()).trim();
}

/** The chat's first message, once it has settled on what it can offer. */
async function greeting(page, has) {
  await page.waitForFunction((h) => document.querySelector("[data-testid=client-help-messages] .whitespace-pre-wrap")?.textContent.includes(h), has, { timeout: 5000 }).catch(() => {});
  return ((await page.locator("[data-testid=client-help-messages] .whitespace-pre-wrap").first().textContent()) ?? "").replace(/\s+/g, " ").trim();
}

await phone.tap("[data-testid=client-help-button]");
await phone.waitForSelector("[data-testid=client-help-panel]");
{
  // C17: with no reply box on this page (it can't open the video here) there's no button to promise, so it says to contact them.
  const box = (await phone.locator("[data-testid=reply-composer]").count()) > 0;
  const g = await greeting(phone, box ? "button to reply" : "contact");
  ok("greeting: matches what this page can offer", (box ? g.includes(`I'll give you a button to reply to ${nameA}.`) : g.includes(`For those, please contact ${nameA} directly.`)) && !/how to reach/.test(g), JSON.stringify({ box, g }));
}
ok("Help opens with the cursor in the question box", await phone.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Your question"));
ok("Help button says it's open", (await phone.getAttribute("[data-testid=client-help-button]", "aria-expanded")) === "true");
const panelBox = await phone.locator("[data-testid=client-help-panel]").boundingBox();
const mainBox = await phone.locator("main").boundingBox();
ok("panel sits above the page, pushing it down (covers nothing)", !!panelBox && !!mainBox && panelBox.y + panelBox.height <= mainBox.y + 1, JSON.stringify({ panelBox, mainBox }));
ok("open panel fits 320px", await fits(phone));
// Decision 7: the panel says questions are kept 90 days without who asked and may be read, not that nobody reads it.
const panelText = (await phone.textContent("[data-testid=client-help-panel]")).replace(/\s+/g, " ");
ok("panel: questions kept 90 days, without who asked, and may be read to improve this help (decision 7)", panelText.includes("Questions are kept for 90 days, without who asked, and may be read to improve this help, so don't type anything private.") && !/nobody reads/i.test(panelText), panelText);

const answer = await ask(phone, "How do I reply to this video?");
ok("an answer comes back", answer.includes("reply box"), answer);
const call = requests.at(-1).body;
const sent = JSON.stringify(call);
const system = [].concat(call.system).map((b) => b.text).join("");
ok("the client guide no longer says nobody from SureFrame reads this chat (decision 7)", system.includes("may be read by SureFrame to improve this help") && !system.includes("Nobody from SureFrame reads"));
ok("uses the client guide, cached, not the business guide", system.includes("<client_help_guide>") && !system.includes("<help_guide>") && [].concat(call.system)[0]?.cache_control?.type === "ephemeral" && !system.includes("Plans and prices"));
ok("the AI is told the business and the page", call.messages.some((m) => m.role === "system" && m.content.includes(nameA) && m.content.includes("video page")));
ok("the AI gets no title, no address and no client name", !sent.includes(TITLE) && !sent.includes("replies-a") && !sent.includes(clientA.email) && !sent.includes("Client A"));
ok("only the cant_help tool, no hand-over", call.tools.length === 1 && call.tools[0].name === "cant_help");

const fallback = await ask(phone, "Can you sort out my tax?");
ok("can't help: names the business and its reply-to address", fallback === `I can't help with that one. Please contact ${nameA} at replies-a${stamp}@example.com.`, fallback);
ok("never offers SureFrame support", !fallback.includes("support@") && !fallback.toLowerCase().includes("sureframe"));
await ask(phone, "How do I reply by voice?");
ok("the address isn't sent back to the AI with the history", !JSON.stringify(requests.at(-1).body).includes("replies-a"));
ok("no 'Talk to a person' in the client chat", (await phone.locator("[data-testid=client-help-panel] >> text=Talk to a person").count()) === 0);
await phone.screenshot({ path: `${shots}/client-help-320.png`, fullPage: true });

// The assigned staff member's own reply-to comes first, as on their emails.
const staff = await agreed(`clienthelp-s${stamp}@example.com`, { name: "Team member 3" });
await prisma.membership.create({ data: { userId: staff.id, workspaceId: wsA.id, role: "MEMBER", myReminderReplyTo: `staff-a${stamp}@example.com` } });
await prisma.client.update({ where: { id: clientA.id }, data: { assignedToId: staff.id } });
const viaStaff = await ask(phone, "Can I book an appointment?");
ok("assigned staff member's reply-to used", viaStaff === `I can't help with that one. Please contact ${nameA} at staff-a${stamp}@example.com.`, viaStaff);
await prisma.client.update({ where: { id: clientA.id }, data: { assignedToId: null } });

const broke = await ask(phone, "explode please");
ok("AI failure: still names the business", broke === `Sorry, I hit a problem answering that. Please contact ${nameA} at replies-a${stamp}@example.com.`, broke);

await phone.keyboard.press("Escape");
ok("Escape closes the panel", (await phone.locator("[data-testid=client-help-panel]").count()) === 0);
ok("focus goes back to Help", await phone.evaluate(() => document.activeElement?.getAttribute("data-testid") === "client-help-button"));
await phone.tap("[data-testid=client-help-button]");
ok("the conversation is still there in this tab", (await phone.locator("[data-testid=client-help-messages] >> text=Can you sort out my tax?").count()) === 1);
await phone.tap("button[aria-label='Close help']");

// ---------- Nothing reached SureFrame support ----------
ok("no support tickets", (await prisma.supportTicket.count()) === ticketsBefore);
ok("nothing emailed to the support inbox (or anyone)", outbox().slice(mailsBefore).length === 0, JSON.stringify(outbox().slice(mailsBefore).map((m) => m.subject)));

// ---------- What's recorded: the question and the business, nothing else ----------
const rows = await prisma.clientQuestion.findMany({ where: { workspaceId: wsA.id }, orderBy: { createdAt: "asc" } });
ok("each question recorded", rows.length === 5, String(rows.length));
ok("outcomes recorded", rows.map((r) => r.outcome).join() === "ANSWERED,CANT_HELP,ANSWERED,CANT_HELP,FAILED", rows.map((r) => r.outcome).join());
ok("only the typed text and the page", rows[1].question === "Can you sort out my tax?" && rows[1].page === "video" && !("clientId" in rows[1]));

// ---------- The inbox, with two businesses on this device ----------
await phone.goto(`${BASE}/c/${clientB.token}`);
await phone.waitForURL("**/inbox**");
await phone.tap("[data-testid=client-help-button]");
await phone.waitForSelector("[data-testid=client-help-panel] select");
ok("inbox: choose which business it's about", (await phone.locator("[data-testid=client-help-panel] option").allTextContents()).sort().join("|") === [nameA, nameB].sort().join("|"));
ok("inbox with Help open fits 320px", await fits(phone));
await phone.selectOption("[data-testid=client-help-panel] select", { label: nameB });
const noReplyTo = await ask(phone, "Can you sort out my tax?");
ok("no reply-to set: contact the business directly", noReplyTo === `I can't help with that one. Please contact ${nameB} directly.`, noReplyTo);
ok("inbox question recorded against that business", (await prisma.clientQuestion.count({ where: { workspaceId: wsB.id, page: "inbox" } })) === 1);
await phone.screenshot({ path: `${shots}/client-help-inbox-320.png`, fullPage: true });
// The emails page link, from the inbox.
const emailsLink = await phone.getAttribute("[data-testid=inbox-emails] a", "href");

// ---------- The emails page, opened from an email on a device without the link ----------
const laptop = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await laptop.goto(new URL(emailsLink, BASE).toString());
await laptop.waitForSelector("[data-testid=client-help-button]");
await laptop.click("[data-testid=client-help-button]");
ok("emails page: answers from the email's signed link", (await ask(laptop, "How do I turn emails back on?")).includes("reply box"));
ok("emails page told to the AI", requests.at(-1).body.messages.some((m) => m.role === "system" && m.content.includes("emails off or on")));
await laptop.screenshot({ path: `${shots}/client-help-desktop.png` });

// ---------- A link that's stopped working still gets help, explained only as the page does ----------
await prisma.client.update({ where: { id: clientA.id }, data: { removedAt: new Date(), purgeAt: new Date(Date.now() + 30 * 86_400_000) } });
await phone.goto(`${BASE}/v/${video.id}`);
await phone.waitForSelector("[data-testid=video-removed]");
await phone.tap("[data-testid=client-help-button]");
await ask(phone, "Why can't I open this?");
ok("can't-open page: Help works, told what the page says", requests.at(-1).body.messages.some((m) => m.role === "system" && m.content.includes("Your access has ended")));
await prisma.client.update({ where: { id: clientA.id }, data: { removedAt: null, purgeAt: null } });

// ---------- The weekly digest to the support address ----------
await prisma.clientQuestionDigest.deleteMany();
const old = await prisma.clientQuestion.create({ data: { workspaceId: wsA.id, question: "Old question", outcome: "CANT_HELP", page: "inbox", createdAt: new Date(Date.now() - 91 * 86_400_000) } });
const before = outbox().length;
let r = await cron();
ok("daily job sends the digest", typeof r.clientQuestionDigest === "object" && r.clientQuestionDigest.questions >= 8, JSON.stringify(r.clientQuestionDigest));
ok("old questions pruned after 90 days", !(await prisma.clientQuestion.findUnique({ where: { id: old.id } })) && r.clientQuestionsPruned >= 1);
const digests = outbox().slice(before).filter((m) => m.subject.startsWith("Client help chat this week"));
ok("one digest, to the support address only", digests.length === 1 && digests[0].to === SUPPORT, JSON.stringify(digests.map((m) => m.to)));
const d = digests[0]?.text ?? "";
ok("digest: unanswered questions grouped and counted, with the business", d.includes(`"Can you sort out my tax?" (${nameA}; couldn't answer)`) && d.includes(`"Can you sort out my tax?" (${nameB}; couldn't answer)`) && d.includes(`"explode please" (${nameA}; AI error)`), d);
ok("digest: most asked, counted across businesses", /2 × "Can you sort out my tax\?" \(Business [AB] \d+, Business [AB] \d+\)/.test(d), d);
ok("digest: no client names or addresses", !d.includes("Client A") && !d.includes("@example.com"));
ok("digest: says to delete it after 12 months, as the Terms and Privacy Policy promise (decision 7)", d.includes("Delete this email 12 months after it arrived"));
r = await cron();
ok("not again the same week", r.clientQuestionDigest === "not-due" && outbox().slice(before).filter((m) => m.subject.startsWith("Client help chat")).length === 1, JSON.stringify(r.clientQuestionDigest));
// A week on, the next one covers only what was asked since.
await phone.goto(`${BASE}/v/${video.id}`);
await phone.waitForSelector("[data-testid=client-help-button]");
await phone.tap("[data-testid=client-help-button]");
await ask(phone, "Who can see my appointment notes?");
// Wind the clock back a week: the digest, and the questions it already covered.
const sentAt = (await prisma.clientQuestionDigest.findFirst()).sentAt;
await prisma.$executeRaw`UPDATE "ClientQuestion" SET "createdAt" = "createdAt" - interval '8 days' WHERE "createdAt" < ${sentAt}`;
await prisma.clientQuestionDigest.updateMany({ data: { sentAt: new Date(sentAt.getTime() - 7 * 86_400_000 - 60_000) } });
r = await cron();
const next = outbox().slice(before).filter((m) => m.subject.startsWith("Client help chat this week"));
ok("a week later: the next digest, with only the new questions", next.length === 2 && r.clientQuestionDigest?.questions === 1 && next[1].text.includes("Who can see my appointment notes?") && !next[1].text.includes("sort out my tax"), JSON.stringify(r.clientQuestionDigest));

// The business help guide mentions it, and the client FAQ has a line for it.
const faq = await (await browser.newContext()).newPage();
await faq.goto(`${BASE}/faq`);
ok("client FAQ: where to get help", (await faq.locator("#client-help").count()) === 1);
await faq.goto(`${BASE}/legal/privacy`);
ok("privacy: the client help chat and its 90 days", (await faq.textContent("#for-clients + p + ul")).includes("for 90 days"));

// ---------- On a video page that opens: limits stated, "Reply to …" after a can't-answer, and a refusal says when (C17, C18, C20) ----------
const keyC = globalThis.crypto.getRandomValues(new Uint8Array(32));
const wrapWith = async (raw, wrapping) => {
  const k = await globalThis.crypto.subtle.importKey("raw", wrapping, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return Buffer.concat([iv, new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, raw))]).toString("base64url");
};
// Sent by Team member 3, who looks after Client C: replies are to them, at the business (S52).
const clientC = await prisma.client.create({ data: { name: "Client C", token: `ch-c-${stamp}-${"z".repeat(20)}`, workspaceId: wsA.id, assignedToId: staff.id } });
const videoC = await prisma.video.create({
  data: { id: `chc${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/chc`, status: "UPLOADED", encrypted: true, teamKeyWrap: "t".repeat(60), clientKeyWrap: await wrapWith(globalThis.crypto.getRandomValues(new Uint8Array(32)), keyC), workspaceId: wsA.id, ownerId: staff.id, clientId: clientC.id, title: "For Client C" },
});
const cPhone = await (await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true })).newPage();
await cPhone.addLocatorHandler(cPhone.getByTestId("sureframe-promo"), async () => cPhone.click("text=/^Watch now$/", { timeout: 15000 }));
await cPhone.goto(`${BASE}/c/${clientC.token}?v=${videoC.id}#k=${Buffer.from(keyC).toString("base64url")}`);
await cPhone.waitForSelector("[data-testid=chat-inline]", { timeout: 20000 });
ok("sent by the team member who looks after them: 'Reply to Team member 3 at Business A' (S52)", (await cPhone.textContent("[data-testid=chat-open]")) === `Reply to Team member 3 at ${nameA}`);
ok("…and the conversation is with them, at the business", (await cPhone.textContent("[data-testid=conversation-title]")) === `Conversation with Team member 3 at ${nameA}`);
await cPhone.tap("[data-testid=client-help-button]");
await cPhone.waitForSelector("[data-testid=client-help-panel]");
ok("the panel states the limits (Free business: a day)", (await cPhone.textContent("[data-testid=client-help-limits]")) === "You can ask up to 5 questions a day.");
// C17: the greeting promises only what it does: a button to reply to the business.
const greet = await greeting(cPhone, "button to reply");
ok("greeting: says what it can do (a button to reply), not that it'll say how to reach them", greet.includes(`For those, I'll give you a button to reply to ${nameA}.`) && !/how to reach/.test(greet), greet);
const cant = await ask(cPhone, "Can you sort out my tax?");
ok("can't help: still names the business", cant.startsWith("I can't help with that one."), cant);
const replyBtn = cPhone.locator("[data-testid=client-help-messages] [data-testid=client-help-reply]");
ok("can't help: ends with a 'Reply to …' button", (await replyBtn.count()) === 1 && (await replyBtn.textContent()) === `Reply to Team member 3 at ${nameA}`, await replyBtn.textContent().catch(() => ""));
ok("answered questions get no button", (await ask(cPhone, "How do I reply to this video?")).includes("reply box") && (await replyBtn.count()) === 1);
await replyBtn.tap();
ok("Reply to …: closes help and opens the reply box", !!(await cPhone.waitForSelector("[data-testid=conversation][data-sheet]", { timeout: 5000 }).catch(() => null)) && (await cPhone.locator("[data-testid=client-help-panel]").count()) === 0);
await cPhone.tap("[data-testid=chat-close]");
// A refusal (the limits are off in test runs, so the answer is stood in for): when to ask again, Ask off, and the button.
await cPhone.route("**/api/client-help", (r) =>
  r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "You've reached the limit for the help chat.", limited: true, retryAt: new Date(Date.now() + 7 * 60_000).toISOString(), contact: `Please contact ${nameA} directly.` }) }),
);
await cPhone.tap("[data-testid=client-help-button]");
await cPhone.fill("textarea[aria-label='Your question']", "One more question");
await cPhone.keyboard.press("Enter");
const refusedText = (await cPhone.textContent("[data-testid=client-help-error]", { timeout: 10000 }).catch(() => "")) ?? "";
ok("limit reached: says when to ask again", /^You've reached the limit for the help chat\. You can ask again in [78] minutes\. Please contact /.test(refusedText), refusedText);
ok("limit reached: Ask is off while refused", await cPhone.isDisabled("[data-testid=client-help-ask]"));
ok("limit reached: the Reply button is there too", (await cPhone.locator("[data-testid=client-help-panel] form [data-testid=client-help-reply]").count()) === 1);
ok("help panel with the limit fits 320px", await fits(cPhone));
await cPhone.screenshot({ path: `${shots}/client-help-limit-320.png`, fullPage: true });
await cPhone.context().close();
await prisma.video.delete({ where: { id: videoC.id } });
await prisma.client.delete({ where: { id: clientC.id } });

await prisma.clientQuestion.deleteMany({ where: { workspaceId: { in: [wsA.id, wsB.id] } } });
await browser.close();
fake.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
