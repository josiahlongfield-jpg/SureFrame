// Staff access: an Agency owner delegates clients to two staff members. Each
// member sees only their own clients (and those clients' videos, replies,
// to-dos and notes) plus what they recorded; the server refuses everything
// else, in the API and in pages. The owner toggles per-staff permissions on
// the Team page. Client replies email the assigned staff member (throttled),
// client-specific team reminders go to the assigned staff member, and the
// "Your name" setting shows clients "Name from Business".
//
// Owners and admins also get a Team overview: bulk reassignment, their own
// team email preferences, reminders to staff, and monitoring numbers.
//
// Run against a dev server with the fake Stripe (same env as billing.mjs),
// no RESEND_API_KEY (mail goes to .data/outbox), and CRON_SECRET set:
//   STRIPE_SECRET_KEY=sk_test_fake STRIPE_API_BASE=http://localhost:12111 STRIPE_WEBHOOK_SECRET=whsec_test npm run dev
//   CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome CRON_SECRET=... node e2e/staff-access.mjs [screenshot dir]
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { start, state, createSubscription } from "./fake-stripe.mjs";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret";
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
const stamp = Date.now();
const wrap = (c) => c.repeat(44); // stands in for a wrapped key; these checks never decrypt
const outbox = () => (existsSync(".data/outbox") ? readdirSync(".data/outbox").sort().map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8"))) : []);
const waitFor = async (fn, ms = 8000) => {
  for (let t = 0; t < ms; t += 200) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return fn();
};

// ---- An Agency owner with two staff members ----
const owner = await (await browser.newContext()).newPage();
await owner.goto(`${BASE}/login?next=/record`);
await agreed(`sa-owner${stamp}@example.com`);
await owner.fill('input[name="email"]', `sa-owner${stamp}@example.com`);
await owner.click("text=Continue");
await owner.waitForURL((u) => u.pathname === "/record");
await owner.click("text=I've saved it");
await owner.request.post(BASE + "/api/billing/checkout", { data: { plan: "AGENCY" } });
const session = state.sessions.at(-1).params;
const workspaceId = session.subscription_data.metadata.workspaceId;
const sub = createSubscription(session.customer, workspaceId, "sureframe_agency_monthly");
const payload = JSON.stringify({ id: `evt_${stamp}`, object: "event", type: "customer.subscription.created", data: { object: sub } });
await owner.request.post(BASE + "/api/webhooks/stripe", { headers: { "stripe-signature": sig.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" }), "content-type": "application/json" }, data: payload });
await prisma.workspace.update({ where: { id: workspaceId }, data: { name: `Peak ${stamp}` } });
const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
ok("owner is on Agency", ws.plan === "AGENCY");
const fp = ws.keyFingerprint;

async function join(email) {
  await owner.goto(BASE + "/settings/team");
  await owner.click("text=Create invite link");
  const link = await (await owner.waitForSelector("[data-testid=invite-link]")).textContent();
  const page = await (await browser.newContext()).newPage();
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
const { page: amy, user: amyUser } = await join(`sa-amy${stamp}@example.com`);
const { page: bob, user: bobUser } = await join(`sa-bob${stamp}@example.com`);
const amyM = await prisma.membership.findFirst({ where: { userId: amyUser.id, workspaceId } });
ok("new staff get the default permissions", amyM.role === "MEMBER" && !amyM.seeAllClients && amyM.addClients && !amyM.deleteAnyVideo && amyM.sendToMany);

// Clients: Ana (Amy's), Ben (Bob's), Sha (shared, unassigned).
const addClient = async (page, name, email) => {
  const res = await page.request.post(BASE + "/api/clients", { data: { name, email, teamKeyWrap: wrap("k"), keyFingerprint: fp } });
  return { res, client: (await res.json().catch(() => ({}))).client };
};
const ana = (await addClient(owner, "Ana", `ana${stamp}@example.com`)).client;
const ben = (await addClient(owner, "Ben", `ben${stamp}@example.com`)).client;
const sha = (await addClient(owner, "Sha", `sha${stamp}@example.com`)).client;
// Assign Ana through the owner's Clients page; Ben through the API.
await owner.goto(BASE + "/clients");
await owner.selectOption('select[aria-label="Who looks after Ana"]', amyUser.id);
await waitFor(async () => (await prisma.client.findUnique({ where: { id: ana.id } })).assignedToId === amyUser.id);
ok("owner assigns Ana to Amy", (await prisma.client.findUnique({ where: { id: ana.id } })).assignedToId === amyUser.id);
ok("owner assigns Ben to Bob", (await owner.request.patch(`${BASE}/api/clients/${ben.id}`, { data: { assignedToId: bobUser.id } })).ok());

// Videos (API uploads with stand-in keys).
async function record(page, title, clientId) {
  const res = await page.request.post(BASE + "/api/videos", { data: { mimeType: "video/webm", title, teamKeyWrap: wrap("t"), keyFingerprint: fp } });
  const { video } = await res.json();
  await page.request.put(`${BASE}/api/videos/${video.id}/parts/1`, { data: Buffer.from("not really a video") });
  await page.request.post(`${BASE}/api/videos/${video.id}/complete`, { data: { partCount: 1, durationMs: 1000 } });
  if (clientId) await page.request.patch(`${BASE}/api/videos/${video.id}`, { data: { clientId, clientKeyWrap: wrap("c"), keyFingerprint: fp } });
  return video.id;
}
const vOwnerBen = await record(owner, "Owner to Ben", ben.id);
const vOwnerSha = await record(owner, "Owner to Sha", sha.id);
const vBob = await record(bob, "Bob to Ben", ben.id);
const vAmy = await record(amy, "Amy draft", null);
const vAmyAna = await record(amy, "Amy to Ana", ana.id);
ok("Bob sends his video to his own client", (await prisma.video.findUnique({ where: { id: vBob } })).clientId === ben.id);

// Ben's to-do (written by the owner).
const item = await owner.request.post(BASE + "/api/items", { data: { kind: "NOTE", body: wrap("n"), clientId: ben.id, keyFingerprint: fp } });
const benItem = (await item.json()).item;

// ---- Amy (default member) can't reach Bob's client or the shared one ----
const status = async (p) => (await p).status();
const amyClients = (await (await amy.request.get(BASE + "/api/clients")).json()).clients.map((c) => c.name).sort();
ok("Amy lists only her clients", amyClients.join() === "Ana", amyClients.join());
const amyVideos = (await (await amy.request.get(BASE + "/api/videos")).json()).videos.map((v) => v.id);
ok("Amy's library API has only her own and her clients' videos", amyVideos.includes(vAmy) && amyVideos.includes(vAmyAna) && !amyVideos.includes(vOwnerBen) && !amyVideos.includes(vBob) && !amyVideos.includes(vOwnerSha), amyVideos.join());
for (const [label, v] of [["owner's video to Ben", vOwnerBen], ["Bob's video", vBob], ["owner's video to Sha", vOwnerSha]]) {
  ok(`Amy can't open ${label}`, (await status(amy.request.get(`${BASE}/api/videos/${v}`))) === 404);
  ok(`Amy can't read replies on ${label}`, (await status(amy.request.get(`${BASE}/api/videos/${v}/replies`))) === 404);
  ok(`Amy can't reply on ${label}`, (await status(amy.request.post(`${BASE}/api/videos/${v}/replies`, { data: { kind: "TEXT", body: "x", encrypted: true } }))) === 404);
  ok(`Amy can't stream ${label}`, (await status(amy.request.get(`${BASE}/api/videos/${v}/stream`))) === 404);
  ok(`Amy can't rename ${label}`, (await status(amy.request.patch(`${BASE}/api/videos/${v}`, { data: { title: "hijack" } }))) === 404);
  ok(`Amy can't delete ${label}`, (await status(amy.request.delete(`${BASE}/api/videos/${v}`))) === 404);
  ok(`Amy can't send ${label} to more clients`, (await status(amy.request.post(`${BASE}/api/videos/${v}/send`, { data: { recipients: [{ clientId: ana.id, clientKeyWrap: wrap("c") }], keyFingerprint: fp } }))) === 404);
  ok(`Amy can't react to ${label}`, (await status(amy.request.post(`${BASE}/api/videos/${v}/reactions`, { data: { emoji: "👍" } }))) === 404);
}
ok("Amy can't send her video to Bob's client", (await status(amy.request.post(`${BASE}/api/videos/${vAmy}/send`, { data: { recipients: [{ clientId: ben.id, clientKeyWrap: wrap("c") }], keyFingerprint: fp } }))) === 400);
ok("Amy can't send her video to a shared client", (await status(amy.request.patch(`${BASE}/api/videos/${vAmy}`, { data: { clientId: sha.id, clientKeyWrap: wrap("c"), keyFingerprint: fp } }))) === 400);
ok("Amy can't read Ben's to-dos", (await status(amy.request.get(`${BASE}/api/items?clientId=${ben.id}`))) === 404);
ok("Amy can't add to Ben's to-dos", (await status(amy.request.post(BASE + "/api/items", { data: { kind: "NOTE", body: wrap("n"), clientId: ben.id, keyFingerprint: fp } }))) === 404);
ok("Amy can't edit Ben's note", (await status(amy.request.patch(`${BASE}/api/items/${benItem.id}`, { data: { done: true, keyFingerprint: fp } }))) === 404);
ok("Amy can't delete Ben's note", (await status(amy.request.delete(`${BASE}/api/items/${benItem.id}`))) === 404);
ok("Amy can't rename Ben", (await status(amy.request.patch(`${BASE}/api/clients/${ben.id}`, { data: { name: "Hacked" } }))) === 404);
ok("Amy can't rename a shared client", (await status(amy.request.patch(`${BASE}/api/clients/${sha.id}`, { data: { email: "x@example.com" } }))) === 404);
ok("Amy can't fetch Ben's key history", (await status(amy.request.get(`${BASE}/api/clients/${ben.id}/key`))) === 404);
ok("Amy can't change her own permissions", (await status(amy.request.patch(`${BASE}/api/team/members/${amyUser.id}`, { data: { perms: { seeAllClients: true } } }))) === 403);
const exp = await (await amy.request.get(BASE + "/api/account/export")).text();
ok("Amy's data export leaves out other clients and videos", exp.includes("Ana") && !exp.includes('"Ben"') && !exp.includes('"Sha"') && !exp.includes(vOwnerBen) && !exp.includes(vBob), exp.slice(0, 200));

// ...but everything for her own client works.
ok("Amy reads Ana's to-dos", (await amy.request.get(`${BASE}/api/items?clientId=${ana.id}`)).ok());
ok("Amy adds a note for Ana", (await status(amy.request.post(BASE + "/api/items", { data: { kind: "NOTE", body: wrap("n"), clientId: ana.id, keyFingerprint: fp } }))) === 201);
ok("Amy renames Ana's email", (await amy.request.patch(`${BASE}/api/clients/${ana.id}`, { data: { email: `ana2${stamp}@example.com` } })).ok());
ok("Amy sends her draft to Ana and to many (default on)", (await status(amy.request.post(`${BASE}/api/videos/${vAmy}/send`, { data: { recipients: [{ clientId: ana.id, clientKeyWrap: wrap("c") }], keyFingerprint: fp, notify: false } }))) === 201);

// Pages.
await amy.goto(BASE + "/clients");
await amy.waitForSelector("text=Ana");
const amyClientsPage = await amy.textContent("main");
ok("Amy's Clients page shows only Ana, with no All/My tabs", !amyClientsPage.includes("Ben") && !amyClientsPage.includes("Sha") && !(await amy.isVisible("text=/All clients \\(/")), amyClientsPage);
ok("Amy can add clients (default on)", await amy.isVisible("text=Add a client"));
ok("Amy can't assign clients", !(await amy.isVisible('select[aria-label="Who looks after Ana"]')));
await amy.screenshot({ path: `${shots}/staff-clients.png`, fullPage: true });
// The app streams pages (loading.tsx), so check the not-found page rather than the status code.
const notFound = async (path, name) => {
  await amy.goto(BASE + path);
  await amy.waitForSelector("text=Page not found", { timeout: 10000 }).catch(() => null);
  return (await amy.isVisible("text=Page not found")) && !(await amy.textContent("body")).includes(name);
};
ok("Ben's client page is not found for Amy", await notFound(`/clients/${ben.id}`, "Ben"));
ok("the shared client's page is not found for Amy", await notFound(`/clients/${sha.id}`, "Sha"));
await amy.goto(`${BASE}/clients/${ana.id}`);
ok("Ana's client page opens for Amy", !!(await amy.waitForSelector("h1:has-text('Ana')", { timeout: 10000 }).catch(() => null)));
await amy.goto(`${BASE}/v/${vOwnerBen}`);
ok("Bob's client's video page is private for Amy, and says why", !!(await amy.waitForSelector("text=This video is for a client you don't look after", { timeout: 10000 }).catch(() => null)) && !(await amy.textContent("body")).includes("Owner to Ben") && !(await amy.isVisible("text=Sign in")));
await amy.goto(BASE + "/library");
const lib = await amy.textContent("main");
ok("Amy's library lists only her videos", lib.includes("Amy draft") && lib.includes("Amy to Ana") && !lib.includes("Owner to Ben") && !lib.includes("Bob to Ben") && !lib.includes("Owner to Sha"), lib);

// ---- Bob sees his assigned client's videos, including the owner's ----
const bobVideos = (await (await bob.request.get(BASE + "/api/videos")).json()).videos.map((v) => v.id);
ok("Bob sees the owner's video to his client and his own", bobVideos.includes(vOwnerBen) && bobVideos.includes(vBob) && !bobVideos.includes(vAmy) && !bobVideos.includes(vOwnerSha), bobVideos.join());
ok("Bob reads replies on his client's video", (await bob.request.get(`${BASE}/api/videos/${vOwnerBen}/replies`)).ok());
ok("Bob reads Ben's to-dos", (await bob.request.get(`${BASE}/api/items?clientId=${ben.id}`)).ok());
ok("Bob can't delete the owner's video by default", (await status(bob.request.delete(`${BASE}/api/videos/${vOwnerBen}`))) === 403);
const vBobTemp = await record(bob, "Bob temp", null);
ok("Bob can delete his own video", (await status(bob.request.delete(`${BASE}/api/videos/${vBobTemp}`))) === 204);

// ---- Owner sees everything ----
const ownerClients = (await (await owner.request.get(BASE + "/api/clients")).json()).clients.map((c) => c.name);
ok("owner sees every client", ["Ana", "Ben", "Sha"].every((n) => ownerClients.includes(n)), ownerClients.join());
const ownerVideos = (await (await owner.request.get(BASE + "/api/videos")).json()).videos.map((v) => v.id);
ok("owner sees every video", [vOwnerBen, vOwnerSha, vBob, vAmy, vAmyAna].every((v) => ownerVideos.includes(v)));
ok("owner opens Bob's video", (await owner.request.get(`${BASE}/api/videos/${vBob}`)).ok());

// ---- Toggles on the Team page (the only place for them: Settings > Team links there) ----
await owner.goto(BASE + "/team");
const amyName = `sa-amy${stamp}`;
await owner.click(`input[aria-label="See all clients for ${amyName}"]`);
await waitFor(async () => (await prisma.membership.findUnique({ where: { id: amyM.id } })).seeAllClients);
ok("owner turns on See all clients for Amy", (await prisma.membership.findUnique({ where: { id: amyM.id } })).seeAllClients);
await owner.screenshot({ path: `${shots}/staff-permissions.png`, fullPage: true });
const amyAll = (await (await amy.request.get(BASE + "/api/clients")).json()).clients.map((c) => c.name).sort();
ok("with See all clients Amy lists everyone", ["Ana", "Ben", "Sha"].every((n) => amyAll.includes(n)), amyAll.join());
ok("with See all clients Amy opens Bob's video", (await amy.request.get(`${BASE}/api/videos/${vBob}`)).ok());
await amy.goto(BASE + "/clients");
await amy.waitForSelector("text=/My clients \\(/");
ok("Amy starts on My clients, can switch to All", (await amy.getAttribute("role=tab[name=/My clients/]", "aria-selected")) === "true" && !(await amy.isVisible("a:has-text('Ben')")));
await amy.click("text=/All clients \\(/");
ok("All clients tab shows Ben", await amy.isVisible("a:has-text('Ben')"));
ok("Amy still can't delete Bob's video", (await status(amy.request.delete(`${BASE}/api/videos/${vBob}`))) === 403);
await owner.click(`input[aria-label="See all clients for ${amyName}"]`);
await waitFor(async () => !(await prisma.membership.findUnique({ where: { id: amyM.id } })).seeAllClients);
ok("turning it off hides Ben again", (await status(amy.request.get(`${BASE}/api/videos/${vBob}`))) === 404);

await owner.click(`input[aria-label="Add new clients for ${amyName}"]`);
await waitFor(async () => !(await prisma.membership.findUnique({ where: { id: amyM.id } })).addClients);
ok("with Add new clients off Amy can't add", (await addClient(amy, "Zed")).res.status() === 403);
await amy.goto(BASE + "/clients");
await amy.waitForSelector("text=Ana");
ok("and the Add a client form is hidden", !(await amy.isVisible("text=Add a client")));
await owner.click(`input[aria-label="Add new clients for ${amyName}"]`);
await waitFor(async () => (await prisma.membership.findUnique({ where: { id: amyM.id } })).addClients);
const added = await addClient(amy, "Zed");
ok("staff-added clients are assigned to them", added.res.status() === 201 && added.client.assignedToId === amyUser.id);

await owner.click(`input[aria-label="Send to many for ${amyName}"]`);
await waitFor(async () => !(await prisma.membership.findUnique({ where: { id: amyM.id } })).sendToMany);
ok("with Send to many off Amy can't send to several", (await status(amy.request.post(`${BASE}/api/videos/${vAmyAna}/send`, { data: { recipients: [{ clientId: added.client.id, clientKeyWrap: wrap("c") }], keyFingerprint: fp } }))) === 403);

await owner.click(`input[aria-label="Delete any video for sa-bob${stamp}"]`);
await waitFor(async () => (await prisma.membership.findFirst({ where: { userId: bobUser.id, workspaceId } })).deleteAnyVideo);
const vOwnerBen2 = await record(owner, "Owner to Ben 2", ben.id);
ok("with Delete any video on Bob deletes the owner's video to his client", (await status(bob.request.delete(`${BASE}/api/videos/${vOwnerBen2}`))) === 204);
ok("but still not a video he can't see", (await status(bob.request.delete(`${BASE}/api/videos/${vOwnerSha}`))) === 404);

// ---- Reply notifications go to the assigned staff member, throttled ----
const clientPage = async (c) => {
  const p = await (await browser.newContext()).newPage();
  await p.goto(`${BASE}/c/${(await prisma.client.findUnique({ where: { id: c.id } })).token}`);
  return p;
};
const benPage = await clientPage(ben);
const before = outbox().length;
ok("Ben replies", (await status(benPage.request.post(`${BASE}/api/videos/${vOwnerBen}/replies`, { data: { kind: "TEXT", body: "sealed-text-1", encrypted: true } }))) === 201);
const mail = await waitFor(() => outbox().slice(before).find((m) => m.subject?.includes("Ben replied")));
ok("reply email goes to Bob (assigned), not the owner who recorded it", mail?.to === bobUser.email && !outbox().slice(before).some((m) => m.to === `sa-owner${stamp}@example.com`), JSON.stringify(mail));
ok("reply email to the team is from SureFrame (not the business's own name) and has no reply text", mail?.from.startsWith("SureFrame <") && !JSON.stringify(mail).includes("sealed-text-1") && mail.text.includes(`/v/${vOwnerBen}`), mail?.from);
ok("reply email names the video by its title (O72)", !!mail?.subject.endsWith("replied to \u201cOwner to Ben\u201d") && mail.text.includes("\u201cOwner to Ben\u201d"), mail?.subject);
await benPage.request.post(`${BASE}/api/videos/${vOwnerBen}/replies`, { data: { kind: "TEXT", body: "sealed-text-2", encrypted: true } });
await benPage.request.post(`${BASE}/api/videos/${vOwnerBen}/replies`, { data: { kind: "TEXT", body: "sealed-text-3", encrypted: true } });
await new Promise((r) => setTimeout(r, 1500));
ok("a burst of replies sends one email per 15 minutes", outbox().slice(before).filter((m) => m.subject?.includes("Ben replied")).length === 1);
ok("Bob replies on his client's video", (await status(bob.request.post(`${BASE}/api/videos/${vOwnerBen}/replies`, { data: { kind: "TEXT", body: "x", encrypted: true } }))) === 201);

// Unassigned client: the recorder hears about it (the owner sent Amy's video to Sha).
const vAmySha = await record(amy, "Amy for Sha", null);
await owner.request.patch(`${BASE}/api/videos/${vAmySha}`, { data: { clientId: sha.id, clientKeyWrap: wrap("c"), keyFingerprint: fp } });
const shaPage = await clientPage(sha);
const before2 = outbox().length;
await shaPage.request.post(`${BASE}/api/videos/${vAmySha}/replies`, { data: { kind: "TEXT", body: "s", encrypted: true } });
const mail2 = await waitFor(() => outbox().slice(before2).find((m) => m.subject?.includes("Sha replied")));
ok("unassigned client's reply goes to the video's recorder", mail2?.to === amyUser.email, JSON.stringify(mail2));
const before3 = outbox().length;
await shaPage.request.post(`${BASE}/api/videos/${vOwnerSha}/replies`, { data: { kind: "TEXT", body: "s", encrypted: true } });
const mail3 = await waitFor(() => outbox().slice(before3).find((m) => m.subject?.includes("Sha replied")));
ok("a different conversation isn't throttled, and goes to the owner who recorded it", mail3?.to === `sa-owner${stamp}@example.com`, JSON.stringify(mail3));
ok("to the person who sent it, the reply email says \"your video\" (S54)", /^Sha replied to your video/.test(mail3?.subject ?? "") && /Sha replied to your video .*on SureFrame\./.test(mail3?.text ?? ""), `${mail3?.subject} | ${mail3?.text}`);
ok("to someone else (the assigned staff member), it names the video instead", !mail?.subject.includes("your video") && mail2?.subject.startsWith("Sha replied to your video"), `${mail?.subject} | ${mail2?.subject}`);

// ---- A client's link held in a staff member's browser (S41) ----
// Amy (sees only her own clients) has Ben's personal link in her browser: Ben's video opens as Ben, and says so.
const benToken = (await prisma.client.findUnique({ where: { id: ben.id } })).token;
await amy.context().addCookies([{ name: `fc_key_${ben.id}`, value: "1", url: BASE }]);
await amy.goto(`${BASE}/c/${benToken}?v=${vOwnerBen}`);
const asBen = await amy.waitForSelector("[data-testid=staff-viewing-as-client]", { timeout: 15000 }).catch(() => null);
ok("staff viewing a video through a client's link are told they're seeing it as that client (S41)", !!asBen && (await asBen.textContent()).includes("viewing this as Ben") && (await asBen.textContent()).includes("goes to"), asBen ? await asBen.textContent() : "no notice");
await benPage.goto(`${BASE}/v/${vOwnerBen}`);
await benPage.waitForSelector("main");
ok("the client themselves never sees that notice", (await benPage.locator("[data-testid=staff-viewing-as-client]").count()) === 0);
await amy.context().clearCookies({ name: `fc_client_${workspaceId}` });
await amy.context().clearCookies({ name: `fc_key_${ben.id}` });

// ---- Team reminders for a client go to the assigned staff member ----
const due = new Date(Date.now() + 3 * 86_400_000).toISOString();
const task = await owner.request.post(BASE + "/api/items", { data: { kind: "TASK", body: wrap("n"), clientId: ben.id, dueAt: due, reminders: [{ amount: 1, unit: "day" }], remindTeam: true, keyFingerprint: fp } });
const general = await owner.request.post(BASE + "/api/items", { data: { kind: "TASK", body: wrap("n"), dueAt: due, reminders: [{ amount: 1, unit: "day" }], remindTeam: true, keyFingerprint: fp } });
const ids = [(await task.json()).item.id, (await general.json()).item.id];
await prisma.reminder.updateMany({ where: { itemId: { in: ids }, sentAt: null }, data: { sendAt: new Date(Date.now() - 60_000) } });
const before4 = outbox().length;
const run = await owner.request.get(BASE + "/api/cron/reminders", { headers: { authorization: `Bearer ${CRON}` } });
ok("reminder job ran", run.ok(), String(run.status()));
const reminders = outbox().slice(before4);
const benReminders = reminders.filter((m) => m.subject.startsWith("Ben:")).map((m) => m.to);
const generalReminders = reminders.filter((m) => m.subject.startsWith("A to-do on your list")).map((m) => m.to).sort();
ok("Ben's to-do reminder goes only to Bob", benReminders.length === 1 && benReminders[0] === bobUser.email, benReminders.join());
ok("a general to-do reminder still goes to the whole team", generalReminders.length === 3, generalReminders.join());

// ---- Team overview: owner/admin only ----
const ownerUser = await prisma.user.findUnique({ where: { email: `sa-owner${stamp}@example.com` } });
const cell = async (page, row, col) => (await page.textContent(`[data-testid=stats-${row}] [data-col=${col}]`))?.trim();
await amy.goto(BASE + "/team");
// Staff get their own Team page (who's on the team, what they can do), never the overview's numbers.
ok("staff see the staff Team page, not the Team overview", !!(await amy.waitForSelector("[data-testid=staff-team]", { timeout: 10000 }).catch(() => null)) && !(await amy.isVisible("[data-testid=team-stats]")));
ok("staff have no Billing or Branding links", (await amy.locator("a[href='/settings/billing'], a[href='/settings/branding']").count()) === 0);
ok("staff can't change team email preferences", (await status(amy.request.patch(BASE + "/api/team/prefs", { data: { replyNotify: "ALL" } }))) === 403);
ok("staff can't send staff reminders", (await status(amy.request.post(BASE + "/api/team/notices", { data: { to: "all", message: "hi" } }))) === 403);
ok("staff can't bulk-assign clients", (await status(amy.request.post(BASE + "/api/clients/assign", { data: { clientIds: [ben.id], assignedToId: amyUser.id } }))) === 403);

// Monitoring. Known state: videos to clients by owner (Ben, Sha), Bob (Ben), Amy (Ana, a copy to Ana, Sha);
// Zed has no video; Sha's replies to Amy's and the owner's videos are unanswered; Bob answered Ben.
await prisma.item.update({ where: { id: ids[0] }, data: { dueAt: new Date(Date.now() - 86_400_000) } }); // Ben's to-do is now overdue
await prisma.video.update({ where: { id: vOwnerSha }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000), sentAt: new Date(Date.now() - 40 * 86_400_000) } });
await owner.goto(BASE + "/team?days=30");
await owner.waitForSelector("[data-testid=team-stats]");
ok("owner has an Overview link", await owner.isVisible("nav >> a[href='/team']"));
ok("videos sent in 30 days per staff member", (await cell(owner, ownerUser.id, "sent")) === "1" && (await cell(owner, bobUser.id, "sent")) === "1" && (await cell(owner, amyUser.id, "sent")) === "3" && (await cell(owner, "all", "sent")) === "5",
  [await cell(owner, ownerUser.id, "sent"), await cell(owner, bobUser.id, "sent"), await cell(owner, amyUser.id, "sent"), await cell(owner, "all", "sent")].join());
// Zed was added today and has had no video yet: listed under No video yet, not counted as neglected (S27).
ok("a client added today isn't counted as quiet", (await cell(owner, amyUser.id, "stale")) === "0" && (await cell(owner, "all", "stale")) === "0");
ok("but listed under No video yet", (await owner.locator(`[data-testid=no-video-yet] a[href='/clients/${added.client.id}']`).count()) === 1);
ok("one time control: no separate no-video box (S28)", (await owner.locator("input#stale, input[name=stale]").count()) === 0 && (await owner.locator("[data-testid=team-stats] th", { hasText: "no video in 30d" }).count()) === 1);
ok("unanswered replies per staff member", (await cell(owner, amyUser.id, "unanswered")) === "1" && (await cell(owner, ownerUser.id, "unanswered")) === "1" && (await cell(owner, bobUser.id, "unanswered")) === "0" && (await cell(owner, "all", "unanswered")) === "2");
ok("average reply time only where someone answered", (await cell(owner, bobUser.id, "avg")) !== "–" && (await cell(owner, amyUser.id, "avg")) === "–" && (await cell(owner, "all", "avg")) !== "–");
ok("overdue to-dos counted for the assigned staff member", (await cell(owner, bobUser.id, "overdue")) === "1" && (await cell(owner, "all", "overdue")) === "1");
const waiting = await owner.textContent("[data-testid=unanswered]");
ok("waiting list links to each conversation", (await owner.locator(`[data-testid=unanswered] a[href='/v/${vAmySha}']`).count()) === 1 && waiting.includes("Sha"));
// Added 40 days ago and still no video: that is quiet (the period sets both).
await prisma.client.update({ where: { id: added.client.id }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
await owner.goto(BASE + "/team?days=30");
await owner.waitForSelector("[data-testid=team-stats]");
ok("a client added 40 days ago with no video counts as quiet for Amy", (await cell(owner, amyUser.id, "stale")) === "1" && (await cell(owner, "all", "stale")) === "1");
ok("and says since when", (await owner.textContent("[data-testid=overdue]")).includes("no video since they were added"));
await owner.goto(BASE + "/team?days=90");
await owner.waitForSelector("[data-testid=team-stats]");
ok("a longer period counts the older video", (await cell(owner, ownerUser.id, "sent")) === "2" && (await cell(owner, "all", "sent")) === "6");
// A former team member's sends get their own row, so the column adds up (S81).
await prisma.video.update({ where: { id: vOwnerSha }, data: { formerStaffAt: new Date() } });
await owner.goto(BASE + "/team?days=90");
await owner.waitForSelector("[data-testid=team-stats]");
ok("former team members have their own Videos sent row (S81)", (await cell(owner, "former", "sent")) === "1" && (await cell(owner, ownerUser.id, "sent")) === "1" && (await cell(owner, "all", "sent")) === "6" && (await cell(owner, "former", "unanswered")) === "–",
  [await cell(owner, "former", "sent"), await cell(owner, ownerUser.id, "sent"), await cell(owner, "all", "sent")].join());
await prisma.video.update({ where: { id: vOwnerSha }, data: { formerStaffAt: null } });
// One they recorded and never sent: the library says it can go.
const leftover = await prisma.video.create({ data: { id: `left${stamp.toString(36)}`, title: "Leftover", mimeType: "video/webm", storageKey: `test/${stamp}/leftover`, status: "UPLOADED", workspaceId, ownerId: ownerUser.id, formerStaffAt: new Date() } });
await owner.goto(BASE + "/library");
const unsentNote = await owner.waitForSelector("[data-testid=video-former-unsent]", { timeout: 15000 }).catch(() => null);
ok("library: a former member's never-sent recording says it can be deleted (S81)", !!unsentNote && (await unsentNote.textContent()).includes("Never sent. Delete it from its page if it isn't needed."));
await prisma.video.delete({ where: { id: leftover.id } });
await owner.goto(BASE + "/team?days=30");
await owner.screenshot({ path: `${shots}/team-overview.png`, fullPage: true });

// Bulk reassign from the overview.
await owner.check(`input[aria-label="Pick Zed"]`);
await owner.check(`input[aria-label="Pick Sha"]`);
await owner.selectOption('select[aria-label="Assign picked clients to"]', bobUser.id);
await owner.click("button:has-text('Assign 2 clients')");
await owner.waitForSelector("text=2 clients now with");
ok("bulk reassign moves both clients", (await prisma.client.count({ where: { id: { in: [added.client.id, sha.id] }, assignedToId: bobUser.id } })) === 2);
ok("and Amy loses access to Zed straight away", (await status(amy.request.get(`${BASE}/api/items?clientId=${added.client.id}`))) === 404);
await owner.request.post(BASE + "/api/clients/assign", { data: { clientIds: [added.client.id], assignedToId: amyUser.id } });
await owner.request.post(BASE + "/api/clients/assign", { data: { clientIds: [sha.id], assignedToId: null } });

// Email preferences decide who hears about client replies.
const mailsTo = (from, who, subject) => outbox().slice(from).filter((m) => m.to === who && m.subject.includes(subject));
const replyAs = async (page, video) => page.request.post(`${BASE}/api/videos/${video}/replies`, { data: { kind: "TEXT", body: "sealed", encrypted: true } });
const anaClient = await clientPage(ana);
const prefs = (data) => owner.request.patch(BASE + "/api/team/prefs", { data });

ok("owner picks 'only selected staff' for replies (Amy's clients)", (await prefs({ replyNotify: "SELECTED", replyNotifyStaff: [amyUser.id] })).ok());
let mark = outbox().length;
await replyAs(benPage, await record(bob, "Bob 2", ben.id));
await waitFor(() => mailsTo(mark, bobUser.email, "Ben replied").length);
await new Promise((r) => setTimeout(r, 1000));
ok("selected staff: a reply from Bob's client skips the owner", mailsTo(mark, bobUser.email, "Ben replied").length === 1 && mailsTo(mark, ownerUser.email, "replied").length === 0);
await prefs({ replyNotify: "SELECTED", replyNotifyStaff: [bobUser.id] });
mark = outbox().length;
await replyAs(benPage, await record(owner, "Owner 3", ben.id));
ok("selected staff: with Bob picked the owner hears too", !!(await waitFor(() => mailsTo(mark, ownerUser.email, "Ben replied").length)) && mailsTo(mark, bobUser.email, "Ben replied").length === 1);
await prefs({ replyNotify: "OFF" });
mark = outbox().length;
await replyAs(shaPage, await record(owner, "Owner 4", sha.id));
await new Promise((r) => setTimeout(r, 2000));
ok("off: no reply email for the owner, even for their own video", mailsTo(mark, ownerUser.email, "replied").length === 0);
await prefs({ replyNotify: "ALL" });
mark = outbox().length;
await replyAs(anaClient, await record(amy, "Amy 5", ana.id));
ok("all staff: the owner hears about Amy's client too", !!(await waitFor(() => mailsTo(mark, ownerUser.email, "Ana replied").length)) && mailsTo(mark, amyUser.email, "Ana replied").length === 1);
await prefs({ replyNotify: "MINE" });
// With "Only my own clients" (the default), the Team page says so once (S66).
await owner.goto(BASE + "/team");
const scopeHint = await owner.waitForSelector("[data-testid=replies-scope-hint]", { timeout: 10000 }).catch(() => null);
ok("Team page: 'only your own clients' replies hint, with a way to change it (S66)", !!scopeHint && (await scopeHint.textContent()).includes("only emailed about replies from your own clients") && (await owner.locator("[data-testid=replies-scope-hint] a[href='/settings/account#emails']").count()) === 1);
await owner.click("[data-testid=replies-scope-hint] >> text=Got it");
await owner.reload();
await owner.waitForSelector("[data-testid=team-stats]");
await owner.waitForTimeout(800); // the hint checks this browser's dismissal after the page loads
ok("once dismissed it stays away", (await owner.locator("[data-testid=replies-scope-hint]").count()) === 0);

// "Tell me when they send a video", set with the owner's own email settings (Settings > Account).
await owner.goto(BASE + "/settings/account#emails");
await owner.check('input[name="sentNotify"] >> nth=1'); // Only selected staff
await owner.check(`input[aria-label="Tell me when sa-bob${stamp} sends a video"]`);
await waitFor(async () => (await prisma.membership.findFirst({ where: { userId: ownerUser.id, workspaceId } })).sentNotifyStaff.includes(bobUser.id));
const ownerPrefs = await prisma.membership.findFirst({ where: { userId: ownerUser.id, workspaceId } });
ok("owner turns on 'Tell me when Bob sends a video'", ownerPrefs.sentNotify === "SELECTED" && ownerPrefs.sentNotifyStaff.join() === bobUser.id);
mark = outbox().length;
await record(amy, "Amy 6", ana.id);
await record(bob, "Bob 6", ben.id);
const sentMail = await waitFor(() => mailsTo(mark, ownerUser.email, "sent a video").at(0));
await new Promise((r) => setTimeout(r, 1000));
ok("Bob's send emails the owner, Amy's doesn't", sentMail?.subject === `sa-bob${stamp} sent a video to clients` && mailsTo(mark, ownerUser.email, "sent").length === 1, JSON.stringify(outbox().slice(mark).map((m) => [m.to, m.subject])));
ok("the email names the client and links the video, not its title", sentMail.text.includes("Ben") && !sentMail.text.includes("Bob 6"));
await record(bob, "Bob 7", ben.id);
await record(bob, "Bob 8", ben.id);
await new Promise((r) => setTimeout(r, 1500));
ok("more sends within 15 minutes wait", mailsTo(mark, ownerUser.email, "sent").length === 1);
await prisma.notifyThrottle.updateMany({ where: { key: { startsWith: `VIDEO_SENT:${ownerUser.id}:` } }, data: { lastSentAt: new Date(Date.now() - 16 * 60_000) } });
const flush = await (await owner.request.get(BASE + "/api/cron/reminders", { headers: { authorization: `Bearer ${CRON}` } })).json();
const digest = mailsTo(mark, ownerUser.email, "sent 2 videos");
ok("then go out together as one digest", flush.digests >= 1 && digest.length === 1 && mailsTo(mark, ownerUser.email, "sent").length === 2, JSON.stringify(flush));

// Reminders to staff.
ok("a link must open for everyone it's sent to", (await status(owner.request.post(BASE + "/api/team/notices", { data: { to: [amyUser.id], message: "Check Ben", link: { kind: "client", id: ben.id } } }))) === 400);
await owner.goto(BASE + "/team");
ok("an empty reminder says both what's missing (S61)", (await owner.textContent("[data-testid=remind-missing]")) === "Pick who to remind and write a message.");
await owner.check(`input[aria-label="Remind sa-amy${stamp}"]`);
ok("after picking someone, it says only the message is missing", (await owner.textContent("[data-testid=remind-missing]")) === "Write a message.");
await owner.fill('textarea[aria-label="Reminder message"]', "Please send Ana her plan by Friday");
await owner.selectOption('select[aria-label="Link to"]', `client:${ana.id}`);
mark = outbox().length;
await owner.click("button:has-text('Send reminder')");
await owner.waitForSelector("text=Sent to 1 person");
const remMail = await waitFor(() => mailsTo(mark, amyUser.email, "Reminder from").at(0));
ok("staff reminder is emailed", remMail?.text.includes("Please send Ana her plan by Friday") && remMail.text.includes(`/clients/${ana.id}`) && remMail.from.startsWith("SureFrame <"));
ok("only to the people chosen", mailsTo(mark, bobUser.email, "Reminder").length === 0);
await amy.goto(BASE + "/library");
const notice = await amy.waitForSelector("[data-testid=staff-notice]", { timeout: 10000 }).catch(() => null);
ok("staff member sees the reminder in the app", !!notice && (await notice.textContent()).includes("Please send Ana her plan by Friday"));
await amy.screenshot({ path: `${shots}/staff-notice.png`, fullPage: true });
await amy.goto(BASE + "/clients");
ok("it stays until dismissed", !!(await amy.waitForSelector("[data-testid=staff-notice]", { timeout: 10000 }).catch(() => null)));
await amy.click("[data-testid=staff-notice] >> text=Dismiss");
await waitFor(async () => (await prisma.staffNotice.findFirst({ where: { toUserId: amyUser.id } }))?.dismissedAt);
await amy.reload();
await amy.waitForSelector("text=Ana");
ok("dismissed reminders are gone", !(await amy.isVisible("[data-testid=staff-notice]")));
ok("Bob can't dismiss Amy's reminder", (await status(bob.request.post(`${BASE}/api/team/notices/${(await prisma.staffNotice.findFirst({ where: { toUserId: amyUser.id } })).id}/dismiss`))) === 404);
const allRes = await owner.request.post(BASE + "/api/team/notices", { data: { to: "all", message: "Team meeting at 9" } });
ok("a reminder to all staff reaches everyone else", (await allRes.json()).sent === 2);
await owner.goto(BASE + "/team");
const history = await owner.textContent("[data-testid=notice-history]");
ok("history lists sent reminders and whether they were dismissed", history.includes("Please send Ana her plan by Friday") && history.includes("Seen and dismissed") && history.includes("Team meeting at 9"));
// One sent to someone who has since left the team (S88): it never will be dismissed, so it says they've gone.
const goneUser = await prisma.user.create({ data: { email: `sa-gone${stamp}@example.com`, name: "Gone Person" } });
await prisma.staffNotice.create({ data: { workspaceId, fromUserId: ownerUser.id, toUserId: goneUser.id, message: "Before you left" } });
await owner.reload();
const goneRow = await owner.textContent("[data-testid=notice-history] li:has-text('Before you left')");
ok("a reminder to someone no longer on the team says so, not 'Not dismissed yet' (S88)", goneRow.includes("No longer on the team") && !goneRow.includes("Not dismissed yet"), goneRow);

// ---- Display name ----
// Dev sign-in fills in a name from the email; email-link users start with none.
await prisma.user.update({ where: { id: amyUser.id }, data: { name: null } });
await amy.goto(BASE + "/library");
ok("Amy is asked for her name (non-blocking)", !!(await amy.waitForSelector("[data-testid=name-prompt]", { timeout: 10000 }).catch(() => null)));
await amy.screenshot({ path: `${shots}/name-prompt.png`, fullPage: true });
await amy.goto(BASE + "/settings/account");
await amy.fill('input[aria-label="Your name"]', "Amy Lee");
await amy.click("text=Save name");
await amy.waitForURL((u) => u.searchParams.get("saved") === "name");
ok("Amy's name is saved", (await prisma.user.findUnique({ where: { id: amyUser.id } })).name === "Amy Lee");
await amy.goto(BASE + "/library");
ok("the name prompt is gone once set", !(await amy.isVisible("[data-testid=name-prompt]")));
// This test client's key is never really held here; mark it held so the inbox lists its videos (lib/e2e/keyHeld.ts).
await anaClient.context().addCookies([{ name: `fc_key_${ana.id}`, value: "1", url: BASE }]);
await anaClient.goto(BASE + "/inbox");
// Past the loading screen and the key check ("One moment…").
await anaClient.waitForFunction(() => !document.querySelector("main")?.textContent?.includes("One moment"), null, { timeout: 15000 }).catch(() => {});
const inbox = await anaClient.textContent("main");
ok("client inbox shows 'Amy Lee from Business'", inbox.includes(`Amy Lee from Peak ${stamp}`), inbox);
ok("client inbox never shows staff emails", ![amyUser.email, bobUser.email, `sa-owner${stamp}@example.com`].some((e) => inbox.includes(e)));

// ---- Existing data keeps working: the owner's view and old rows untouched ----
const ownerM = await prisma.membership.findFirst({ where: { workspaceId, role: "OWNER" } });
ok("owner membership unaffected", ownerM.userId === (await prisma.user.findUnique({ where: { email: `sa-owner${stamp}@example.com` } })).id);
await owner.goto(BASE + "/clients");
await owner.waitForSelector("a:has-text('Sha')");
const counts = await Promise.all(["Ana", "Ben", "Sha", "Zed"].map((n) => owner.locator(`a:has-text('${n}')`).count()));
ok("owner's Clients page lists everyone", counts.every((n) => n > 0), counts.join());
await owner.goto(BASE + "/library");
// Older videos are in folders whose videos are only drawn once opened: open them all.
for (let i = 0; i < 20; i++) {
  const closed = owner.locator("main details:not([open]) > summary").first();
  if (!(await closed.count())) break;
  await closed.click();
  await owner.waitForTimeout(150);
}
const ownerLib = await owner.textContent("main");
ok("owner's library lists every video", ["Owner to Ben", "Bob to Ben", "Amy draft", "Owner to Sha"].every((t) => ownerLib.includes(t)));

await browser.close();
server.close();
await prisma.$disconnect();
