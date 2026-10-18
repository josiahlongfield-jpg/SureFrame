// Removed clients: their link stops and their seat is freed at once, everything is kept 30 days so the
// business can restore them, then it's deleted for good (files first, then rows). Covers the confirm
// box, the optional email to the client, the access-ended notice, Removed clients and Restore (seats,
// new link after a key reset), the watch page and Library, the 3-day warning, earlier removals with no
// date (dated, one owner notice, never deleted straight away) and the purge itself.
// Needs the app running with AUTH_DEV_LOGIN=true, local file storage (no S3_BUCKET), no RESEND_API_KEY
// (mail goes to .data/outbox) and CRON_SECRET.
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret";
const shots = process.argv[2] ?? "/tmp";
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};
const D = 86_400_000;
const stamp = Date.now();
const outbox = () => (existsSync(".data/outbox") ? readdirSync(".data/outbox").sort().map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8"))) : []);
const mailTo = (to) => outbox().filter((m) => m.to === to);
async function waitMail(to, pred = () => true, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
    const m = mailTo(to).find(pred);
    if (m) return m;
  }
  return null;
}
const cron = async (p = "reminders") => {
  const r = await fetch(`${BASE}/api/cron/${p}`, { headers: { Authorization: `Bearer ${CRON}` } });
  return r.status === 200 ? r.json() : { status: r.status };
};
const longDay = (d, timeZone) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone }).format(d);
const shortDay = (d, timeZone) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(d);
const norm = (s) => (s ?? "").replace(/[\s  ]+/g, " ").trim();

// Local storage driver: files live under .data/uploads/<key>.
const uploads = path.resolve(".data/uploads");
const putFile = (key) => {
  mkdirSync(path.dirname(path.join(uploads, key)), { recursive: true });
  writeFileSync(path.join(uploads, key), "encrypted bytes");
};
const has = (p) => existsSync(path.join(uploads, p));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
async function signIn(email, next = "/library") {
  // Agreed to the current Terms and Privacy Policy, so signing in isn't stopped at /agree (e2e/agree.mjs).
  await agreed(email);
  const page = await (await browser.newContext({ timezoneId: "Australia/Brisbane", viewport: { width: 1360, height: 1000 } })).newPage();
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname === next.split("?")[0], { timeout: 60000 });
  // The address bar can change before the server has rendered the page (and made a new account's workspace): wait for it.
  await page.waitForSelector("main", { timeout: 60000 });
  return page;
}
const status = async (p) => (await p).status();

// =====================================================================================================
// Part 1: a Free workspace (3 client seats): remove, the client's side, seats and restore.
// =====================================================================================================
const TZ = "Australia/Brisbane";
const ownerEmail = `rm-owner${stamp}@example.com`;
const owner = await signIn(ownerEmail, "/clients");
const ownerUser = await prisma.user.findUnique({ where: { email: ownerEmail } });
const ws = (await prisma.membership.findFirst({ where: { userId: ownerUser.id, role: "OWNER" } })).workspaceId;
const business = `Peak ${stamp}`;
await prisma.workspace.update({ where: { id: ws }, data: { name: business, timezone: TZ } });
const mk = (wsId, name, email, i, data = {}) =>
  prisma.client.create({ data: { name, email, token: `rm-${stamp}-${wsId.slice(-4)}-${i}-${"x".repeat(20)}`, workspaceId: wsId, createdAt: new Date(Date.now() - (50 - i) * 60000), ...data } });
const ana = await mk(ws, `Ana ${stamp}`, `ana${stamp}@example.com`, 0);
const ben = await mk(ws, `Ben ${stamp}`, `ben${stamp}@example.com`, 1);
const cal = await mk(ws, `Cal ${stamp}`, null, 2);
const anaVideo = await prisma.video.create({ data: { id: `rma${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/ana`, status: "UPLOADED", workspaceId: ws, ownerId: ownerUser.id, clientId: ana.id } });

// Ana has opened her link on her own device before.
const anaPage = await (await browser.newContext({ timezoneId: "Australia/Brisbane" })).newPage();
await anaPage.goto(`${BASE}/c/${ana.token}`);
ok("before: Ana's link opens her inbox", new URL(anaPage.url()).pathname === "/inbox" && !new URL(anaPage.url()).searchParams.get("removed"));

// ---- The confirm box ----
await owner.goto(BASE + "/clients");
await owner.waitForSelector(`text=Cal ${stamp}`, { timeout: 30000 });
await owner.click(`li:has-text("Cal ${stamp}") >> button:text-is("Remove client")`);
await owner.waitForSelector("[data-testid=remove-client-confirm]");
ok("no email box for a client without an email address", (await owner.locator("[data-testid=remove-client-email]").count()) === 0);
await owner.click("[data-testid=remove-client-confirm] >> button:text-is('Cancel')");
ok("cancel closes the box and removes nobody", (await owner.locator("[data-testid=remove-client-confirm]").count()) === 0 && !(await prisma.client.findUnique({ where: { id: cal.id } })).removedAt);

await owner.click(`li:has-text("Ana ${stamp}") >> button:text-is("Remove client")`);
const panel = await owner.waitForSelector("[data-testid=remove-client-confirm]");
const until = longDay(new Date(Date.now() + 30 * D), TZ);
const ptext = norm(await panel.textContent());
ok("box: link stops now, seat freed", ptext.includes(`Remove Ana ${stamp}? Their personal link stops working now and their seat is freed.`), ptext);
ok("box: kept until the date, restorable from Removed clients", ptext.includes(`restore them from Removed clients on this page until ${until}`) && ptext.includes(`kept until ${until}, so you can restore them from Removed clients`), ptext);
ok("box: the detail sits behind \"What happens to their data?\"", !(await owner.isVisible("[data-testid=remove-client-details] li >> nth=0")));
ok("box: then deleted for good, replies included, shared recordings stay", ptext.includes("deleted for good, including your team's replies to them, even with cloud backup on") && ptext.includes("Recordings you also sent to other clients stay with those clients"), ptext);
ok("box: without cloud backup, recordings still leave on their own dates", ptext.includes("Recordings without cloud backup still leave our servers on their usual dates, and restoring doesn't bring those back."), ptext);
ok("box: 'Email Ana that their access has ended' is ticked", ptext.includes(`Email Ana ${stamp} that their access has ended`) && (await owner.isChecked("[data-testid=remove-client-email]")));
ok("no browser confirm() any more", (await owner.locator(`[data-testid=remove-client-confirm] >> button:text-is('Remove Ana ${stamp}')`).count()) === 1);
await owner.screenshot({ path: `${shots}/client-removal-confirm.png`, fullPage: true });
await owner.click(`[data-testid=remove-client-confirm] >> button:text-is('Remove Ana ${stamp}')`);
await owner.waitForSelector("[data-testid=clients-notice]");
ok("after removing: says until when they can be restored", norm(await owner.textContent("[data-testid=clients-notice]")) === `Ana ${stamp} removed. You can restore them until ${until}.`);
ok("Removed clients lists Ana with Restore", (await owner.textContent("[data-testid=removed-clients]")).includes(`Ana ${stamp}`) && (await owner.locator("[data-testid=restore-client]").count()) === 1);
await owner.screenshot({ path: `${shots}/client-removal-list.png`, fullPage: true });

const anaRow = await prisma.client.findUnique({ where: { id: ana.id } });
ok("removed: removedAt set, purgeAt removedAt + 30 days", !!anaRow.removedAt && anaRow.purgeAt?.getTime() === anaRow.removedAt.getTime() + 30 * D, JSON.stringify(anaRow));
ok("removed: records who removed them", anaRow.removedById === ownerUser.id);
const seats1 = (await (await owner.request.get(BASE + "/api/clients")).json()).seats;
ok("removed: seat freed", seats1.used === 2 && seats1.limit === 3, JSON.stringify(seats1));

// ---- The client's email (ticked) ----
const gone = await waitMail(ana.email, (m) => m.subject === `Your access to ${business} on SureFrame has ended`);
ok("client emailed that their access ended", !!gone);
ok("email: says who and until when, no link or button", !!gone && gone.text.includes(`${business} has ended your access`) && gone.text.includes(`restore your access until ${until}`) && !gone.text.includes("/c/") && !gone.html.includes("<a "), gone?.text);
ok("email: from the business, deleted afterwards", !!gone && gone.from.includes(business) && gone.text.includes("deleted for good"));

// ---- The client's side ----
const fresh = await (await browser.newContext({ timezoneId: "Australia/Brisbane" })).newPage();
await fresh.goto(`${BASE}/c/${ana.token}`);
ok("old link: lands on the access-ended notice (not 'invalid')", new URL(fresh.url()).searchParams.get("removed") === "1" && !new URL(fresh.url()).searchParams.get("invalid"));
const note = norm(await fresh.textContent("[data-testid=client-removed]").catch(() => ""));
ok("notice: names the business and the date", note.includes(`${business} has ended your access`) && note.includes(`restore it until ${until}`), note);
ok("old link: remembers nothing on this device", !(await fresh.context().cookies()).some((c) => c.name.startsWith("fc_client_")));
await fresh.screenshot({ path: `${shots}/client-removal-notice.png`, fullPage: true });
await anaPage.goto(BASE + "/inbox");
ok("Ana's own device: inbox shows the notice", norm(await anaPage.textContent("[data-testid=client-removed]").catch(() => "")).includes(`${business} has ended your access`));
await anaPage.goto(`${BASE}/v/${anaVideo.id}`);
ok("Ana's own device: can't open her video, and is told why", norm(await anaPage.textContent("[data-testid=video-removed]").catch(() => "")).includes(`${business} has ended your access`));
const unknown = await (await browser.newContext({ timezoneId: "Australia/Brisbane" })).newPage();
await unknown.goto(`${BASE}/c/not-a-real-token-${stamp}`);
ok("an unknown link still says invalid", new URL(unknown.url()).searchParams.get("invalid") === "1");

// ---- A due reminder for a removed client is skipped ----
const item = await prisma.item.create({ data: { kind: "TASK", body: "c".repeat(40), dueAt: new Date(Date.now() + 30 * 60000), shared: true, remindClient: true, authorName: "Owner", workspaceId: ws, clientId: ana.id } });
const reminder = await prisma.reminder.create({ data: { itemId: item.id, sendAt: new Date(Date.now() - 60000), to: "CLIENT" } });
const before = mailTo(ana.email).length;
await cron("reminders");
const rem = await prisma.reminder.findUnique({ where: { id: reminder.id } });
ok("due reminder skipped: client removed", !!rem.sentAt && rem.error === "client removed", JSON.stringify(rem));
ok("and nothing emailed to them", mailTo(ana.email).length === before);

// ---- Seats: restore needs a free seat ----
const dee = await mk(ws, `Dee ${stamp}`, `dee${stamp}@example.com`, 3);
const full = await owner.request.post(`${BASE}/api/clients/${ana.id}/restore`);
ok("restore refused with every seat in use (402)", full.status() === 402 && (await full.json()).error === "All 3 client seats are in use. Add seats or remove a client first.");
ok("removing without the box ticked: 204", (await status(owner.request.delete(`${BASE}/api/clients/${dee.id}`))) === 204);
await new Promise((r) => setTimeout(r, 2000));
ok("and the client isn't emailed", mailTo(dee.email).length === 0);
ok("removing twice: 404", (await status(owner.request.delete(`${BASE}/api/clients/${dee.id}`))) === 404);

await owner.goto(BASE + "/clients");
await owner.waitForSelector("[data-testid=removed-clients]", { timeout: 30000 });
await owner.click(`[data-testid=removed-clients] li:has-text("Ana ${stamp}") >> [data-testid=restore-client]`);
await owner.waitForSelector("[data-testid=clients-notice]");
ok("restore: says the same link works again", norm(await owner.textContent("[data-testid=clients-notice]")) === `Ana ${stamp} is back, and their personal link works again.`);
const anaBack = await prisma.client.findUnique({ where: { id: ana.id } });
ok("restore: cleared the removal, kept the same link", !anaBack.removedAt && !anaBack.purgeAt && !anaBack.purgeWarnedAt && !anaBack.removedById && anaBack.token === ana.token);
ok("restore: Ana back in the list, seats 3 of 3", (await owner.textContent("main")).includes("3 of 3 used") && (await owner.locator(`li:has-text("Ana ${stamp}") >> button:text-is("Remove client")`).count()) === 1);
ok("restore: Dee's Restore is off while seats are full", await owner.isDisabled(`[data-testid=removed-clients] li:has-text("Dee ${stamp}") >> [data-testid=restore-client]`));
await anaPage.goto(`${BASE}/c/${ana.token}`);
ok("restore: Ana's link opens her inbox again", new URL(anaPage.url()).pathname === "/inbox" && (await anaPage.locator("[data-testid=client-removed]").count()) === 0);
ok("restoring an active client: 409", (await status(owner.request.post(`${BASE}/api/clients/${ana.id}/restore`))) === 409);

// ---- Restore after a team key reset: new link, emailed ----
ok("remove Ben (box ticked)", (await status(owner.request.delete(`${BASE}/api/clients/${ben.id}?notify=1`))) === 204);
ok("Ben emailed", !!(await waitMail(ben.email, (m) => m.subject.includes("has ended"))));
// Someone left and the team's keys were reset while Ben was removed (his link didn't change then).
await prisma.keyRotation.create({ data: { workspaceId: ws, fromFingerprint: "f".repeat(22), wrap: "w".repeat(60) } });
await owner.goto(BASE + "/clients");
await owner.waitForSelector("[data-testid=removed-clients]", { timeout: 30000 });
await owner.fill("input[aria-label='Client email']", ben.email.toUpperCase());
const hint = norm(await owner.textContent("[data-testid=removed-match]").catch(() => ""));
ok("adding someone removed: hint to restore instead", hint.startsWith(`Ben ${stamp} was removed on`) && hint.includes("Restore them instead to keep their history"), hint);
await owner.click(`[data-testid=removed-match] >> button:text-is('Restore Ben ${stamp}')`);
await owner.waitForSelector("[data-testid=clients-notice]");
ok("restore after a key reset: says they have a new link, emailed", norm(await owner.textContent("[data-testid=clients-notice]")).includes("so they have a new personal link, which we've emailed to them"));
const benBack = await prisma.client.findUnique({ where: { id: ben.id } });
ok("restore after a key reset: the link changed", !benBack.removedAt && benBack.token !== ben.token);
const newLink = await waitMail(ben.email, (m) => m.subject === `${business} sent you a new private link`);
ok("restore after a key reset: new link emailed", !!newLink && newLink.text.includes(`/c/${benBack.token}`) && !newLink.text.includes(ben.token));
const oldBen = await (await browser.newContext({ timezoneId: "Australia/Brisbane" })).newPage();
await oldBen.goto(`${BASE}/c/${ben.token}`);
ok("restore after a key reset: the old link no longer works", new URL(oldBen.url()).searchParams.get("invalid") === "1");

// =====================================================================================================
// Part 2: a Studio workspace: the team's view, members, the warning, earlier removals and the purge.
// =====================================================================================================
const owner2Email = `rm-owner2-${stamp}@example.com`;
const owner2 = await signIn(owner2Email, "/clients");
await owner2.waitForSelector("[data-recovery-key]", { timeout: 30000 });
const recoveryKey = await owner2.getAttribute("[data-recovery-key]", "data-recovery-key");
const owner2User = await prisma.user.findUnique({ where: { email: owner2Email } });
const ws2 = (await prisma.membership.findFirst({ where: { userId: owner2User.id, role: "OWNER" } })).workspaceId;
const business2 = `Lake ${stamp}`;
await prisma.workspace.update({ where: { id: ws2 }, data: { name: business2, plan: "STUDIO", timezone: null, videosRecorded: 7 } });
const adminEmail = `rm-admin${stamp}@example.com`;
const memberEmail = `rm-member${stamp}@example.com`;
const admin2 = await prisma.user.create({ data: { email: adminEmail, activeWorkspaceId: ws2, memberships: { create: { workspaceId: ws2, role: "ADMIN" } } } });
const member2 = await prisma.user.create({ data: { email: memberEmail, activeWorkspaceId: ws2, memberships: { create: { workspaceId: ws2, role: "MEMBER", seeAllClients: true } } } });

// Video keys wrapped with the team key, as the app does (AES-GCM, iv || ciphertext, base64url).
const subtle = globalThis.crypto.subtle;
const b64url = (b) => Buffer.from(b).toString("base64url");
const teamKey = await subtle.importKey("raw", Buffer.from(recoveryKey, "base64url"), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
async function wrapped() {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, teamKey, raw));
  return b64url(Buffer.concat([iv, ct]));
}

const ago = (days) => new Date(Date.now() - days * D);
const xan = await mk(ws2, `Xan ${stamp}`, `xan${stamp}@example.com`, 10, { removedAt: ago(10), purgeAt: new Date(Date.now() + 20 * D), removedById: admin2.id });
const bea = await mk(ws2, `Bea ${stamp}`, `bea${stamp}@example.com`, 11);
const wes = await mk(ws2, `Wes ${stamp}`, null, 12, { removedAt: ago(28), purgeAt: new Date(Date.now() + 2 * D), removedById: admin2.id });
const zed = await mk(ws2, `Zed ${stamp}`, null, 13, { removedAt: ago(5), purgeAt: new Date(Date.now() + 25 * D), removedById: owner2User.id });
// Removed by someone who was an admin then and is staff now: still told, but can't restore them.
const vic = await mk(ws2, `Vic ${stamp}`, null, 16, { removedAt: ago(28), purgeAt: new Date(Date.now() + 2.5 * D), removedById: member2.id });

let n = 0;
const vid = async (data, file = true) => {
  const key = `test/${stamp}/v${n++}`;
  if (file) putFile(key);
  return prisma.video.create({
    data: { id: `rm${stamp.toString(36)}${n}`, mimeType: "video/webm", storageKey: key, status: "UPLOADED", encrypted: true, teamKeyWrap: await wrapped(), workspaceId: ws2, ownerId: owner2User.id, title: `Title ${n}`, ...data },
  });
};
const reply = (videoId, data = {}) => prisma.reply.create({ data: { kind: "TEXT", body: "sealed", encrypted: true, authorName: "Someone", videoId, ...data } });
const mediaFor = async (conv, data = {}) => {
  const m = await vid({ replyToId: conv.id, title: "Reply", clientKeyWrap: null, ...data }, data.status !== "RECORDING");
  await reply(conv.id, { kind: "VIDEO", mediaId: m.id, body: null });
  return m;
};
// O1: sent to Xan and copied to Bea (stays with Bea).
const o1 = await vid({ clientId: xan.id, clientKeyWrap: "k".repeat(60), sentAt: ago(9), viewCount: 3 });
const c1 = await vid({ clientId: bea.id, sourceId: o1.id, storageKey: o1.storageKey, clientKeyWrap: "k".repeat(60) }, false);
await reply(o1.id, { authorName: "Xan" });
const m1 = await mediaFor(o1);
await prisma.reaction.create({ data: { emoji: "👍", videoId: o1.id } });
await prisma.videoInsight.create({ data: { videoId: o1.id, transcript: "sealed transcript" } });
const c1Reply = await reply(c1.id, { authorName: "Bea" });
// D1: sent only to Xan, with a team reply recording and one still uploading.
const d1 = await vid({ clientId: xan.id });
const md1 = await mediaFor(d1, { ownerId: owner2User.id });
const mr = await mediaFor(d1, { status: "RECORDING" });
mkdirSync(path.join(uploads, `${mr.storageKey}.parts`), { recursive: true });
writeFileSync(path.join(uploads, `${mr.storageKey}.parts`, "1"), "part");
// O2: sent to Bea, with a copy C2 sent to Xan (C2 goes, the shared file stays).
const o2 = await vid({ clientId: bea.id });
const c2 = await vid({ clientId: xan.id, sourceId: o2.id, storageKey: o2.storageKey }, false);
const mc2 = await mediaFor(c2);
// E1: already deleted from our servers.
const e1 = await vid({ clientId: xan.id, status: "EXPIRED" }, false);
// Rows that point at Xan.
const xItem = await prisma.item.create({ data: { kind: "NOTE", body: "n".repeat(40), authorName: "Owner", workspaceId: ws2, clientId: xan.id } });
const xTask = await prisma.item.create({ data: { kind: "TASK", body: "t".repeat(40), dueAt: new Date(Date.now() + 40 * D), authorName: "Owner", workspaceId: ws2, clientId: xan.id } });
await prisma.reminder.create({ data: { itemId: xTask.id, sendAt: new Date(Date.now() + 39 * D), to: "TEAM" } });
await prisma.keyRotation.create({ data: { workspaceId: ws2, clientId: xan.id, fromFingerprint: "a".repeat(22), wrap: "b".repeat(60) } });
await prisma.teamNotification.create({ data: { kind: "CLIENT_REPLY", userId: owner2User.id, workspaceId: ws2, groupKey: `g${stamp}`, clientId: xan.id, videoId: d1.id } });
const noticeClient = await prisma.staffNotice.create({ data: { workspaceId: ws2, fromUserId: owner2User.id, toUserId: admin2.id, message: "Call them", link: `/clients/${xan.id}`, linkLabel: xan.name } });
const noticeDrop = await prisma.staffNotice.create({ data: { workspaceId: ws2, fromUserId: owner2User.id, toUserId: admin2.id, message: "Watch", link: `/v/${d1.id}`, linkLabel: "Title" } });
const noticeKeep = await prisma.staffNotice.create({ data: { workspaceId: ws2, fromUserId: owner2User.id, toUserId: admin2.id, message: "Watch", link: `/v/${o1.id}`, linkLabel: "Title" } });
const beaItem = await prisma.item.create({ data: { kind: "NOTE", body: "b".repeat(40), authorName: "Owner", workspaceId: ws2, clientId: bea.id } });

// ---- The team's view while Xan is removed ----
// The owner's browser runs in Brisbane, so pages show its dates, and the business took on that zone for emails (components/TimeZoneSync.tsx).
const xanUntil = longDay(xan.purgeAt, TZ);
await owner2.goto(`${BASE}/v/${o1.id}`);
const banner1 = norm(await owner2.textContent("[data-testid=recipient-removed]", { timeout: 30000 }).catch(() => ""));
ok("watch page: removed client and date (recording also sent to others stays)", banner1.includes(`Xan ${stamp} was removed from your clients`) && banner1.includes(`Their conversation here will be deleted on ${xanUntil}`) && banner1.includes("The recording itself stays, as you also sent it to other clients"), banner1);
const xanRow = norm(await owner2.textContent("[data-testid=sent-row]:has-text('Xan')").catch(() => ""));
ok("watch page: no 'send their link' for a removed client", xanRow.includes(`Xan ${stamp} was removed from your clients, so their link no longer opens this.`) && !/First time/.test(xanRow) && !/Copy link/.test(xanRow), xanRow);
await owner2.screenshot({ path: `${shots}/client-removal-watch.png`, fullPage: true });
await owner2.goto(`${BASE}/v/${d1.id}`);
const banner2 = norm(await owner2.textContent("[data-testid=recipient-removed]", { timeout: 30000 }).catch(() => ""));
ok("watch page: a recording sent only to them is deleted with them", banner2.includes(`This conversation and recording will be deleted on ${xanUntil} unless Xan ${stamp} is restored`), banner2);
// One that expires (no cloud backup) before the client is deleted: the banner doesn't promise the recording until then.
await prisma.video.update({ where: { id: d1.id }, data: { purgeAt: new Date(Date.now() + 5 * D) } });
await owner2.reload();
const banner2b = norm(await owner2.textContent("[data-testid=recipient-removed]", { timeout: 30000 }).catch(() => ""));
ok("watch page: a recording expiring first isn't said to be kept until the client's date", banner2b.includes(`This conversation will be deleted on ${xanUntil} unless Xan ${stamp} is restored`) && !banner2b.includes("and recording"), banner2b);
await prisma.video.update({ where: { id: d1.id }, data: { purgeAt: null } });
await owner2.goto(`${BASE}/v/${c2.id}`);
const banner3 = norm(await owner2.textContent("[data-testid=recipient-removed]", { timeout: 30000 }).catch(() => ""));
ok("watch page: their copy of a recording sent to several clients", banner3.includes(`Their conversation here will be deleted on ${xanUntil}`) && banner3.includes("The recording itself stays"), banner3);
await owner2.goto(`${BASE}/library`);
// The library groups videos by day; open every day's folder.
await owner2.$$eval("[data-testid=day-folder]", (els) => els.forEach((e) => (e.open = true)));
await owner2.waitForSelector("[data-testid=client-removed-badge]", { timeout: 30000 }).catch(() => null);
const badges = await owner2.$$eval("[data-testid=client-removed-badge]", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
ok("Library marks videos of a removed client", badges.length === 3 && badges.every((b) => b === `Client removed · conversation deleted ${shortDay(xan.purgeAt, TZ)}`), JSON.stringify(badges));
await owner2.goto(`${BASE}/clients`);
const removedList = norm(await owner2.textContent("[data-testid=removed-clients]", { timeout: 30000 }).catch(() => ""));
ok("Removed clients: says recordings without cloud backup leave on their own dates", removedList.includes("Recordings without cloud backup still leave our servers on their usual dates before then"), removedList);
ok("Removed clients: each with its deletion date", removedList.includes(`Xan ${stamp}`) && removedList.includes(`Wes ${stamp}`) && removedList.includes("deleted for good after") && !removedList.includes(`Bea ${stamp}`), removedList);

// ---- Members ----
const member = await signIn(memberEmail, "/clients");
await member.waitForSelector(`text=Bea ${stamp}`, { timeout: 30000 }).catch(() => null);
ok("members don't see Removed clients", (await member.locator("[data-testid=removed-clients]").count()) === 0 && !(await member.textContent("main")).includes(`Zed ${stamp}`));
ok("members can't restore (403)", (await status(member.request.post(`${BASE}/api/clients/${zed.id}/restore`))) === 403);
ok("members still can't remove (403)", (await status(member.request.delete(`${BASE}/api/clients/${bea.id}`))) === 403);
ok("restoring another workspace's client: 404", (await status(owner.request.post(`${BASE}/api/clients/${zed.id}/restore`))) === 404);

// ---- Earlier removals with no date ----
const leg = await mk(ws2, `Leg ${stamp}`, null, 14, { removedAt: ago(200) });
const lou = await mk(ws2, `Lou ${stamp}`, null, 15, { removedAt: ago(3) });
// One a run claimed and then stopped on part way (killed before its email went out): still undated, so it's told about again.
const liz = await mk(ws2, `Liz ${stamp}`, null, 18, { removedAt: ago(5), purgeWarnedAt: new Date(Date.now() - 20 * 60000) });

// ---- Due: Xan's 30 days are up ----
await prisma.client.update({ where: { id: xan.id }, data: { purgeAt: new Date(Date.now() - 60000) } });
ok("restore once the date has passed: 404", (await status(owner2.request.post(`${BASE}/api/clients/${xan.id}/restore`))) === 404);
const recordedBefore = (await prisma.workspace.findUnique({ where: { id: ws2 } })).videosRecorded;

// Both jobs at once, as can happen when the daily run overlaps the 5-minute one.
const [r1, r2] = await Promise.all([cron("reminders"), cron("purge")]);
ok("jobs report what they did", typeof r1.clientsPurged === "number" && typeof r2.clientsPurged === "number" && r1.clientsPurged + r2.clientsPurged >= 1 && r1.clientWarnings + r2.clientWarnings >= 2, JSON.stringify({ r1, r2 }));

// Purged.
ok("purge: the client is gone", !(await prisma.client.findUnique({ where: { id: xan.id } })));
ok("purge: their to-dos, notes and reminders are gone", (await prisma.item.count({ where: { id: { in: [xItem.id, xTask.id] } } })) === 0 && (await prisma.reminder.count({ where: { itemId: xTask.id } })) === 0);
ok("purge: their key history is gone", (await prisma.keyRotation.count({ where: { clientId: xan.id } })) === 0);
const left = await prisma.video.findMany({ where: { id: { in: [o1, c1, m1, d1, md1, mr, o2, c2, mc2, e1].map((v) => v.id) } }, select: { id: true } });
const leftIds = new Set(left.map((v) => v.id));
ok("purge: conversations sent only to them, copies and every reply recording are gone", ![d1, md1, mr, c2, mc2, e1, m1].some((v) => leftIds.has(v.id)), JSON.stringify([...leftIds]));
ok("purge: their files are deleted", !has(d1.storageKey) && !has(md1.storageKey) && !has(m1.storageKey) && !has(mc2.storageKey) && !has(`${mr.storageKey}.parts`));
const o1After = await prisma.video.findUnique({ where: { id: o1.id }, include: { replies: true, reactions: true, insight: true } });
ok("purge: a recording also sent to another client stays, detached", !!o1After && o1After.clientId === null && o1After.clientKeyWrap === null && o1After.sentAt === null && o1After.viewCount === 0);
ok("purge: without the removed client's conversation, keeping its transcript", !!o1After && o1After.replies.length === 0 && o1After.reactions.length === 0 && !!o1After.insight);
const c1After = await prisma.video.findUnique({ where: { id: c1.id } });
ok("purge: the other client's copy, conversation and file are intact", c1After?.clientId === bea.id && !!(await prisma.reply.findUnique({ where: { id: c1Reply.id } })) && has(o1.storageKey));
ok("purge: a copy sent to them goes, the original and its file stay", leftIds.has(o2.id) && (await prisma.video.findUnique({ where: { id: o2.id } })).clientId === bea.id && has(o2.storageKey));
ok("purge: queued team emails about them dropped", (await prisma.teamNotification.count({ where: { groupKey: `g${stamp}` } })) === 0);
const [nc, nd, nk] = await Promise.all([noticeClient, noticeDrop, noticeKeep].map((x) => prisma.staffNotice.findUnique({ where: { id: x.id } })));
ok("purge: staff reminders lose links to them (name or title)", nc.link === null && nc.linkLabel === null && nd.link === null && nd.linkLabel === null && nc.message === "Call them");
ok("purge: a link to a recording that stays is kept", nk.link === `/v/${o1.id}`);
ok("purge: other clients untouched", !!(await prisma.client.findUnique({ where: { id: bea.id } })) && !!(await prisma.item.findUnique({ where: { id: beaItem.id } })));
ok("purge: the Free plan's count of recorded videos is unchanged", (await prisma.workspace.findUnique({ where: { id: ws2 } })).videosRecorded === recordedBefore);
ok("restore after the purge: 404", (await status(owner2.request.post(`${BASE}/api/clients/${xan.id}/restore`))) === 404);

// Earlier removals: dated, never deleted straight away, one notice to the owner.
const [legAfter, louAfter, lizAfter] = await Promise.all([leg, lou, liz].map((c) => prisma.client.findUnique({ where: { id: c.id } })));
ok("earlier removals are not deleted", !!legAfter && !!louAfter && !!lizAfter);
ok("earlier removals get 30 days from now", [legAfter, louAfter, lizAfter].every((c) => c?.purgeAt && Math.abs(c.purgeAt.getTime() - (Date.now() + 30 * D)) < 5 * 60000), JSON.stringify([legAfter?.purgeAt, louAfter?.purgeAt, lizAfter?.purgeAt]));
ok("earlier removals: the claim is cleared once dated, so the 3-day warning still goes", [legAfter, louAfter, lizAfter].every((c) => c?.purgeWarnedAt === null));
const notices = mailTo(owner2Email).filter((m) => m.subject === "Removed clients are now deleted after 30 days");
ok("one notice to the owner for the workspace", notices.length === 1, String(notices.length));
const legNote = notices[0]?.text ?? "";
ok("notice: explains the change and lists both", legNote.includes("now kept for 30 days") && legNote.includes("even with cloud backup on") && legNote.includes(`Leg ${stamp}, removed`) && legNote.includes(`Lou ${stamp}, removed`), legNote);
ok("notice: includes one an interrupted run had claimed but not told them about", legNote.includes(`Liz ${stamp}, removed`), legNote);
ok("notice: links to Removed clients", legNote.includes(`/clients?removed=1&ws=${ws2}`));
ok("nobody else told about the earlier removals", mailTo(adminEmail).every((m) => !m.subject.includes("now deleted after 30 days")));

// The warning, 3 days before.
const warnOwner = mailTo(owner2Email).filter((m) => m.subject.includes("will be deleted from SureFrame"));
const warnAdmin = mailTo(adminEmail).filter((m) => m.subject.includes("will be deleted from SureFrame"));
const warnMember = mailTo(memberEmail).filter((m) => m.subject.includes("will be deleted from SureFrame"));
const wesSubject = `Wes ${stamp} will be deleted from SureFrame on ${shortDay(wes.purgeAt, TZ)}`;
const ow = warnOwner[0]?.text ?? "";
ok("warning: owner emailed once about both", warnOwner.length === 1 && warnOwner[0].subject === "2 removed clients will be deleted from SureFrame within 3 days", JSON.stringify(warnOwner.map((m) => m.subject)));
ok("warning: lists each with its date", ow.includes(`Wes ${stamp}, removed`) && ow.includes(`Vic ${stamp}, removed`) && ow.includes("Deleted after"), ow);
ok("warning: says how to keep them", ow.includes("restore them on the Clients page") && ow.includes("Save to device") && ow.includes("/clients?removed=1"), ow);
ok("warning: the admin who removed one is told about that one", warnAdmin.length === 1 && warnAdmin[0].subject === wesSubject && !warnAdmin[0].text.includes(`Vic ${stamp}`), JSON.stringify(warnAdmin.map((m) => m.subject)));
const mw = warnMember[0]?.text ?? "";
ok("warning: a remover who is staff now is told to ask an owner or admin", warnMember.length === 1 && warnMember[0].subject.startsWith(`Vic ${stamp} will be deleted`) && mw.includes("ask the owner or an admin to restore them") && !mw.includes("/clients?removed=1"), mw);
ok("warning: not for clients further off", !warnOwner.concat(warnAdmin, warnMember).some((m) => m.text.includes(`Zed ${stamp}`)));
ok("warning: recorded", !!(await prisma.client.findUnique({ where: { id: wes.id } })).purgeWarnedAt && !!(await prisma.client.findUnique({ where: { id: vic.id } })).purgeWarnedAt && !(await prisma.client.findUnique({ where: { id: zed.id } })).purgeWarnedAt);

// Both jobs again: nothing new.
const mid = outbox().length;
await cron("reminders");
await cron("purge");
const again = outbox().slice(mid).filter((m) => [owner2Email, adminEmail, memberEmail].includes(m.to));
ok("both jobs again: no second warning or notice", again.length === 0, JSON.stringify(again.map((m) => m.subject)));
ok("both jobs again: the warned client is still kept until its date", !!(await prisma.client.findUnique({ where: { id: wes.id } })));

// Account data download includes the deletion dates.
const exportRes = await owner2.request.get(BASE + "/api/account/export");
const exported = exportRes.ok() ? await exportRes.json() : null;
const exClients = exported?.workspaces?.[0]?.clients ?? [];
ok("data download: removed clients carry their deletion date", exClients.some((c) => c.name === `Wes ${stamp}` && c.purgeAt), String(exportRes.status()));

await browser.close();
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
