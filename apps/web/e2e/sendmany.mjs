// Sending one recording to several clients: quick picks (all, a staff
// member's clients), one private copy and conversation per client, emails,
// and deletes that don't break other clients' copies. Run against a server
// using the fake Stripe (same env as billing.mjs) and a fake camera.
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { start, state, createSubscription } from "./fake-stripe.mjs";
import { agreed } from "./agree.mjs";
import { chooseClients, sendByLink } from "./send.mjs";
const norm = (t) => (t ?? "").replace(/\s+/g, " ").trim();

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
const server = await start();
const sig = new Stripe("sk_test_fake");
const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args });
const stamp = Date.now();
const perms = { permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"] };
const clip = (p) => p.evaluate(() => navigator.clipboard.readText());
const finiteDuration = (el) => new Promise((r) => {
  const check = () => (Number.isFinite(el.duration) && el.duration > 0 ? r(el.duration) : setTimeout(check, 200));
  check();
  setTimeout(() => r(el.duration), 10000);
});

// A Studio owner with a staff member and four clients, two assigned to the staff member.
const owner = await (await browser.newContext(perms)).newPage();
await owner.goto(`${BASE}/login?next=/record`);
await agreed(`sm-owner${stamp}@example.com`);
await owner.fill('input[name="email"]', `sm-owner${stamp}@example.com`);
await owner.click("text=Continue");
await owner.waitForURL((u) => u.pathname === "/record");
await owner.click("text=I've saved it");
await owner.request.post(BASE + "/api/billing/checkout", { data: { plan: "STUDIO" } });
const session = state.sessions.at(-1).params;
const workspaceId = session.subscription_data.metadata.workspaceId;
const sub = createSubscription(session.customer, workspaceId, "sureframe_studio_monthly");
const payload = JSON.stringify({ id: `evt_${stamp}`, object: "event", type: "customer.subscription.created", data: { object: sub } });
await owner.request.post(BASE + "/api/webhooks/stripe", { headers: { "stripe-signature": sig.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" }), "content-type": "application/json" }, data: payload });

await owner.goto(BASE + "/settings/team");
await owner.click("text=Create invite link");
const invite = await (await owner.waitForSelector("[data-testid=invite-link]")).textContent();
const staff = await (await browser.newContext(perms)).newPage();
await staff.goto(invite);
await staff.click("text=Sign in to join");
await agreed(`sm-staff${stamp}@example.com`);
await staff.fill('input[name="email"]', `sm-staff${stamp}@example.com`);
await staff.click("text=Continue");
await staff.waitForURL((u) => u.pathname.startsWith("/join/"));
await staff.click("text=Join the team");
await staff.waitForURL((u) => u.pathname === "/library");
const staffUser = await prisma.user.findUnique({ where: { email: `sm-staff${stamp}@example.com` } });

await owner.goto(BASE + "/clients");
const names = ["Ana", "Ben", "Cal", "Dee"];
for (const n of names) {
  await owner.fill('input[aria-label="Client name"]', n);
  await owner.fill('input[aria-label="Client email"]', `${n.toLowerCase()}${stamp}@example.com`);
  await owner.click("button:has-text('Add client')");
  await owner.waitForSelector(`a:has-text('${n}')`);
}
const clients = Object.fromEntries((await prisma.client.findMany({ where: { workspaceId } })).map((c) => [c.name, c]));
// Ben and Cal have already opened their personal links, so Send by email can email them.
for (const n of ["Ben", "Cal"]) await prisma.client.update({ where: { id: clients[n].id }, data: { assignedToId: staffUser.id, linkOpenedAt: new Date() } });

// Record, send to Ana as usual, then to the staff member's clients in one go.
await owner.goto(BASE + "/record");
await owner.click("text=Camera only");
await owner.click("text=Start recording");
await owner.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await owner.waitForTimeout(3000);
await owner.click("button:has-text('Stop')");
await owner.waitForURL("**/v/**", { timeout: 30000 });
const videoId = owner.url().split("/v/")[1].split("?")[0];
await sendByLink(owner, "Ana");
for (let i = 0; i < 150 && (await prisma.video.findUnique({ where: { id: videoId } })).clientId !== clients.Ana.id; i++) await owner.waitForTimeout(100);
await owner.reload();
const outboxBefore = new Set(readdirSync(".data/outbox"));
await owner.click("[data-testid=client-picker]");
const offered = await owner.locator("[role=listbox] label").allTextContents();
ok("Ana (already sent) isn't offered again", !offered.includes("Ana") && offered.includes("Dee"), offered.join(","));
await owner.click(`button:has-text("sm-staff${stamp}'s clients")`);
ok("staff quick pick selects their two clients", (await owner.isChecked("[role=listbox] label:has-text('Ben') >> input")) && (await owner.isChecked("[role=listbox] label:has-text('Cal') >> input")) && !(await owner.isChecked("[role=listbox] label:has-text('Dee') >> input")));
await owner.click("[data-testid=send-panel] >> button:has-text('Done (2)')");
await owner.click("[data-testid=send-email]");
await owner.waitForSelector("text=/Emailed 2 clients/");
await owner.screenshot({ path: `${shots}/send-many.png`, fullPage: true });
const copies = await prisma.video.findMany({ where: { sourceId: videoId } });
const original = await prisma.video.findUnique({ where: { id: videoId } });
ok("one copy per client", copies.length === 2 && new Set(copies.map((c) => c.clientId)).size === 2);
ok("copies share the stored file, nothing re-uploaded", copies.every((c) => c.storageKey === original.storageKey));
ok("each copy has that client's own key wrap", copies.every((c) => c.clientKeyWrap && c.clientKeyWrap !== original.clientKeyWrap));
const mails = readdirSync(".data/outbox").filter((f) => !outboxBefore.has(f)).map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8")));
const toThem = (m) => [clients.Ben.email, clients.Cal.email].includes(m.to);
ok("both clients emailed", mails.filter((m) => toThem(m) && /sent you a video/.test(m.subject)).length === 2);
const recorder = await prisma.user.findUnique({ where: { id: original.ownerId } });
ok("emails name who recorded it", mails.filter((m) => /sent you a video/.test(m.subject)).every((m) => m.subject.startsWith(`${recorder.name} sent you a video`)), mails.map((m) => m.subject).join(" | "));
ok("emails carry no key", mails.every((m) => !m.text.includes("#k=")));
ok("emails credit SureFrame", mails.every((m) => m.html.includes("Sent with SureFrame")));

// "All clients" now only adds Dee.
await owner.click("[data-testid=client-picker]");
await owner.click("[role=group] >> text=All clients");
const left = await owner.locator("[role=listbox] label").allTextContents();
ok("all-clients pick adds only who's left", left.length === 1 && left[0] === "Dee" && (await owner.isChecked("[role=listbox] label:has-text('Dee') >> input")), left.join(","));
await owner.click("[role=group] >> text=Clear");
await owner.keyboard.press("Escape");

// No separate waiting list: Ana, who has this video but hasn't opened it, is under Sent to with the
// first-video buttons; choosing Dee (new) shows the ways to send her first video, under the picker.
await owner.waitForSelector("[data-testid=sent-row]:has-text('Ana') [data-testid=first-link-copy]", { timeout: 20000 });
ok("no waiting list", (await owner.locator("[data-testid=waiting-list]").count()) === 0);
ok("Ana: under Sent to, sent from you, with the first-video buttons", norm(await owner.textContent("[data-testid=sent-row]:has-text('Ana') [data-testid=row-first]")).includes("Sent from you") && (await owner.locator("[data-testid=sent-row]:has-text('Ana') [data-testid=first-link-email]").count()) === 1);
await chooseClients(owner, "Dee");
await owner.waitForSelector("[data-testid=first-link-row]", { timeout: 10000 });
ok("choosing Dee: her first video's buttons, Email and Copy link", (await owner.locator("[data-testid=first-link-row] [data-testid=first-link-copy]").count()) === 1 && norm(await owner.textContent("[data-testid=first-time]")).includes("This is Dee's first video"));
const top = async (sel) => (await owner.locator(sel).first().boundingBox()).y;
ok("Choose clients sits above the first-video box", (await top("[data-testid=client-picker]")) < (await top("[data-testid=first-time]")));
await owner.click("[data-testid=client-picker]");
await owner.click("[role=group] >> text=Clear");
await owner.keyboard.press("Escape");

// Ben opens his copy from the link the owner copies for him.
const benCopy = copies.find((c) => c.clientId === clients.Ben.id);
const calCopy = copies.find((c) => c.clientId === clients.Cal.id);
await owner.click(`[data-testid=sent-row]:has-text('Ben') >> [data-testid=copy-row-link]`);
await owner.waitForTimeout(300);
const benLink = await clip(owner);
ok("Ben's link opens his copy", benLink.includes(`v=${benCopy.id}`) && benLink.includes("#k="));
const ben = await (await browser.newContext(perms)).newPage();
await ben.goto(benLink);
await ben.waitForURL(`**/v/${benCopy.id}**`);
await ben.waitForSelector("main video", { timeout: 20000 });
ok("Ben plays the video", (await ben.$eval("main video", finiteDuration)) > 1);
ok("client page credits SureFrame", await ben.isVisible("text=Made with SureFrame"));
await ben.fill('textarea[aria-label="Reply"]', "Ben's private reply");
await ben.click("button:has-text('Send')");
await ben.waitForSelector("text=Ben's private reply");

// Cal can't open Ben's copy or see his reply.
await owner.click(`[data-testid=sent-row]:has-text('Cal') >> [data-testid=copy-row-link]`);
await owner.waitForTimeout(300);
const cal = await (await browser.newContext(perms)).newPage();
await cal.goto(await clip(owner));
await cal.waitForSelector("main video", { timeout: 20000 });
ok("Cal doesn't see Ben's reply", !(await cal.isVisible("text=Ben's private reply")));
await cal.goto(`${BASE}/v/${benCopy.id}`);
ok("Cal can't open Ben's copy", !!(await cal.waitForSelector("text=This video is private", { timeout: 10000 }).catch(() => null)));
ok("Cal can't read Ben's replies by API", (await cal.request.get(`${BASE}/api/videos/${benCopy.id}/replies`)).status() === 404);

// The team sees Ben's conversation; the library shows the recording once.
await owner.goto(`${BASE}/v/${benCopy.id}`);
await owner.waitForSelector("text=Ben's private reply");
ok("team sees Ben's reply in his conversation", await owner.isVisible("text=See the original"));
await staff.goto(BASE + "/library?show=mine");
// Staff see their clients' copies, not the original (another client's conversation).
ok("staff's library shows the copy sent to their client, not the original", (await staff.locator(`a[href="/v/${benCopy.id}"]`).count()) === 1 && (await staff.locator(`a[href="/v/${videoId}"]`).count()) === 0);
await owner.goto(BASE + "/library");
ok("library lists the recording once", (await owner.locator(`a[href^="/v/"]`).count()) === 1);

// Deleting one client's copy leaves the others working; deleting the original removes all.
ok("delete Cal's copy", (await owner.request.delete(`${BASE}/api/videos/${calCopy.id}`)).status() === 204);
await ben.reload();
await ben.waitForSelector("main video", { timeout: 20000 });
ok("Ben's copy still plays after Cal's is deleted", (await ben.$eval("main video", finiteDuration)) > 1);
ok("delete the original", (await owner.request.delete(`${BASE}/api/videos/${videoId}`)).status() === 204);
ok("its copies go with it", (await prisma.video.count({ where: { sourceId: videoId } })) === 0 && !(await prisma.video.findUnique({ where: { id: benCopy.id } })));

await browser.close();
server.close();
await prisma.$disconnect();
