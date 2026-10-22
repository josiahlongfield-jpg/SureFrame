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
import { chooseClients } from "./send.mjs";

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
ok("adding (no clients yet): how clients get videos is explained up front", norm(await owner.textContent("[data-testid=first-link-rule]")).includes("Send their first video yourself") && norm(await owner.textContent("[data-testid=first-link-rule]")).includes("After that, we email them"));
const aEmail = `client-a-${stamp}@example.com`;
await owner.fill('input[aria-label="Client name"]', "x".repeat(81));
await owner.click("button:has-text('Add client')");
ok("a name that's too long says so, with the limit", (await owner.textContent("[role=alert]")).includes("Names can be up to 80 characters"));
const longApi = await owner.evaluate(async () => (await (await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "y".repeat(300), teamKeyWrap: "x".repeat(60) }) })).json()).error);
ok("the API says so too", /too long.*80 characters/.test(longApi), longApi);
await owner.fill('input[aria-label="Client name"]', "Client A");
await owner.fill('input[aria-label="Client email"]', aEmail);
await owner.click("button:has-text('Add client')");
await owner.waitForSelector("[data-testid=added-note]");
const added = norm(await owner.textContent("[data-testid=added-note]"));
ok("after adding: next step is recording a video for them, said plainly", added.includes("Client A added.") && added.includes("Record a video for Client A") && (await owner.isVisible("[data-testid=added-record]")) && !added.includes("can't open any videos"), added);
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
await owner.fill('input[aria-label="Client email"]', aEmail.toUpperCase());
ok("adding the same email: says they're on the list, Add is off", (await owner.textContent("[data-testid=duplicate-match]")).includes("Client A already uses this email") && (await owner.isDisabled("button:has-text('Add client')")));
const dupe = await owner.evaluate(async (e) => {
  const r = await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Twin", email: e, teamKeyWrap: "x".repeat(60) }) });
  return [r.status, (await r.json()).error];
}, aEmail);
ok("the API refuses a duplicate single add (409)", dupe[0] === 409 && dupe[1].includes("already on your client list"), JSON.stringify(dupe));
await owner.fill('input[aria-label="Client name"]', "");
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
ok("search by email", (await owner.locator("main ul > li a[href^='/clients/']").allTextContents()).join() === "Client C");
await owner.fill("[data-testid=clients-search]", "");
await owner.selectOption("[data-testid=clients-filter]", "first");
ok("filter: not opened a video yet", (await owner.locator("main ul > li a[href^='/clients/']").allTextContents()).join() === "Client B,Client C");
await owner.selectOption("[data-testid=clients-filter]", "all");
ok("Client B: copied in the list, so marked not opened yet", (await owner.textContent("li:has-text('Client B') [data-testid=needs-first-link]"))?.includes("Not opened yet"));

// A duplicate made before Add refused them: removing it emails nobody, and it can't be restored while the other is there.
const twin = await prisma.client.create({ data: { name: "Client A (old)", email: aEmail, token: `fxs-${stamp}-twin-${"x".repeat(20)}`, workspaceId: ws, teamKeyWrap: clientA.teamKeyWrap } });
await owner.reload();
await owner.click(`li:has-text("Client A (old)") >> button:text-is("Remove client")`);
const box = norm(await owner.textContent("[data-testid=remove-client-confirm]"));
ok("removing a duplicate: says nobody is emailed, no email box", box.includes(`Client A also uses ${aEmail}, so nobody is emailed about this`) && (await owner.locator("[data-testid=remove-client-email]").count()) === 0, box);
const mailsBefore = mailTo(aEmail).length;
await owner.click("[data-testid=remove-client-confirm] >> button:text-is('Remove Client A (old)')");
await owner.waitForSelector("[data-testid=clients-notice]");
ok("restoring the duplicate is refused (409)", (await owner.request.post(`${BASE}/api/clients/${twin.id}/restore`)).status() === 409);
await owner.waitForTimeout(1500);
ok("the real client wasn't told their access ended", mailTo(aEmail).length === mailsBefore);
ok("Restore is off for the duplicate, saying why", (await owner.isDisabled(`[data-testid=removed-clients] li:has-text("Client A (old)") >> [data-testid=restore-client]`)) && (await owner.isVisible("[data-testid=restore-duplicate]")));

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
await owner.click("role=tab[name='Note']");
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
ok("Send box: no first-video box while no new client is chosen, and no waiting list", (await owner.locator("[data-testid=first-time]").count()) === 0 && (await owner.locator("[data-testid=waiting-list]").count()) === 0);
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
ok("Send box: new clients chosen, their first videos go from you", norm(await owner.textContent("[data-testid=first-time]")).includes("Alongside each video is that client's personal link, so for privacy reasons SureFrame is unable to automate it"));
const firstBox = norm(await owner.textContent("[data-testid=first-links]"));
ok("chosen first-timers: each named, with their own Copy link", (await owner.locator("[data-testid=first-link-row]:has-text('Client B') [data-testid=first-link-copy]").count()) === 1 && (await owner.locator("[data-testid=first-link-row]:has-text('Client C') [data-testid=first-link-copy]").count()) === 1, firstBox);
ok("several first-timers: each row still has Copy link + message (S15)", (await owner.locator("[data-testid=first-link-row]:has-text('Client B') [data-testid=first-link-message]").count()) === 1 && (await owner.locator("[data-testid=first-link-row]:has-text('Client C') [data-testid=first-link-message]").count()) === 1);
ok("several first-timers: one line for them all, the why folded away", norm(await owner.textContent("[data-testid=first-why-line]")).includes("First videos for 2 clients: send each one yourself") && !(await owner.isVisible("text=/Alongside each video is that client's personal link/")));
ok("mixed choice: one Send to all, no second Copy all in the box", (await owner.textContent("[data-testid=send-all]")).trim() === "Send to all 3" && (await owner.locator("[data-testid=copy-all-first]").count()) === 0 && (await owner.locator("[data-testid=send-link]").count()) === 0);
ok("it says who is emailed and whose links are copied", norm(await owner.textContent("[data-testid=send-all-explained]")).includes("emails Client A, and copies the links for Client B, Client C"));
ok("emailing only the reached client is still offered", (await owner.textContent("[data-testid=send-email]")).trim() === "Email 1 of them");
await owner.screenshot({ path: `${shots}/fx-send-chosen.png`, fullPage: true });
await owner.click("[data-testid=send-all]");
await owner.waitForSelector("text=/Sent to all 3/");
const status = norm(await owner.textContent("[data-testid=send-status]"));
ok("status: emailed the reached client, copied the others' links, says why links differ", status.includes("Emailed Client A") && status.includes("Copied the links for Client B, Client C") && status.includes("Each link is different"), status);
const mail = await waitFor(() => mailTo(aEmail).find((m) => /sent you a video/.test(m.subject)));
ok("email subject has the title", mail?.subject.endsWith("sent you a video: Week 1 plan"), mail?.subject);
ok("email is from 'Business A via SureFrame'", mail?.from.startsWith(`${business} via SureFrame <`), mail?.from);
ok("email shows the business name and title", mail?.html.includes(business) && mail.html.includes("Week 1 plan"));
ok("email body names the video and says how long it is (C39)", /\nWeek 1 plan\n\d+ seconds?\n/.test(mail?.text ?? ""), mail?.text);
ok("email explains the device rule plainly", mail?.text.includes("The button opens it on any phone or computer where you've opened your personal link") && !mail.text.includes("use the personal link they gave you first"));
await owner.waitForSelector("[data-testid=sent-row]:has-text('Client B') [data-testid=first-link-copy]");
const both = await clip();
ok("Send to all copies the first-timers' own conversations, not the emailed client's", /Client B: .*v=.*#k=/.test(both) && /Client C: .*v=.*#k=/.test(both) && !both.includes("Client A:"), both);
ok("the emailed client's row says Emailed and Not opened yet", /Emailed\s*· Not opened yet/.test(norm(await owner.textContent("[data-testid=sent-row]:has-text('Client A')"))));
ok("everyone is under Sent to, no separate waiting rows", (await owner.locator("[data-testid=sent-row]").count()) === 3 && (await owner.locator("[data-testid=waiting-row]").count()) === 0);
ok("new clients' rows: just Send from your email and Copy link", (await owner.locator("[data-testid=sent-row]:has-text('Client B') [data-testid=first-link-email]").count()) === 1 && (await owner.locator("[data-testid=sent-row]:has-text('Client B') [data-testid=first-link-copy]").count()) === 1 && (await owner.locator("[data-testid=sent-row]:has-text('Client B') [data-testid=first-link-message]").count()) === 0);
await owner.click("[data-testid=sent-row]:has-text('Client B') [data-testid=first-link-copy]");
await owner.waitForTimeout(300);
const linkB = await clip();
ok("Client B's row copies their own conversation link, with their key", linkB.includes(`v=`) && linkB.includes("#k=") && !linkB.includes(`v=${vid}`), linkB);
const copyB = await prisma.video.findFirst({ where: { sourceId: vid, clientId: clientB.id } });
ok("emailing a first-timer is refused", (await owner.request.post(`${BASE}/api/videos/${copyB.id}/notify`)).status() === 409);
ok("Client B's row: Not opened yet, no extra note", norm(await owner.textContent("[data-testid=sent-row]:has-text('Client B')")).includes("Not opened yet") && (await owner.locator("[data-testid=sent-row]:has-text('Client B') [data-testid=row-first]").count()) === 0);
ok("every row has Stop sharing", (await owner.locator("[data-testid=stop-sharing]").count()) === 3);
await owner.click("[data-testid=sent-row]:has-text('Client C') [data-testid=stop-sharing]");
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
// Opening the conversation counts Client A's reply as seen on this device; Client B's copy still has one new.
await owner.goto(`${BASE}/v/${vid}`);
await owner.waitForSelector("[data-testid=reply-composer], aside", { timeout: 20000 }).catch(() => {});
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
