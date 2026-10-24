// Sending, clients, the library and to-dos after the testers' round (fx-send):
// - a client counts as reached only once they open a link with their key; copying it doesn't count.
//   Until then they're marked "New" or "Not opened yet" (Clients page, client page, the Send box's picker),
//   Send by email isn't offered for them, the email API refuses, and their first video goes from the
//   business (Send from your email, Copy link) from their row under "Sent to". Said up front, when adding and sending;
// - the Send box offers a title for a video still called "Recording <date>", and "Stop sharing" sits
//   behind an in-page confirm on every row;
// - video emails: the title in the subject, the business name in the email, "Business A via SureFrame";
//   "Ask for my link again" from someone who never had it tells the business what to do;
// - Clients: single Add refuses a duplicate, a long name says the limit, a pasted list over the seats
//   adds what fits, removing a duplicate emails nobody, Restore won't bring back a duplicate, search
//   and filter, rename on the client's page;
// - Library: who each video went to, reply and unread badges, search and client filter, newest day open,
//   identical titles told apart by the seconds, the deletion date said once at the top;
// - everything fits a 320px screen.
import { chromium } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";
import { chooseClients, sentRow } from "./send.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};
const waitFor = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 250) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return fn();
};
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const outbox = () => (existsSync(".data/outbox") ? readdirSync(".data/outbox").sort().map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8"))) : []);
const mailTo = (to) => outbox().filter((m) => m.to === to);
const fits = async (page) => (await page.evaluate(() => document.documentElement.scrollWidth)) <= 320;

const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args });
const perms = { permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"] };
const ctx = await browser.newContext({ ...perms, viewport: { width: 1280, height: 900 } });
const owner = await ctx.newPage();
const clip = () => owner.evaluate(() => navigator.clipboard.readText());
const stamp = Date.now();
const email = `fxs${stamp}@example.com`;
const business = `Business A ${stamp}`;

await owner.goto(`${BASE}/login?next=/clients`);
await agreed(email);
await owner.fill('input[name="email"]', email);
await owner.click("text=Continue");
await owner.waitForURL((u) => u.pathname === "/clients");
const me = await waitFor(() => prisma.membership.findFirst({ where: { user: { email } } }));
const ws = me.workspaceId;
await prisma.workspace.update({ where: { id: ws }, data: { name: business } });
await owner.reload();
await owner.waitForSelector("text=I've saved it", { timeout: 15000 }).then((b) => b.click()).catch(() => {});

// ---- Adding clients (Free: 3 seats) ----
await owner.waitForSelector("[data-testid=first-link-rule]");
ok("adding (no clients yet): how clients get videos is explained up front", norm(await owner.textContent("[data-testid=first-link-rule]")).includes("Send their first video yourself") && norm(await owner.textContent("[data-testid=first-link-rule]")).includes("After that, just press Send"));
// The Clients page's copy of "Why does the first video come from me?" is Josiah's approved wording too (Decision 18).
ok("Clients page: the first-video why is Josiah's wording (Decision 18)", norm(await owner.textContent("[data-testid=first-link-rule] [data-testid=first-why-text]")) === "A new client's first link has to come from you, because it carries their private key, which we never see. Once they've opened it, clients set to Email get every video after that from us.");
const aEmail = `client-a-${stamp}@example.com`;
await owner.fill('input[aria-label="Client name"]', "x".repeat(81));
await owner.check("[data-testid=route-link]");
await owner.click("button:has-text('Add client')");
ok("a name that's too long says so, with the limit", (await owner.textContent("[role=alert]")).includes("Names can be up to 80 characters"));
const longApi = await owner.evaluate(async () => (await (await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "y".repeat(300), teamKeyWrap: "x".repeat(60) }) })).json()).error);
ok("the API says so too", /too long.*80 characters/.test(longApi), longApi);
await owner.fill('input[aria-label="Client name"]', "Client A");
await owner.check("[data-testid=route-email]");
await owner.fill('input[aria-label="Client email"]', aEmail);
await owner.click("button:has-text('Add client')");
await owner.waitForSelector("[data-testid=added-note]");
const added = norm(await owner.textContent("[data-testid=added-note]"));
ok("after adding: next step is recording a video for them, said plainly", added.includes("Client A will receive their videos by email. You can change this in Clients at any time.") && added.includes("Record a video for Client A") && (await owner.isVisible("[data-testid=added-record]")) && !added.includes("can't open any videos"), added);
ok("after adding: their link before any video is there, folded away, with Copy, Copy + message and Send from your email", ["Copy link + message", "Send from your email"].every((t) => added.includes(t)) && (await owner.$$eval("[data-testid=added-note] button", (bs) => bs.some((b) => b.textContent.trim() === "Copy link"))) && !(await owner.isVisible("[data-testid=added-note] [data-testid=first-link-copy]")), added);
await owner.$eval("[data-testid=added-links]", (d) => (d.open = true));
await owner.click("[data-testid=added-note] [data-testid=first-link-message]");
await owner.waitForTimeout(300);
const msg = await clip();
ok("Copy link + message: greets them, has the link and explains it, signed by the business", msg.startsWith("Hi Client A,") && /\/c\/\S+#k=/.test(msg) && msg.includes("Open it once on the phone or computer you'll watch on") && msg.includes("new videos come straight to your email") && msg.trim().endsWith(business), msg);
await owner.click("[data-testid=added-note] [data-testid=first-link-copy]");
await owner.waitForTimeout(300);
const clientA = await prisma.client.findFirst({ where: { workspaceId: ws, name: "Client A" } });
ok("Copy puts Client A's personal link on the clipboard", (await clip()).includes(`/c/${clientA.token}#k=`));
ok("new client marked as not opened yet", (await owner.textContent("li:has-text('Client A') [data-testid=needs-first-link]"))?.includes("Not opened yet"));
// R2-O18: screen readers hear what the badge means, not "Client ANot opened yet".
ok("the badge reads out its meaning", norm(await owner.$eval("li:has-text('Client A') [data-testid=needs-first-link]", (e) => [...e.querySelectorAll(".sr-only")].map((x) => x.textContent).join("|"))) === ", |: you've sent them a link, and they haven't opened it yet");
ok("no warning banner", (await owner.locator("[data-testid=waiting-banner]").count()) === 0);
ok("copying doesn't count as reaching them", !(await prisma.client.findUnique({ where: { id: clientA.id } })).linkOpenedAt);

await owner.fill('input[aria-label="Client name"]', "Client A again");
await owner.check("[data-testid=route-email]");
await owner.fill('input[aria-label="Client email"]', aEmail.toUpperCase());
ok("adding the same email: says they're on the list, Add is off", (await owner.textContent("[data-testid=duplicate-match]")).includes("Client A already uses this email") && (await owner.isDisabled("button:has-text('Add client')")));
const dupe = await owner.evaluate(async (e) => {
  const r = await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Twin", email: e, teamKeyWrap: "x".repeat(60) }) });
  return [r.status, (await r.json()).error];
}, aEmail);
ok("the API refuses a duplicate single add (409)", dupe[0] === 409 && dupe[1].includes("already on your client list"), JSON.stringify(dupe));
await owner.fill('input[aria-label="Client name"]', "");
await owner.check("[data-testid=route-email]");
await owner.fill('input[aria-label="Client email"]', "");

// Over the seats: what fits is added, the rest stay in the box with a way to get more seats.
await owner.click("[data-testid=bulk-open]");
// "Client D client-d@…" (no comma) is still read; a line with a broken email is listed and kept to fix.
await owner.fill("#bulk-list", `Client B, client-b-${stamp}@example.com\nClient C, client-c-${stamp}@example.com\nClient D client-d-${stamp}@example.com\nClient E, client-e@example`);
ok("pasted list: the unreadable line is listed as not added", norm(await owner.textContent("[data-testid=bulk-bad]")).includes("This line won't be added") && (await owner.textContent("[data-testid=bulk-bad] li")) === "Client E, client-e@example");
ok("pasted list: says only 2 seats left", (await owner.textContent("[data-testid=bulk-summary]")).includes("3 clients ready to add (only 2 seats left)"));
ok("and offers to add what fits", (await owner.textContent("[data-testid=bulk-add] >> button:has-text('Add the')")) === "Add the 2 clients that fit" && (await owner.textContent("[data-testid=bulk-over]")).includes("See plans with more seats"));
await owner.click("[data-testid=bulk-add] >> button:has-text('Add the')");
await owner.waitForSelector("[data-testid=bulk-unfit]");
ok("says which didn't fit, with a link for more seats", norm(await owner.textContent("[data-testid=bulk-unfit]")).includes("1 client didn't fit in your seats (Client D)") && (await owner.locator("[data-testid=bulk-unfit] a[href='/pricing']").count()) === 1);
ok("the one that didn't fit stays in the box", (await owner.inputValue("#bulk-list")).includes("Client D"));
ok("the line to fix stays in the box too, and the note says so", (await owner.inputValue("#bulk-list")).includes("Client E, client-e@example") && norm(await owner.textContent("[data-testid=bulk-unread]")).includes("1 line wasn't added"));
await owner.$eval("[data-testid=added-links]", (d) => (d.open = true));
ok("several added: each listed with their own buttons, and Copy all", (await owner.locator("[data-testid=added-list] [data-testid=first-link-sender]").count()) === 2 && (await owner.isVisible("[data-testid=added-copy-all]")));
await owner.click("[data-testid=added-copy-all]");
await owner.waitForTimeout(300);
const all = await clip();
ok("Copy all first links: one per line with each name", /^Client B: .*#k=.*\nClient C: .*#k=/.test(all), all);
await owner.fill("#bulk-list", `Client D, client-d-${stamp}@example.com`);
ok("plural: no seats left", (await owner.textContent("[data-testid=bulk-summary]")).includes("(no seats left)"));
await owner.click("[data-testid=bulk-add] >> button:text-is('Cancel')");
await owner.screenshot({ path: `${shots}/fx-send-clients.png`, fullPage: true });

// Search and filter.
await prisma.client.update({ where: { id: clientA.id }, data: { linkOpenedAt: new Date() } });
await prisma.workspace.update({ where: { id: ws }, data: { plan: "SOLO" } });
await owner.reload();
await owner.waitForSelector("[data-testid=clients-search]");
await owner.fill("[data-testid=clients-search]", "client-c");
ok("search by email", (await owner.locator("main ul > li a[href^='/clients/']:not([data-testid=row-more-ways])").allTextContents()).join() === "Client C");
await owner.fill("[data-testid=clients-search]", "");
await owner.selectOption("[data-testid=clients-filter]", "first");
ok("filter: not opened a video yet", (await owner.locator("main ul > li a[href^='/clients/']:not([data-testid=row-more-ways])").allTextContents()).join() === "Client B,Client C");
await owner.selectOption("[data-testid=clients-filter]", "all");
ok("Client B: copied in the list, so marked not opened yet", (await owner.textContent("li:has-text('Client B') [data-testid=needs-first-link]"))?.includes("Not opened yet"));

// A duplicate made before Add refused them: deleting it emails nobody, as the real client still uses the address.
const twin = await prisma.client.create({ data: { name: "Client A (old)", email: aEmail, token: `fxs-${stamp}-twin-${"x".repeat(20)}`, workspaceId: ws, teamKeyWrap: clientA.teamKeyWrap } });
await owner.reload();
await owner.click(`li:has-text("Client A (old)") >> button:text-is("Remove client")`);
await owner.waitForSelector("[data-testid=remove-client-sure]");
ok("deleting a duplicate: no line about emailing them", (await owner.locator("[data-testid=remove-client-email-note]").count()) === 0);
const mailsBefore = mailTo(aEmail).length;
await owner.check("[data-testid=remove-client-sure]");
await owner.click("[data-testid=remove-client-yes]");
await owner.waitForSelector("[data-testid=clients-notice]");
ok("deleting a duplicate: says so, without 'emailed'", norm(await owner.textContent("[data-testid=clients-notice]")) === "Client A (old) was deleted permanently.");
await owner.waitForTimeout(1500);
ok("the real client wasn't told their access ended", mailTo(aEmail).length === mailsBefore);
ok("the real client is still there", !!(await prisma.client.findUnique({ where: { id: clientA.id } })) && !(await prisma.client.findUnique({ where: { id: twin.id } })));

// Rename on the client's page.
await owner.goto(`${BASE}/clients/${clientA.id}`);
await owner.click("[data-testid=rename-open]");
await owner.fill("[data-testid=rename-client] input", "Client A Renamed");
await owner.click("[data-testid=rename-client] >> button:text-is('Save')");
await owner.waitForSelector("h1:text-is('Client A Renamed')", { timeout: 15000 }).catch(async () => owner.screenshot({ path: `${shots}/fx-send-rename-fail.png`, fullPage: true }));
ok("rename: saved", (await prisma.client.findUnique({ where: { id: clientA.id } })).name === "Client A Renamed");
await prisma.client.update({ where: { id: clientA.id }, data: { name: "Client A" } });
const clientB = await prisma.client.findFirst({ where: { workspaceId: ws, name: "Client B" } });
await owner.goto(`${BASE}/clients/${clientB.id}`);
ok("client page: a calm card, their first video sets them up, their link there too", norm(await owner.textContent("[data-testid=needs-first-card]")).includes("Client B hasn't opened a video yet") && norm(await owner.textContent("[data-testid=needs-first-card]")).includes("opening it sets them up") && (await owner.locator("[data-testid=needs-first-card] [data-testid=first-link-copy]").count()) === 1);
ok("client page: to-dos say who sees them", norm(await owner.textContent("main")).includes("Only your team sees these unless you share one with Client B"));
await owner.check("text=Share with Client B");
await owner.click("role=radio[name='Note']");
ok("switching to Note unticks Share", !(await owner.isChecked("text=Share with Client B")));

// ---- Sending ----
async function record() {
  await owner.goto(BASE + "/record");
  await owner.click("text=Camera only");
  await owner.click("text=Start recording");
  await owner.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
  await owner.waitForTimeout(2000);
  await owner.click("button:has-text('Stop')");
  await owner.waitForURL("**/v/**", { timeout: 30000 });
  await owner.waitForSelector("[data-testid=client-picker]", { timeout: 20000 });
  return owner.url().split("/v/")[1].split("?")[0];
}
const vid = await record();
ok("Send box: nothing but the picker until someone is chosen, and no waiting list", (await owner.locator("[data-testid^=sec-], [data-testid=send]").count()) === 0 && (await owner.locator("[data-testid=waiting-list]").count()) === 0);
ok("Send box: offers a title for a default-named video", await owner.isVisible("[data-testid=title-prompt]"));
await owner.fill("#send-title", "Week 1 plan");
await owner.click("[data-testid=title-prompt] >> button:has-text('Save title')");
await owner.waitForSelector("[data-testid=title-saved]");
ok("title saved and shown as the heading", (await prisma.video.findUnique({ where: { id: vid } })).title === "Week 1 plan" && (await owner.inputValue("textarea[aria-label='Video title']")) === "Week 1 plan");
await owner.click("[data-testid=client-picker]");
ok("picker marks first-time clients", (await owner.locator("[role=listbox] li:has-text('Client B') [data-testid=needs-first-link]").count()) === 1 && (await owner.locator("[role=listbox] li:has-text('Client A') [data-testid=needs-first-link]").count()) === 0);
ok("picker: same status as the Clients page (Client B's link was sent)", norm(await owner.textContent("[role=listbox] li:has-text('Client B') [data-testid=needs-first-link]"))?.includes("Not opened yet"));
await owner.keyboard.press("Escape");
await chooseClients(owner, "Client A", "Client B", "Client C");
// One Send button for everyone (Josiah, 23 October 2026), then each client under how they get it.
ok("several chosen: just one Send button for them all", norm(await owner.textContent("[data-testid=send]")) === "Send to 3 clients" && (await owner.locator("[data-testid^=sec-]").count()) === 0);
await owner.screenshot({ path: `${shots}/fx-send-chosen.png`, fullPage: true });
await owner.click("[data-testid=send]");
await owner.waitForSelector("[data-testid=sec-first]");
ok("Client A (Email, reached) is under Emailed to", (await owner.locator("[data-testid=sec-email] [data-testid=sent-row]").count()) === 1 && (await sentRow(owner, "Client A").getAttribute("data-section")) === "email");
ok("the two new clients are under First time, each with Send from your email (they're set to Email)", (await owner.locator("[data-testid=sec-first] [data-testid=sent-row]").count()) === 2 && (await owner.locator("[data-testid=sec-first] [data-testid=first-link-email]").count()) === 2 && (await owner.locator("[data-testid=sec-first] [data-testid=first-link-copy], [data-testid=sec-first] [data-testid=first-link-message]").count()) === 0);
ok("the why is folded away", !(await owner.isVisible("text=/carries their private key/")));
await owner.screenshot({ path: `${shots}/fx-send-todo.png`, fullPage: true });
// Their email apps are caught here, so the page stays.
await owner.evaluate(() => document.addEventListener("click", (e) => e.target?.href?.startsWith?.("mailto:") && e.preventDefault(), true));
for (const n of ["Client C", "Client B"]) {
  await sentRow(owner, n).locator("[data-testid=first-link-email]").click();
  await sentRow(owner, n).locator("[data-testid=copy-instead]").click();
  await sentRow(owner, n).locator("[data-testid=row-state]:has-text('Link copied')").waitFor();
}
const mail = await waitFor(() => mailTo(aEmail).find((m) => /sent you a video/.test(m.subject)));
ok("email subject has the title", mail?.subject.endsWith("sent you a video: Week 1 plan"), mail?.subject);
ok("email is from 'Business A via SureFrame'", mail?.from.startsWith(`${business} via SureFrame <`), mail?.from);
ok("email shows the business name and title", mail?.html.includes(business) && mail.html.includes("Week 1 plan"));
ok("email body names the video and says how long it is (C39)", /\nWeek 1 plan\n\d+ seconds?\n/.test(mail?.text ?? ""), mail?.text);
ok("email explains the device rule plainly, in one short line (S50, C38)", mail?.text.includes("It's private to you. Doesn't open? Open the personal link") && mail.text.includes("on that phone or computer first, then the button works there too.") && !mail.text.includes("The button opens it on any phone or computer") && !mail.text.includes("use the personal link they gave you first"), mail?.text);
const linkB = await clip();
ok("Client B's copy is their own conversation link, with their key", linkB.includes(`v=`) && linkB.includes("#k=") && !linkB.includes(`v=${vid}`), linkB);
ok("the emailed client's row says Emailed and Not opened yet", /Emailed\s*· Not opened yet/.test(norm(await sentRow(owner, "Client A").textContent())));
ok("no separate waiting rows", (await owner.locator("[data-testid=sent-row]").count()) === 3 && (await owner.locator("[data-testid=waiting-row]").count()) === 0);
const copyB = await prisma.video.findFirst({ where: { sourceId: vid, clientId: clientB.id } });
ok("emailing a first-timer is refused", (await owner.request.post(`${BASE}/api/videos/${copyB.id}/notify`)).status() === 409);
ok("Client B's row: Not opened yet", norm(await sentRow(owner, "Client B").textContent()).includes("Not opened yet"));
ok("every row has Stop sharing", (await owner.locator("[data-testid=stop-sharing]").count()) === 3);
await sentRow(owner, "Client C").locator("[data-testid=stop-sharing]").click();
ok("stop sharing asks in the page", norm(await owner.textContent("[data-testid=stop-sharing-confirm]")).includes("Stop sharing this video with Client C?"));
await owner.click("[data-testid=stop-sharing-confirm] >> button:has-text('Stop sharing with Client C')");
ok("stop sharing: Client C's copy is gone", !!(await waitFor(async () => !(await prisma.video.findFirst({ where: { sourceId: vid, clientId: (await prisma.client.findFirst({ where: { workspaceId: ws, name: "Client C" } })).id } })))));
await owner.screenshot({ path: `${shots}/fx-send-sent.png`, fullPage: true });

// Client B opens the email link on a device without their key, and asks for it: the business is told what to do.
const bPage = await browser.newPage();
await bPage.goto(`${BASE}/c/${clientB.token}?v=${copyB.id}`);
await bPage.waitForSelector("[data-testid=lost-key] button", { timeout: 20000 }).catch(() => {});
const asked = await bPage.evaluate(async (id) => (await fetch(`/api/clients/${id}/lost-key`, { method: "POST" })).json(), clientB.id);
const ask = await waitFor(() => mailTo(email).find((m) => m.subject.includes("Client B")));
ok("never-reached client: owner isn't told they need it 'again'", asked.asked && ask?.subject === "Client B is waiting for their personal link" && !ask.subject.includes("again"), ask?.subject);
ok("and is told what to do", ask?.text.includes("send Client B a video yourself from its Send box with Send from your email or Copy link"));

// ---- Library ----
await prisma.reply.create({ data: { kind: "TEXT", body: "sealed", encrypted: true, authorName: "Client A", videoId: vid } });
await prisma.reply.create({ data: { kind: "TEXT", body: "sealed", encrypted: true, authorName: "Client B", videoId: copyB.id } });
await owner.goto(BASE + "/library");
const card = owner.locator(`a[href="/v/${vid}"]`);
ok("library: newest day open", !!(await card.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false)));
ok("library: who it went to", norm(await card.locator("[data-testid=video-recipients]").textContent()) === "To Client A, Client B");
ok("library: replies and unread", (await card.locator("[data-testid=reply-count]").textContent()) === "2 replies" && (await card.locator("[data-testid=unread-count]").textContent()) === "2 new");
ok("library: the day says what's new", (await owner.textContent("[data-testid=day-folder] summary [data-testid=unread-count]")) === "2 new");
ok("library: the day's row says when its recordings are deleted", /deletes from our servers \w{3} \d+/.test(await owner.textContent("[data-testid=day-folder] >> nth=0 >> [data-testid=day-deletes]")));
// Replies waiting show on the Clients page and on the client's own page, not only on library cards.
await owner.goto(BASE + "/clients");
const bRow = owner.locator("main li", { has: owner.locator(`a[href="/clients/${clientB.id}"]`) });
ok("clients page: reply badges per client", !!(await waitFor(async () => (await bRow.locator("[data-testid=unread-count]").textContent().catch(() => "")) === "1 new")) && (await bRow.locator("[data-testid=reply-count]").textContent()) === "1 reply");
await owner.goto(`${BASE}/clients/${clientB.id}`);
ok("client page: new replies by the heading and on the video's row", !!(await waitFor(async () => (await owner.textContent("[data-testid=client-new-replies]").catch(() => "")).includes("1 new"))) && (await owner.locator("main section li [data-testid=reply-count]").count()) === 1);
// A to-do that's due: the menu's To-dos says so, and the library names the client.
await prisma.item.create({ data: { kind: "TASK", body: "sealed-".repeat(5), authorName: "Owner", workspaceId: ws, clientId: clientB.id, dueAt: new Date(Date.now() - 3600_000) } });
await owner.goto(BASE + "/library");
ok("menu: To-dos/Reminders, with how many are due", (await owner.textContent("header nav a[href='/todos']")).includes("To-dos/Reminders (1 due)"));
ok("library: no to-do list (it has its own page)", (await owner.locator("[data-testid=due-todos]").count()) === 0);
await owner.click("header nav a[href='/todos']");
await owner.waitForURL("**/todos");
ok("To-dos/Reminders: the To-dos tab says how many are due", (await owner.textContent("[data-testid=tab-todos]")).includes("(1 due)"));
ok("to-dos page: the due list names the client", norm(await owner.textContent("[data-testid=due-todos]")).includes("1 to-do is overdue or due within a day") && (await owner.locator(`[data-testid=due-todos] a[href="/clients/${clientB.id}"]`).count()) === 1);
// Opening Client A's conversation counts their reply as seen on this device; Client B's copy still has one new. Sent to
// two clients, the box beside the video lists both conversations first (Josiah, 23 October 2026).
await owner.goto(`${BASE}/v/${vid}`);
await owner.locator("[data-testid=conv-item]").filter({ has: owner.locator(`[data-testid=conv-name]:text-is("Client A")`) }).click({ timeout: 20000 });
await owner.waitForSelector("[data-testid=conversation] [data-testid=conv-back]", { timeout: 15000 });
await owner.waitForTimeout(1000);
await owner.goto(BASE + "/library");
await card.waitFor({ state: "visible", timeout: 15000 });
ok("library: a conversation opened here isn't new any more", !!(await waitFor(async () => (await card.locator("[data-testid=unread-count]").textContent().catch(() => "")) === "1 new")));
ok("library: deletion date said once at the top, not on each card", (await owner.isVisible("[data-testid=deletion-note]")) && (await card.locator("[data-testid=storage-status]").count()) === 0);
await owner.goto(BASE + "/todos");
ok("To-dos/Reminders: to-dos labelled the same way as elsewhere", !!(await owner.waitForSelector("h2:text-is('To-dos & notes')", { timeout: 15000 }).catch(() => null)));
const other = await record();
await owner.goto(BASE + "/library");
await owner.waitForSelector(`a[href="/v/${other}"]`);
const times = await owner.locator("[data-testid=video-time]").allTextContents();
const defaultTitled = (await prisma.video.findUnique({ where: { id: other } })).title;
ok("library: a recording not sent yet says so", norm(await owner.locator(`a[href="/v/${other}"] [data-testid=video-recipients]`).textContent()) === "Not sent yet");
ok("library: times shown", times.every((t) => /\d{1,2}:\d{2}/.test(t)), JSON.stringify(times));
ok("default title recognised", /^Recording /.test(defaultTitled));
await owner.fill("[data-testid=library-search]", "client b");
// Searches as you type, no button press needed.
await owner.waitForSelector("[data-testid=search-summary]");
ok("library search by client name", (await owner.locator("main a[href^='/v/']").count()) === 1 && (await owner.isVisible(`a[href="/v/${vid}"]`)));
await owner.click("[data-testid=library-clear]");
await owner.waitForSelector("[data-testid=search-summary]", { state: "detached" });
await owner.selectOption("[data-testid=library-client]", { label: "Client A" });
await owner.waitForURL((u) => u.searchParams.get("client") === clientA.id, { timeout: 10000 }).catch(() => {});
await owner.waitForSelector("[data-testid=search-summary]");
ok("library client filter", (await owner.locator("main a[href^='/v/']").count()) === 1 && (await owner.isVisible(`a[href="/v/${vid}"]`)));
await owner.goto(`${BASE}/library?q=nothing-matches-${stamp}`);
ok("library search: nothing matches", !!(await owner.waitForSelector("text=No videos match", { timeout: 15000 }).catch(() => null)));

// ---- Phones ----
await owner.setViewportSize({ width: 320, height: 720 });
for (const [path, name] of [["/clients", "clients"], [`/clients/${clientB.id}`, "client"], ["/library", "library"], [`/v/${vid}`, "video"]]) {
  await owner.goto(BASE + path);
  await owner.waitForLoadState("networkidle").catch(() => {});
  await owner.waitForTimeout(800);
  ok(`320px: ${name} fits`, await fits(owner), String(await owner.evaluate(() => document.documentElement.scrollWidth)));
  await owner.screenshot({ path: `${shots}/fx-send-phone-${name}.png`, fullPage: true });
}

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
