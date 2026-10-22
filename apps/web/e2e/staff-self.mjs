// Staff look after their own clients: a member sets their own reminder
// defaults, message and reply-to (Settings > Reminders) and whether they're
// emailed about replies (Settings > Account); manages to-dos and notes for
// their client in the app; their client's reminder and new-video emails use
// their settings (other staff's clients keep the business's); they can't
// touch a client they can't see; and the owner still sees all of it on the
// Team overview, including that the member turned reply emails off.
//
// Run against a dev server with the fake Stripe (same env as billing.mjs),
// no RESEND_API_KEY (mail goes to .data/outbox), and CRON_SECRET set:
//   STRIPE_SECRET_KEY=sk_test_fake STRIPE_API_BASE=http://localhost:12111 STRIPE_WEBHOOK_SECRET=whsec_test CRON_SECRET=test-cron-secret npm run dev
//   CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome BASE=http://localhost:3000 node e2e/staff-self.mjs [screenshot dir]
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { start, state, createSubscription } from "./fake-stripe.mjs";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret";
const TZ = "Australia/Sydney";
const shots = process.argv[2] ?? "/tmp";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
const server = await start();
const sig = new Stripe("sk_test_fake");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const newPage = async () => (await browser.newContext({ timezoneId: TZ, viewport: { width: 1360, height: 1000 } })).newPage();
const stamp = Date.now();
const wrap = (c) => c.repeat(44); // stands in for a wrapped key where nothing is decrypted
const outbox = () => (existsSync(".data/outbox") ? readdirSync(".data/outbox").sort().map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8"))) : []);
const status = async (p) => (await p).status();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 8000) => {
  for (let t = 0; t < ms; t += 200) {
    const v = await fn();
    if (v) return v;
    await sleep(200);
  }
  return fn();
};
const cron = () => fetch(`${BASE}/api/cron/reminders`, { headers: { Authorization: `Bearer ${CRON}` } }).then((r) => r.json());

// ---- An Agency owner with two staff members ----
const owner = await newPage();
const ownerEmail = `ss-owner${stamp}@example.com`;
await owner.goto(`${BASE}/login?next=/record`);
await agreed(ownerEmail);
await owner.fill('input[name="email"]', ownerEmail);
await owner.click("text=Continue");
await owner.waitForURL((u) => u.pathname === "/record");
await owner.click("text=I've saved it");
await owner.request.post(BASE + "/api/billing/checkout", { data: { plan: "AGENCY" } });
const session = state.sessions.at(-1).params;
const workspaceId = session.subscription_data.metadata.workspaceId;
const sub = createSubscription(session.customer, workspaceId, "sureframe_agency_monthly");
const payload = JSON.stringify({ id: `evt_${stamp}`, object: "event", type: "customer.subscription.created", data: { object: sub } });
await owner.request.post(BASE + "/api/webhooks/stripe", { headers: { "stripe-signature": sig.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" }), "content-type": "application/json" }, data: payload });
const business = `Summit ${stamp}`;
ok("owner sets the business's reminder settings", (await owner.request.patch(BASE + "/api/workspace/settings", {
  data: { name: business, timezone: TZ, reminderDefaults: [{ amount: 1, unit: "day" }], remindClientDefault: true, remindTeamDefault: false, reminderMessage: "Business note", reminderReplyTo: "desk@summit.test" },
})).ok());
ok("owner hears about every staff member's client replies", (await owner.request.patch(BASE + "/api/team/prefs", { data: { replyNotify: "ALL" } })).ok());
const fp = (await prisma.workspace.findUnique({ where: { id: workspaceId } })).keyFingerprint;

async function join(email) {
  await owner.goto(BASE + "/settings/team");
  await owner.click("text=Create invite link");
  const link = await (await owner.waitForSelector("[data-testid=invite-link]")).textContent();
  const page = await newPage();
  await page.goto(link);
  await page.click("text=Sign in to join");
  await agreed(email);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname.startsWith("/join/"));
  await page.click("text=Join the team");
  await page.waitForURL((u) => u.pathname === "/library");
  return { page, user: await prisma.user.findUnique({ where: { email } }) };
}
const { page: amy, user: amyUser } = await join(`ss-amy${stamp}@example.com`);
const { page: bob, user: bobUser } = await join(`ss-bob${stamp}@example.com`);
const amyName = `ss-amy${stamp}`;
const amyMembership = () => prisma.membership.findFirst({ where: { userId: amyUser.id, workspaceId } });

// Ben is Bob's client (added by the owner, stand-in key).
const benRes = await owner.request.post(BASE + "/api/clients", { data: { name: "Ben", email: `ben${stamp}@example.com`, teamKeyWrap: wrap("k"), keyFingerprint: fp } });
const ben = (await benRes.json()).client;
await owner.request.patch(`${BASE}/api/clients/${ben.id}`, { data: { assignedToId: bobUser.id } });

// ---- Amy's own reminder settings ----
await amy.goto(BASE + "/settings/reminders");
await amy.waitForSelector("[data-testid=business-settings]");
const page1 = await amy.textContent("main");
ok("staff get their own Reminders settings, not 'ask an owner'", !page1.includes("Ask an owner") && page1.includes("Default reminders for your new to-dos"));
ok("business name and time zone are shown read-only", (await amy.textContent("[data-testid=business-settings]")).includes(business) && page1.includes("Australia/Sydney") && !(await amy.isVisible('input[aria-label="Business name"]')));
ok("starts on the business's defaults", (await amy.textContent("[data-testid=defaults-source]")).includes("business's defaults") && !(await amy.isChecked("text=Email me too")));
await amy.click("role=group[name='Reminders'] >> text=1 week before");
await amy.check("text=Email me too");
await amy.fill('input[aria-label="Your reply-to email"]', "not-an-email");
ok("a bad reply-to is refused, in the form and by the server", !(await amy.$eval('input[aria-label="Your reply-to email"]', (e) => e.checkValidity())) &&
  (await status(amy.request.patch(BASE + "/api/account/settings", { data: { reminderReplyTo: "not-an-email" } }))) === 400);
await amy.fill('input[aria-label="Your reply-to email"]', `amy-desk${stamp}@summit.test`);
await amy.fill('textarea[aria-label="Your personal message"]', "Amy here: text me to move it.");
ok("preview shows her message", (await amy.textContent("[data-testid=preview-body]")).includes("Amy here: text me to move it."));
await amy.click("text=Save changes");
await amy.waitForSelector("role=status >> text=/^Saved$/");
let am = await amyMembership();
ok("her settings are saved on her membership", am.myRemindTeamDefault === true && am.myRemindClientDefault === true && am.myReminderDefaults?.length === 2 &&
  am.myReminderReplyTo === `amy-desk${stamp}@summit.test` && am.myReminderMessage === "Amy here: text me to move it.", JSON.stringify(am));
const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
ok("the business's settings are untouched", ws.reminderMessage === "Business note" && ws.reminderReplyTo === "desk@summit.test" && ws.remindTeamDefault === false);
await amy.screenshot({ path: `${shots}/staff-reminder-settings.png`, fullPage: true });
ok("staff still can't change the business's settings", (await status(amy.request.patch(BASE + "/api/workspace/settings", { data: { reminderMessage: "x" } }))) === 403);
ok("owners use the business settings, not personal ones", (await status(owner.request.patch(BASE + "/api/account/settings", { data: { reminderMessage: "x" } }))) === 403);

// ---- Amy's own email preference ----
await amy.goto(BASE + "/settings/account");
const replyBox = '[role=switch][aria-labelledby="reply-emails-label"]';
await amy.waitForSelector(replyBox);
ok("reply emails are a switch, named by its words (S56)", (await amy.getByRole("switch", { name: "Email me when my clients reply" }).count()) === 1);
ok("reply emails start on", (await amy.getAttribute(replyBox, "aria-checked")) === "true" && (await amy.textContent("[data-testid=reply-emails-state]")) === "On");
await amy.click(replyBox);
await amy.waitForSelector(`${replyBox}[aria-checked=false]`);
await waitFor(async () => (await amyMembership()).replyNotify === "OFF");
ok("Amy turns her reply emails off", (await amyMembership()).replyNotify === "OFF");

// ---- Amy adds her own client and manages their to-dos in the app ----
await amy.goto(BASE + "/clients");
await amy.waitForSelector('input[aria-label="Client name"]');
await amy.fill('input[aria-label="Client name"]', "Cal");
await amy.fill('input[aria-label="Client email"]', `cal-old${stamp}@example.com`);
await amy.click("button:has-text('Add client')");
await amy.click("a[href^='/clients/']:has-text('Cal')");
await amy.waitForURL("**/clients/**");
const calId = amy.url().split("/clients/")[1];
ok("Cal is assigned to Amy", (await prisma.client.findUnique({ where: { id: calId } })).assignedToId === amyUser.id);
// She can fix her client's email for reminders.
await amy.click("button:has-text('Change')");
await amy.fill('input[aria-label="Client email"] >> nth=0', `cal${stamp}@example.com`);
await amy.click("form >> button:has-text('Save')");
await waitFor(async () => (await prisma.client.findUnique({ where: { id: calId } })).email === `cal${stamp}@example.com`);
ok("Amy changes Cal's email on his page", (await prisma.client.findUnique({ where: { id: calId } })).email === `cal${stamp}@example.com`);

const d = new Date(Date.now() + 10 * 86_400_000);
const pad = (n) => String(n).padStart(2, "0");
const dueLocal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
await amy.waitForSelector('textarea[aria-label="New to-do"]', { timeout: 15000 });
await amy.fill('textarea[aria-label="New to-do"]', "Send your food diary");
await amy.check("text=Share with Cal");
await amy.fill('input[aria-label="Due date"]', dueLocal);
const pressed = (await amy.$$eval("role=group[name='Reminders'] >> button[aria-pressed=true]", (b) => b.map((x) => x.textContent))).sort();
ok("her own default reminders are pre-selected", pressed.join() === "1 day before,1 week before", pressed.join());
ok("and her 'Email Cal' and 'Email me' defaults", (await amy.isChecked("text=Email Cal")) && (await amy.isChecked("text=Email me")));
await amy.click("form >> button:has-text('Add')");
await amy.waitForSelector("li:has-text('Send your food diary')");
const item = await waitFor(() => prisma.item.findFirst({ where: { clientId: calId, kind: "TASK" } }));
ok("to-do saved, shared, reminding Cal and Amy", item?.shared && item.remindClient && item.remindTeam && item.authorName.startsWith("ss-amy"));
ok("its reminders are scheduled", (await prisma.reminder.count({ where: { itemId: item.id, sentAt: null } })) === 4);

// Edit its reminders: drop "1 week before".
await amy.hover("li:has-text('Send your food diary')");
await amy.click(`button[aria-label='Edit "Send your food diary"']`);
// The edit form's own reminders and Save (the new to-do box above has reminders too, and the page has other forms).
const editForm = "form:has(textarea[aria-label='Edit text'])";
await amy.click(`${editForm} >> role=group[name='Reminders'] >> text=1 week before`);
await amy.click(`${editForm} >> button:has-text('Save')`);
await amy.waitForSelector(editForm, { state: "detached" }).catch(async (e) => { await amy.screenshot({ path: `${shots}/staff-edit-fail.png`, fullPage: true }); throw e; });
await amy.waitForSelector("text=/1 day before · Cal and you/");
ok("Amy changes the to-do's reminders", (await prisma.reminder.count({ where: { itemId: item.id, sentAt: null } })) === 2);

// A note, made private then deleted; and a to-do ticked off and back.
await amy.click("role=tab[name='Note']");
await amy.fill('textarea[aria-label="New note"]', "Prefers mornings");
await amy.click("form >> button:has-text('Add')");
await amy.waitForSelector("li:has-text('Prefers mornings')");
await amy.hover("li:has-text('Prefers mornings')");
await amy.click("li:has-text('Prefers mornings') >> button[aria-label=Delete]");
await amy.click("[data-testid=delete-confirm-yes]");
await amy.waitForSelector("li:has-text('Prefers mornings')", { state: "detached" });
ok("Amy adds and deletes a note", (await prisma.item.count({ where: { clientId: calId, kind: "NOTE" } })) === 0);
await amy.click("role=tab[name='To-do']");
await amy.fill('textarea[aria-label="New to-do"]', "Book a check-in");
await amy.click("form >> button:has-text('Add')");
await amy.waitForSelector(`input[aria-label='Mark "Book a check-in" done']`);
await amy.click(`input[aria-label='Mark "Book a check-in" done']`);
await waitFor(async () => (await prisma.item.findFirst({ where: { clientId: calId, kind: "TASK", dueAt: null } }))?.done);
ok("Amy ticks a to-do off", (await prisma.item.findFirst({ where: { clientId: calId, kind: "TASK", dueAt: null } }))?.done === true);
await amy.screenshot({ path: `${shots}/staff-planner.png`, fullPage: true });

// ---- Reminder emails use the assigned staff member's settings ----
// Bob set nothing, so Ben's reminders keep the business's message and reply-to.
const benTask = await owner.request.post(BASE + "/api/items", {
  data: { kind: "TASK", body: wrap("n"), clientId: ben.id, shared: true, dueAt: d.toISOString(), reminders: [{ amount: 1, unit: "day" }], remindClient: true, keyFingerprint: fp },
});
const benItem = (await benTask.json()).item;
await prisma.reminder.updateMany({ where: { itemId: { in: [item.id, benItem.id] }, sentAt: null }, data: { sendAt: new Date(Date.now() - 60_000) } });
const mark = outbox().length;
const run = await cron();
ok("reminder job ran", run.sent >= 3, JSON.stringify(run));
const fresh = outbox().slice(mark);
const calMail = fresh.find((m) => m.to === `cal${stamp}@example.com`);
ok("Cal's reminder replies to Amy's address", calMail?.replyTo === `amy-desk${stamp}@summit.test`, JSON.stringify(calMail?.replyTo));
ok("and carries Amy's message, from the business", calMail?.text.includes("Amy here: text me to move it.") && !calMail.text.includes("Business note") && calMail.from.startsWith(`${business} via SureFrame <`));
ok("never the to-do text", !JSON.stringify(calMail ?? {}).includes("food diary"));
const amyMail = fresh.find((m) => m.to === amyUser.email && m.subject.startsWith("Cal:"));
ok("Amy gets her own reminder for Cal's to-do", !!amyMail);
const benMail = fresh.find((m) => m.to === `ben${stamp}@example.com`);
ok("Ben's reminder (Bob set nothing) uses the business's message and reply-to", benMail?.replyTo === "desk@summit.test" && benMail.text.includes("Business note") && !benMail.text.includes("Amy here"));

// New-video email to Cal also replies to Amy.
async function record(page, title, clientId, notify = false) {
  const res = await page.request.post(BASE + "/api/videos", { data: { mimeType: "video/webm", title, teamKeyWrap: wrap("t"), keyFingerprint: fp } });
  const { video } = await res.json();
  await page.request.put(`${BASE}/api/videos/${video.id}/parts/1`, { data: Buffer.from("not really a video") });
  await page.request.post(`${BASE}/api/videos/${video.id}/complete`, { data: { partCount: 1, durationMs: 1000 } });
  if (clientId) await page.request.patch(`${BASE}/api/videos/${video.id}`, { data: { clientId, clientKeyWrap: wrap("c"), keyFingerprint: fp, notify } });
  return video.id;
}
let m2 = outbox().length;
// Videos are only emailed to clients who have opened their personal link once.
await prisma.client.update({ where: { id: calId }, data: { linkOpenedAt: new Date() } });
const vCal = await record(amy, "Amy to Cal", calId, true);
const videoMail = await waitFor(() => outbox().slice(m2).find((m) => m.to === `cal${stamp}@example.com`));
ok("new-video email to Cal replies to Amy's address", videoMail?.replyTo === `amy-desk${stamp}@summit.test`, JSON.stringify(videoMail?.replyTo));

// ---- Amy's reply emails off: she isn't emailed, the owner still is ----
const cal = await prisma.client.findUnique({ where: { id: calId } });
const calPage = await newPage();
await calPage.goto(`${BASE}/c/${cal.token}`);
m2 = outbox().length;
ok("Cal replies", (await status(calPage.request.post(`${BASE}/api/videos/${vCal}/replies`, { data: { kind: "TEXT", body: "sealed", encrypted: true } }))) === 201);
const ownerReply = await waitFor(() => outbox().slice(m2).find((m) => m.to === ownerEmail && m.subject.includes("Cal replied")));
await sleep(1000);
ok("the owner (All staff) is emailed about Cal's reply", !!ownerReply);
ok("Amy, with reply emails off, is not", !outbox().slice(m2).some((m) => m.to === amyUser.email && m.subject.includes("replied")));

// ---- Amy is blocked from Bob's client ----
ok("Amy can't list Ben's to-dos", (await status(amy.request.get(`${BASE}/api/items?clientId=${ben.id}`))) === 404);
ok("Amy can't add a to-do for Ben", (await status(amy.request.post(BASE + "/api/items", { data: { kind: "TASK", body: wrap("n"), clientId: ben.id, keyFingerprint: fp } }))) === 404);
ok("Amy can't change Ben's to-do or its reminders", (await status(amy.request.patch(`${BASE}/api/items/${benItem.id}`, { data: { remindClient: false, keyFingerprint: fp } }))) === 404);
ok("Amy can't delete Ben's to-do", (await status(amy.request.delete(`${BASE}/api/items/${benItem.id}`))) === 404);
ok("Amy can't change Ben's email", (await status(amy.request.patch(`${BASE}/api/clients/${ben.id}`, { data: { email: "x@example.com" } }))) === 404);
ok("Amy still can't remove or reassign clients, even her own", (await status(amy.request.delete(`${BASE}/api/clients/${calId}`))) === 403 &&
  (await status(amy.request.patch(`${BASE}/api/clients/${calId}`, { data: { assignedToId: bobUser.id } }))) === 403);
await amy.goto(`${BASE}/clients/${ben.id}`);
ok("Ben's page doesn't open for Amy", !!(await amy.waitForSelector("text=Page not found", { timeout: 10000 }).catch(() => null)));
ok("Bob can't touch Amy's to-do", (await status(bob.request.delete(`${BASE}/api/items/${item.id}`))) === 404);

// ---- The owner still sees everything on the Team overview ----
await prisma.item.update({ where: { id: item.id }, data: { dueAt: new Date(Date.now() - 86_400_000) } }); // now overdue
await owner.goto(BASE + "/team");
await owner.waitForSelector("[data-testid=team-stats]");
const cellOf = async (row, col) => (await owner.textContent(`[data-testid=stats-${row}] [data-col=${col}]`))?.trim();
ok("owner sees Amy's overdue to-do", (await cellOf(amyUser.id, "overdue")) === "1" && (await owner.locator(`[data-testid=overdue] a[href='/clients/${calId}']`).count()) === 1);
ok("owner sees Cal's unanswered reply under Amy", (await cellOf(amyUser.id, "unanswered")) === "1" && (await owner.locator(`[data-testid=unanswered] a[href='/v/${vCal}']`).count()) === 1);
ok("owner sees Amy's video in her numbers", (await cellOf(amyUser.id, "sent")) === "1");
const own = await owner.textContent(`[data-testid="staff-${amyUser.email}"] [data-testid=own-settings]`);
ok("owner sees Amy's own settings, reply emails off, in plain words (S68)", own.includes("Reply emails off.") && own.includes("Their own") && own.includes(`reply-to address (amy-desk${stamp}@summit.test)`) && (own.match(/the business's/g) ?? []).length <= 1, own);
await owner.screenshot({ path: `${shots}/staff-self-overview.png`, fullPage: true });
// The owner's own team emails are with their settings (Settings > Account), and say who turned theirs off.
await owner.goto(BASE + "/settings/account#emails");
ok("and is told Amy turned reply emails off", (await owner.textContent("[data-testid=quiet-staff]")).includes(amyName));
ok("owner opens Cal's page and to-dos", (await owner.request.get(`${BASE}/api/items?clientId=${calId}`)).ok());

// ---- Turning reply emails back on; back to the business's defaults ----
await amy.goto(BASE + "/settings/account");
await amy.check(replyBox);
await waitFor(async () => (await amyMembership()).replyNotify === "MINE");
const vCal2 = await record(amy, "Amy to Cal 2", calId);
m2 = outbox().length;
await calPage.request.post(`${BASE}/api/videos/${vCal2}/replies`, { data: { kind: "TEXT", body: "sealed", encrypted: true } });
ok("with reply emails on, Amy hears about Cal's reply", !!(await waitFor(() => outbox().slice(m2).find((m) => m.to === amyUser.email && m.subject.includes("Cal replied")))));
await amy.goto(BASE + "/settings/reminders");
// A click before the page has hydrated does nothing, so click until it takes.
for (let i = 0; i < 20 && !(await amy.textContent("[data-testid=defaults-source]")).includes("Using your business"); i++) {
  await amy.click("text=Use the business's defaults").catch(() => {});
  await amy.waitForTimeout(250);
}
await amy.click("text=Save changes");
await amy.waitForSelector("role=status >> text=/^Saved$/");
am = await amyMembership();
ok("Amy goes back to the business's defaults, keeping her message", am.myReminderDefaults === null && am.myRemindTeamDefault === null && am.myReminderMessage === "Amy here: text me to move it.");

await browser.close();
server.close?.();
await prisma.$disconnect();
process.exit();
