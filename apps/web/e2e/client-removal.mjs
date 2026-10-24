// Removing a client deletes them permanently, straight away (Josiah, 24 October 2026): the "Delete … permanently?"
// box lists what's erased, offers to save the videos sent only to them (decrypted in the browser), needs a tick, then
// everything about them goes at once: conversations with replies and reactions, to-dos, notes, reminders, their link,
// and the recordings sent only to them. Recordings also sent to other clients stay, without them. They're emailed that
// their access ended (in good faith), leave no trace on the team's pages, and come back only as a brand-new client.
// Part 2 covers the purge itself, clients removed under the old 30-day rule, and legal hold.
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
const norm = (s) => (s ?? "").replace(/[\s  ]+/g, " ").trim();

// Local storage driver: files live under .data/uploads/<key>.
const uploads = path.resolve(".data/uploads");
const putFile = (key, bytes = "encrypted bytes") => {
  mkdirSync(path.dirname(path.join(uploads, key)), { recursive: true });
  writeFileSync(path.join(uploads, key), bytes);
};
const has = (p) => existsSync(path.join(uploads, p));

// Keys as the app makes them (AES-GCM, iv || ciphertext, base64url); recordings are length-prefixed frames (lib/e2e/crypto.ts).
const subtle = globalThis.crypto.subtle;
const b64url = (b) => Buffer.from(b).toString("base64url");
const importTeamKey = (recoveryKey) => subtle.importKey("raw", Buffer.from(recoveryKey, "base64url"), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
async function seal(plain, key) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return Buffer.concat([iv, new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, plain))]);
}
/** A video key wrapped with the team key, and the key itself. */
async function videoKey(teamKey) {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const key = await subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  return { key, wrap: b64url(await seal(raw, teamKey)) };
}
async function framed(text, key) {
  const parts = [];
  for (const chunk of [text.slice(0, 5), text.slice(5)]) {
    const sealed = await seal(new TextEncoder().encode(chunk), key);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(sealed.length);
    parts.push(len, sealed);
  }
  return Buffer.concat(parts);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
async function signIn(email, next = "/library") {
  // Agreed to the current Terms and Privacy Policy, so signing in isn't stopped at /agree (e2e/agree.mjs).
  await agreed(email);
  const page = await (await browser.newContext({ timezoneId: "Australia/Brisbane", viewport: { width: 1360, height: 1000 }, acceptDownloads: true })).newPage();
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
// Part 1: a Free workspace (3 client seats): the box, saving their videos, deleting, and what's left.
// =====================================================================================================
const TZ = "Australia/Brisbane";
const ownerEmail = `rm-owner${stamp}@example.com`;
const owner = await signIn(ownerEmail, "/clients");
await owner.waitForSelector("[data-recovery-key]", { timeout: 30000 });
const teamKey = await importTeamKey(await owner.getAttribute("[data-recovery-key]", "data-recovery-key"));
const ownerUser = await prisma.user.findUnique({ where: { email: ownerEmail } });
const ws = (await prisma.membership.findFirst({ where: { userId: ownerUser.id, role: "OWNER" } })).workspaceId;
const business = `Peak ${stamp}`;
await prisma.workspace.update({ where: { id: ws }, data: { name: business, timezone: TZ } });
const mk = (wsId, name, email, i, data = {}) =>
  prisma.client.create({ data: { name, email, token: `rm-${stamp}-${wsId.slice(-4)}-${i}-${"x".repeat(20)}`, workspaceId: wsId, createdAt: new Date(Date.now() - (50 - i) * 60000), ...data } });
const ana = await mk(ws, `Ana ${stamp}`, `ana${stamp}@example.com`, 0);
const ben = await mk(ws, `Ben ${stamp}`, `ben${stamp}@example.com`, 1);
const cal = await mk(ws, `Cal ${stamp}`, null, 2);

let n = 0;
async function video(data, content = "encrypted bytes") {
  const id = `rm${stamp.toString(36)}${n++}`;
  const storageKey = data.storageKey ?? `test/${stamp}/${id}`;
  if (!data.storageKey && data.status !== "EXPIRED") putFile(storageKey, content);
  return prisma.video.create({ data: { id, mimeType: "video/webm", storageKey, status: "UPLOADED", workspaceId: ws, ownerId: ownerUser.id, ...data } });
}
// Sent only to Ana: a real encrypted recording, saved and decrypted by the box's Download all.
const anaKey = await videoKey(teamKey);
const plain = `recording for Ana ${stamp}`;
const anaOnly = await video({ title: "Ana only", clientId: ana.id, encrypted: true, teamKeyWrap: anaKey.wrap, sentAt: new Date(), durationMs: 4000 }, await framed(plain, anaKey.key));
// Also sent only to Ana, but already deleted from our servers: counted, not saveable.
const anaExpired = await video({ title: "Old one", clientId: ana.id, status: "EXPIRED", sentAt: new Date(Date.now() - 40 * D) });
// Sent to Ana and copied to Ben: stays, without Ana.
const shared = await video({ title: "For both", clientId: ana.id, sentAt: new Date() });
const benCopy = await video({ title: "For both", clientId: ben.id, sourceId: shared.id, storageKey: shared.storageKey, sentAt: new Date() });
await prisma.reply.create({ data: { kind: "TEXT", body: "sealed", encrypted: true, authorName: "Ana", videoId: anaOnly.id } });
await prisma.reply.create({ data: { kind: "TEXT", body: "sealed", encrypted: true, authorName: "Ana", videoId: shared.id } });
await prisma.reply.create({ data: { kind: "TEXT", body: "sealed", encrypted: true, authorName: "Owner", authorUserId: ownerUser.id, videoId: shared.id } });
await prisma.reaction.create({ data: { emoji: "👍", videoId: shared.id } });
const benReply = await prisma.reply.create({ data: { kind: "TEXT", body: "sealed", encrypted: true, authorName: "Ben", videoId: benCopy.id } });
const anaItem = await prisma.item.create({ data: { kind: "TASK", body: "t".repeat(40), dueAt: new Date(Date.now() + 5 * D), shared: true, remindClient: true, authorName: "Owner", workspaceId: ws, clientId: ana.id } });
await prisma.reminder.create({ data: { itemId: anaItem.id, sendAt: new Date(Date.now() + 4 * D), to: "CLIENT" } });
const bell = await prisma.notification.create({ data: { kind: "REPLY", userId: ownerUser.id, workspaceId: ws, clientId: ana.id, videoId: shared.id, groupKey: `reply:${shared.id}`, text: `Ana ${stamp} replied`, href: `/v/${shared.id}?conv=1#reply` } });

// Ana has opened her link on her own device before.
const anaPage = await (await browser.newContext({ timezoneId: TZ })).newPage();
await anaPage.goto(`${BASE}/c/${ana.token}`);
ok("before: Ana's link opens her inbox", new URL(anaPage.url()).pathname === "/inbox" && !new URL(anaPage.url()).searchParams.get("removed"));

// ---- The box ----
await owner.goto(BASE + "/clients");
await owner.waitForSelector(`text=Ana ${stamp}`, { timeout: 30000 });
await owner.click(`li:has-text("Cal ${stamp}") >> button:text-is("Remove client")`);
await owner.waitForSelector("[data-testid=remove-client-sure]");
const calText = norm(await owner.textContent("[data-testid=remove-client-confirm]"));
ok("no email address: no line about emailing them", !calText.includes("We'll email"), calText);
ok("no videos sent only to them: said, and no save box", calText.includes("no videos: none were sent only to them") && (await owner.locator("[data-testid=remove-client-save]").count()) === 0, calText);
await owner.click("[data-testid=remove-client-confirm] >> button:text-is('Cancel')");
ok("Cancel closes the box and deletes nobody", (await owner.locator("[data-testid=remove-client-confirm]").count()) === 0 && !!(await prisma.client.findUnique({ where: { id: cal.id } })));
ok("Cancel: focus back on Remove client", await owner.evaluate(() => !!document.activeElement?.getAttribute("aria-label")?.startsWith("Remove client Cal")));

await owner.click(`li:has-text("Ana ${stamp}") >> button:text-is("Remove client")`);
await owner.waitForSelector("[data-testid=remove-client-sure]");
const box = norm(await owner.textContent("[data-testid=remove-client-confirm]"));
ok("box: titled as permanent", norm(await owner.textContent("[data-testid=remove-client-confirm] h2")) === `Delete Ana ${stamp} permanently?`);
ok("box: can't be undone, erased straight away", box.includes(`This can't be undone. Everything for Ana ${stamp} is erased from SureFrame straight away:`), box);
const erases = norm(await owner.textContent("[data-testid=remove-client-erases]"));
ok(
  "box: lists conversations with replies and reactions, to-dos and notes, the link, the videos",
  erases.includes("every conversation with them, with all replies and reactions (3 replies)") &&
    erases.includes("their to-dos, notes and reminders (1 item)") &&
    erases.includes("their personal link, which stops working on every device") &&
    erases.includes("2 videos sent only to them"),
  erases,
);
ok("box: videos also sent to others stay, without them", norm(await owner.textContent("[data-testid=remove-client-kept]")) === `1 video you also sent to other clients or kept for your team stays, without Ana ${stamp} on it.`);
ok("box: can be added again as a new client", box.includes(`You can add Ana ${stamp} again later. They'll start as a new client, with a new personal link, and none of the above comes back.`), box);
ok("box: says we'll email them", norm(await owner.textContent("[data-testid=remove-client-email-note]")) === `We'll email Ana ${stamp} that their access has ended.`);
const save = norm(await owner.textContent("[data-testid=remove-client-save]"));
ok("save box: the one that can be saved, and the one already gone", save.includes(`Save the 1 video sent only to Ana ${stamp} to this device before deleting.`) && save.includes("1 other has already left our servers and can't be saved.") && save.includes("Ana only") && !save.includes("Old one"), save);
ok("delete button off until the tick", await owner.isDisabled("[data-testid=remove-client-yes]"));
await owner.setViewportSize({ width: 320, height: 640 });
ok("box fits 320px", await owner.evaluate(() => document.documentElement.scrollWidth <= 320));
await owner.screenshot({ path: `${shots}/client-delete-box-320.png` });
await owner.setViewportSize({ width: 1360, height: 1000 });

// ---- Download all: saved and decrypted here ----
const [download] = await Promise.all([owner.waitForEvent("download", { timeout: 30000 }), owner.click("[data-testid=remove-client-save-all]")]);
const saved = readFileSync(await download.path(), "utf8");
ok("Download all: the recording, decrypted on this device", saved === plain, saved.slice(0, 60));
ok("Download all: named for the business, client and title", download.suggestedFilename() === `${business} - Ana ${stamp} - Ana only.webm`, download.suggestedFilename());
await owner.waitForSelector("[data-testid=remove-client-saved]", { timeout: 30000 });
ok("Download all: says it's saved", norm(await owner.textContent("[data-testid=remove-client-saved]")) === "Saved 1 video to this device. Check your downloads before deleting.");
await owner.screenshot({ path: `${shots}/client-delete-box.png`, fullPage: true });

// ---- Delete ----
await owner.check("[data-testid=remove-client-sure]");
await owner.click("[data-testid=remove-client-yes]");
await owner.waitForSelector("[data-testid=clients-notice]", { timeout: 30000 });
ok("after: says deleted permanently, and that we emailed them", norm(await owner.textContent("[data-testid=clients-notice]")) === `Ana ${stamp} was deleted permanently. We've emailed them that their access has ended.`);
ok("after: gone from the list, no Removed clients section", !(await owner.textContent("main")).includes(`Ana ${stamp}`) && (await owner.locator("[data-testid=removed-clients]").count()) === 0);
ok("after: focus on the notice", await owner.evaluate(() => document.activeElement?.getAttribute("data-testid") === "clients-notice"));
await owner.screenshot({ path: `${shots}/client-delete-after.png`, fullPage: true });

ok("erased: the client", !(await prisma.client.findUnique({ where: { id: ana.id } })));
ok("erased: the videos sent only to her, and the file", !(await prisma.video.findUnique({ where: { id: anaOnly.id } })) && !(await prisma.video.findUnique({ where: { id: anaExpired.id } })) && !has(anaOnly.storageKey));
ok("erased: to-dos and reminders", (await prisma.item.count({ where: { id: anaItem.id } })) === 0 && (await prisma.reminder.count({ where: { itemId: anaItem.id } })) === 0);
ok("erased: the bell's notification about her", !(await prisma.notification.findUnique({ where: { id: bell.id } })));
const sharedAfter = await prisma.video.findUnique({ where: { id: shared.id }, include: { replies: true, reactions: true } });
ok("kept: the recording also sent to Ben, without Ana's conversation", !!sharedAfter && sharedAfter.clientId === null && sharedAfter.replies.length === 0 && sharedAfter.reactions.length === 0 && has(shared.storageKey));
ok("kept: Ben's own conversation", (await prisma.video.findUnique({ where: { id: benCopy.id } }))?.clientId === ben.id && !!(await prisma.reply.findUnique({ where: { id: benReply.id } })));
const seats = (await (await owner.request.get(BASE + "/api/clients")).json()).seats;
ok("seat freed", seats.used === 2 && seats.limit === 3, JSON.stringify(seats));

// ---- The goodbye email ----
const gone = await waitMail(ana.email, (m) => m.subject === `Your access to ${business} on SureFrame has ended`);
ok("Ana emailed that her access ended", !!gone);
ok("email: deleted for good, a new link if they work together again, no link or button", !!gone && gone.text.includes(`${business} has ended your access`) && gone.text.includes("deleted for good") && gone.text.includes("they'll send you a new personal link") && !gone.text.includes("/c/") && !gone.html.includes("<a "), gone?.text);
ok("email: no restore date", !!gone && !/restore|until/i.test(gone.text), gone?.text);

// ---- The client's side: the link is forgotten ----
const fresh = await (await browser.newContext({ timezoneId: TZ })).newPage();
await fresh.goto(`${BASE}/c/${ana.token}`);
ok("old link: doesn't work any more", new URL(fresh.url()).searchParams.get("invalid") === "1", fresh.url());
ok("old link: remembers nothing on this device", !(await fresh.context().cookies()).some((c) => c.name.startsWith("fc_client_")));
await anaPage.goto(BASE + "/inbox");
ok("Ana's own device: nothing from the business", !(await anaPage.textContent("body")).includes(business));
ok("Ana's own device: her video doesn't open", (await status(anaPage.goto(`${BASE}/v/${anaOnly.id}`))) === 404);
await anaPage.goto(`${BASE}/v/${shared.id}`);
ok("Ana's own device: the shared recording doesn't open either", !(await anaPage.textContent("body")).includes("For both"));

// ---- No trace on the team's pages ----
await owner.goto(`${BASE}/v/${shared.id}`);
await owner.waitForSelector("main", { timeout: 30000 });
const watch = await owner.textContent("main");
ok("video page: no sign of Ana, no removed banner", !watch.includes(`Ana ${stamp}`) && (await owner.locator("[data-testid=recipient-removed]").count()) === 0);
await owner.goto(`${BASE}/library`);
await owner.$$eval("[data-testid=day-folder]", (els) => els.forEach((e) => (e.open = true)));
const lib = await owner.textContent("main");
ok("library: no sign of Ana, no 'Client removed'", !lib.includes(`Ana ${stamp}`) && !lib.includes("Client removed") && (await owner.locator("[data-testid=client-removed-badge]").count()) === 0);
const exported = await (await owner.request.get(BASE + "/api/account/export")).json();
ok("data download: Ana isn't in it", !JSON.stringify(exported).includes(`Ana ${stamp}`));
ok("the restore address is gone", (await status(owner.request.post(`${BASE}/api/clients/${ana.id}/restore`))) === 404);
ok("deleting again: 404", (await status(owner.request.delete(`${BASE}/api/clients/${ana.id}`))) === 404);

// ---- Added again: a brand-new client ----
const again = await owner.request.post(`${BASE}/api/clients`, { data: { name: `Ana ${stamp}`, email: ana.email, teamKeyWrap: "k".repeat(60) } });
const anaNew = again.ok() ? (await again.json()).client : null;
ok("added again: a new client with a new link and nothing from before", !!anaNew && anaNew.id !== ana.id && !anaNew.link.includes(ana.token) && anaNew.videoCount === 0, JSON.stringify(anaNew));

// ---- Cal: no email, through the API ----
ok("API: deleting needs no notify flag", (await owner.request.delete(`${BASE}/api/clients/${cal.id}`)).ok());
ok("Cal deleted", !(await prisma.client.findUnique({ where: { id: cal.id } })));

// ---- Members ----
const memberEmail = `rm-member${stamp}@example.com`;
await prisma.user.create({ data: { email: memberEmail, activeWorkspaceId: ws, memberships: { create: { workspaceId: ws, role: "MEMBER", seeAllClients: true } } } });
const member = await signIn(memberEmail, "/clients");
await member.waitForSelector(`text=Ben ${stamp}`, { timeout: 30000 }).catch(() => null);
ok("members: no Remove client", (await member.locator(`li:has-text("Ben ${stamp}") >> button:text-is("Remove client")`).count()) === 0);
ok("members can't delete (403)", (await status(member.request.delete(`${BASE}/api/clients/${ben.id}`))) === 403);
ok("members can't see what deleting would erase (403)", (await status(member.request.get(`${BASE}/api/clients/${ben.id}/deletion`))) === 403);
ok("someone else's client: 404", (await status(owner.request.get(`${BASE}/api/clients/nope${stamp}/deletion`))) === 404);

// =====================================================================================================
// Part 2: the purge: clients removed under the old 30-day rule are finished by the jobs, files first; legal hold.
// =====================================================================================================
const owner2Email = `rm-owner2-${stamp}@example.com`;
const owner2 = await signIn(owner2Email, "/clients");
const owner2User = await prisma.user.findUnique({ where: { email: owner2Email } });
const ws2 = (await prisma.membership.findFirst({ where: { userId: owner2User.id, role: "OWNER" } })).workspaceId;
await prisma.workspace.update({ where: { id: ws2 }, data: { name: `Lake ${stamp}`, plan: "STUDIO", videosRecorded: 7 } });
const admin2 = await prisma.user.create({ data: { email: `rm-admin${stamp}@example.com`, activeWorkspaceId: ws2, memberships: { create: { workspaceId: ws2, role: "ADMIN" } } } });

const ago = (days) => new Date(Date.now() - days * D);
// Removed before this change, with a restore date still to come: deleted on the next run all the same.
const xan = await mk(ws2, `Xan ${stamp}`, `xan${stamp}@example.com`, 10, { removedAt: ago(10), purgeAt: new Date(Date.now() + 20 * D), removedById: admin2.id });
const bea = await mk(ws2, `Bea ${stamp}`, `bea${stamp}@example.com`, 11);
const leg = await mk(ws2, `Leg ${stamp}`, null, 14, { removedAt: ago(200) });

let m = 0;
const vid = async (data, file = true) => {
  const key = `test/${stamp}/w${m++}`;
  if (file) putFile(key);
  return prisma.video.create({ data: { id: `rw${stamp.toString(36)}${m}`, mimeType: "video/webm", storageKey: key, status: "UPLOADED", encrypted: true, workspaceId: ws2, ownerId: owner2User.id, title: `Title ${m}`, ...data } });
};
const reply = (videoId, data = {}) => prisma.reply.create({ data: { kind: "TEXT", body: "sealed", encrypted: true, authorName: "Someone", videoId, ...data } });
const mediaFor = async (conv, data = {}) => {
  const media = await vid({ replyToId: conv.id, title: "Reply", ...data }, data.status !== "RECORDING");
  await reply(conv.id, { kind: "VIDEO", mediaId: media.id, body: null });
  return media;
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
const xItem = await prisma.item.create({ data: { kind: "NOTE", body: "n".repeat(40), authorName: "Owner", workspaceId: ws2, clientId: xan.id } });
const xTask = await prisma.item.create({ data: { kind: "TASK", body: "t".repeat(40), dueAt: new Date(Date.now() + 40 * D), authorName: "Owner", workspaceId: ws2, clientId: xan.id } });
await prisma.reminder.create({ data: { itemId: xTask.id, sendAt: new Date(Date.now() + 39 * D), to: "TEAM" } });
await prisma.keyRotation.create({ data: { workspaceId: ws2, clientId: xan.id, fromFingerprint: "a".repeat(22), wrap: "b".repeat(60) } });
await prisma.teamNotification.create({ data: { kind: "CLIENT_REPLY", userId: owner2User.id, workspaceId: ws2, groupKey: `g${stamp}`, clientId: xan.id, videoId: d1.id } });
const noticeClient = await prisma.staffNotice.create({ data: { workspaceId: ws2, fromUserId: owner2User.id, toUserId: admin2.id, message: "Call them", link: `/clients/${xan.id}`, linkLabel: xan.name } });
const noticeDrop = await prisma.staffNotice.create({ data: { workspaceId: ws2, fromUserId: owner2User.id, toUserId: admin2.id, message: "Watch", link: `/v/${d1.id}`, linkLabel: "Title" } });
const noticeKeep = await prisma.staffNotice.create({ data: { workspaceId: ws2, fromUserId: owner2User.id, toUserId: admin2.id, message: "Watch", link: `/v/${o1.id}`, linkLabel: "Title" } });
const beaItem = await prisma.item.create({ data: { kind: "NOTE", body: "b".repeat(40), authorName: "Owner", workspaceId: ws2, clientId: bea.id } });

// ---- Before the job runs: already no trace for the team ----
ok("before the job: their conversation's page is gone", (await status(owner2.goto(`${BASE}/v/${d1.id}`))) === 404);
ok("before the job: their copy of a shared recording too", (await status(owner2.goto(`${BASE}/v/${c2.id}`))) === 404);
await owner2.goto(`${BASE}/v/${o1.id}`);
await owner2.waitForSelector("main", { timeout: 30000 });
const o1Page = await owner2.textContent("main");
ok("before the job: a recording also sent to Bea opens, without Xan", !o1Page.includes(`Xan ${stamp}`) && o1Page.includes(`Bea ${stamp}`), o1Page.slice(0, 300));
await owner2.goto(`${BASE}/library`);
await owner2.$$eval("[data-testid=day-folder]", (els) => els.forEach((e) => (e.open = true)));
const lib2 = await owner2.textContent("main");
ok("before the job: the library shows nothing of Xan", !lib2.includes(`Xan ${stamp}`) && !lib2.includes("Client removed"));
await owner2.goto(`${BASE}/clients`);
await owner2.waitForSelector(`text=Bea ${stamp}`, { timeout: 30000 }).catch(() => null);
ok("before the job: Clients doesn't list them", !(await owner2.textContent("main")).includes(`Xan ${stamp}`) && (await owner2.locator("[data-testid=removed-clients]").count()) === 0);
ok("before the job: can't be restored", (await status(owner2.request.post(`${BASE}/api/clients/${xan.id}/restore`))) === 404);
const recordedBefore = (await prisma.workspace.findUnique({ where: { id: ws2 } })).videosRecorded;

// Both jobs at once, as can happen when the daily run overlaps the 5-minute one.
const [r1, r2] = await Promise.all([cron("reminders"), cron("purge")]);
ok("jobs report what they did, and no warnings any more", typeof r1.clientsPurged === "number" && typeof r2.clientsPurged === "number" && r1.clientsPurged + r2.clientsPurged >= 2 && !("clientWarnings" in r1) && !("clientWarnings" in r2), JSON.stringify({ r1, r2 }));

ok("purge: clients removed under the old rule are gone, whatever their date", !(await prisma.client.findUnique({ where: { id: xan.id } })) && !(await prisma.client.findUnique({ where: { id: leg.id } })));
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
ok("purge: nobody is emailed a warning or notice", mailTo(owner2Email).every((mail) => !/will be deleted|now deleted after/.test(mail.subject)));

// ---- Legal hold: removed from the business at once, erased when the hold ends ----
await prisma.workspace.update({ where: { id: ws2 }, data: { legalHoldAt: new Date() } });
const held = await owner2.request.delete(`${BASE}/api/clients/${bea.id}`);
const heldBody = held.ok() ? await held.json() : {};
ok("legal hold: deleting says it isn't finished yet", held.ok() && heldBody.deleted === false, JSON.stringify(heldBody));
ok("legal hold: kept for now", !!(await prisma.client.findUnique({ where: { id: bea.id } })));
ok("legal hold: gone from the business's list", !(await (await owner2.request.get(`${BASE}/api/clients`)).text()).includes(`Bea ${stamp}`));
ok("legal hold: can't be deleted twice", (await status(owner2.request.delete(`${BASE}/api/clients/${bea.id}`))) === 404);
await cron("purge");
ok("legal hold: the job leaves them", !!(await prisma.client.findUnique({ where: { id: bea.id } })));
await prisma.workspace.update({ where: { id: ws2 }, data: { legalHoldAt: null } });
await cron("purge");
ok("hold lifted: erased on the next run", !(await prisma.client.findUnique({ where: { id: bea.id } })));

await browser.close();
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
