// Support turning a client's personal link off and on again (lib/support/admin.ts disableClientLink /
// enableClientLink, through /api/support/admin). Covers the client's side (link, inbox, video, reply uploads), the
// business's side (Link off badge, banner, no copy link, can't send to them, seat still used), nothing emailed to the
// client (reminders, new links after a key reset), the owner's notices, the support log, and turning it back on.
// Needs the app running with AUTH_DEV_LOGIN=true, SUPPORT_EMAIL=owner@test.dev (the support admin), local file
// storage, no RESEND_API_KEY (mail goes to .data/outbox) and CRON_SECRET.
import { chromium } from "@playwright/test";
import crypto, { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret";
const ADMIN = "owner@test.dev";
const shots = process.argv[2] ?? "/tmp";
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};
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
const sha = (t) => createHash("sha256").update(t).digest("hex");
const lastAction = (where) => prisma.adminAction.findFirst({ where, orderBy: { createdAt: "desc" } });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
async function signIn(email, next = "/library") {
  // Agreed to the current Terms and Privacy Policy, so signing in isn't stopped at /agree (e2e/agree.mjs).
  await agreed(email);
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname === next.split("?")[0], { timeout: 60000 });
  return page;
}
const admin = await signIn(ADMIN);
const act = async (data, page = admin) => {
  const r = await page.request.post(BASE + "/api/support/admin", { data });
  let body = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status(), body };
};

// ---- A business with two clients; Bea has a video and a reminder coming ----
const ownerEmail = `linkoff-owner${stamp}@example.com`;
const owner = await signIn(ownerEmail, "/clients");
// The browser makes the team key on first sign-in; video keys are wrapped with it, as the app does.
await owner.waitForSelector("[data-recovery-key]", { timeout: 30000 });
const recoveryKey = await owner.getAttribute("[data-recovery-key]", "data-recovery-key");
const teamKey = await globalThis.crypto.subtle.importKey("raw", Buffer.from(recoveryKey, "base64url"), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
async function wrapped() {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, teamKey, globalThis.crypto.getRandomValues(new Uint8Array(32))));
  return Buffer.concat([iv, ct]).toString("base64url");
}
const ownerUser = await prisma.user.findUnique({ where: { email: ownerEmail } });
const ws = (await prisma.membership.findFirst({ where: { userId: ownerUser.id, role: "OWNER" } })).workspaceId;
const business = `Linkoff ${stamp}`;
await prisma.workspace.update({ where: { id: ws }, data: { name: business } });
const FP = (await prisma.workspace.findUnique({ where: { id: ws } })).keyFingerprint;
const mk = (name, email, i) => prisma.client.create({ data: { name, email, token: `lo-${stamp}-${i}-${"x".repeat(20)}`, workspaceId: ws, createdAt: new Date(Date.now() - (10 - i) * 60000) } });
const bea = await mk(`Bea ${stamp}`, `bea-lo${stamp}@example.com`, 0);
const cy = await mk(`Cy ${stamp}`, `cy-lo${stamp}@example.com`, 1);
const beaVideo = await prisma.video.create({ data: { id: `loa${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/lo-bea`, status: "UPLOADED", encrypted: true, teamKeyWrap: await wrapped(), clientKeyWrap: "k".repeat(60), workspaceId: ws, ownerId: ownerUser.id, clientId: bea.id, title: "For Bea" } });
const teamVideo = await prisma.video.create({ data: { id: `lob${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/lo-team`, status: "UPLOADED", encrypted: true, teamKeyWrap: await wrapped(), workspaceId: ws, ownerId: ownerUser.id, title: "Team only" } });
const beaPhone = await (await browser.newContext()).newPage();
await beaPhone.goto(`${BASE}/c/${bea.token}`);
ok("before: Bea's link opens her inbox with her video", new URL(beaPhone.url()).pathname === "/inbox" && (await beaPhone.locator(`a[href*="/v/${beaVideo.id}"]`).count()) > 0);

// =====================================================================================================
// Turning Bea's link off
// =====================================================================================================
const reason = "Bea reported the link was posted publicly (internal)";
ok("not an admin: 404", (await act({ action: "disableClientLink", clientId: bea.id, reason, category: "security" }, owner)).status === 404);
ok("a reason is required", (await act({ action: "disableClientLink", clientId: bea.id, reason: "", category: "security" })).status === 400);
let r = await act({ action: "disableClientLink", clientId: bea.id, reason, category: "security" });
ok("link off: done and the owner emailed", r.status === 200 && r.body.emailed === true, JSON.stringify(r));
let b = await prisma.client.findUnique({ where: { id: bea.id } });
ok("link off: marked, with the internal reason, nothing else changed", !!b.linkDisabledAt && b.linkDisabledReason === reason && !b.removedAt && !b.pausedAt && b.token === bea.token);
ok("link off twice: 409", (await act({ action: "disableClientLink", clientId: bea.id, reason, category: "security" })).status === 409);
let row = await lastAction({ clientId: bea.id, action: "client.link_off" });
ok("logged: client, workspace, owner, target, emailed", row?.workspaceId === ws && row.userId === ownerUser.id && row.target === `${bea.name} <${bea.email}> of ${business}` && row.reason === reason && row.details?.emailedTo === ownerEmail, JSON.stringify(row));
const offMail = await waitMail(ownerEmail, (m) => m.subject === `${bea.name}'s link has been turned off`);
const om = norm(offMail?.text);
ok("owner's email: why, what it means, seat still used, nothing deleted", om.includes(`We've turned off ${bea.name}'s personal link to ${business} on SureFrame to protect the account's security.`) && om.includes(`${bea.name} can't open their videos or be sent new ones, and they still use a client seat. Nothing has been deleted.`), om);
ok("owner's email: review route, plain SureFrame, replies to support, no internal reason", om.includes("within 30 days") && offMail?.from.startsWith("SureFrame") && offMail?.replyTo === ADMIN && !om.includes("posted publicly"), om);
ok("Bea isn't emailed about it", mailTo(bea.email).length === 0);

// ---- Bea's side ----
await beaPhone.goto(BASE + "/inbox");
const offNote = norm(await beaPhone.textContent("[data-testid=client-link-off]").catch(() => ""));
ok("Bea's inbox: link turned off, video gone from the list", offNote === `This link has been turned off, so it no longer opens your videos from ${business}.` && (await beaPhone.locator(`a[href*="/v/${beaVideo.id}"]`).count()) === 0, offNote);
await beaPhone.goto(`${BASE}/v/${beaVideo.id}`);
ok("Bea's video: link-off card", (await beaPhone.locator("[data-testid=video-link-off]").count()) === 1 && (await beaPhone.textContent("h1")).includes("This link has been turned off"));
ok("Bea's video API: not found", (await beaPhone.request.get(`${BASE}/api/videos/${beaVideo.id}`)).status() === 404);
await beaPhone.screenshot({ path: `${shots}/link-off-client.png`, fullPage: true });
const fresh = await (await browser.newContext()).newPage();
await fresh.goto(`${BASE}/c/${bea.token}?v=${beaVideo.id}`);
ok("Bea's link on a new device: turned-off notice, nothing remembered", new URL(fresh.url()).searchParams.get("off") === "1" && norm(await fresh.textContent("[data-testid=client-link-off]").catch(() => "")).includes("This link has been turned off") && !(await fresh.context().cookies()).some((c) => c.name.startsWith("fc_client_")));
// A reply she'd started recording can't upload more (403: it stays on her device).
const replyToken = crypto.randomBytes(24).toString("base64url");
const media = await prisma.video.create({ data: { id: `lor${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/lo-reply`, status: "RECORDING", uploadId: "u1", workspaceId: ws, ownerId: ownerUser.id, replyToId: beaVideo.id, uploadTokenHash: sha(replyToken) } });
await prisma.reply.create({ data: { kind: "VIDEO", authorName: bea.name, videoId: beaVideo.id, mediaId: media.id } });
const part = await fresh.request.put(`${BASE}/api/videos/${media.id}/parts/1`, { headers: { "x-upload-token": replyToken, "content-type": "application/octet-stream" }, data: Buffer.from("abc") });
ok("Bea's reply upload: 403 turned off", part.status() === 403 && (await part.json()).error === "This link has been turned off.");
const done = await fresh.request.post(`${BASE}/api/videos/${media.id}/complete`, { headers: { "x-upload-token": replyToken }, data: { partCount: 1, durationMs: 1000 } });
ok("Bea's reply can't be finished either", done.status() === 403);
// Cy is unaffected.
const cyPhone = await (await browser.newContext()).newPage();
await cyPhone.goto(`${BASE}/c/${cy.token}`);
ok("Cy's link still works", new URL(cyPhone.url()).pathname === "/inbox" && !new URL(cyPhone.url()).searchParams.get("off") && (await cyPhone.locator("[data-testid=client-link-off]").count()) === 0);

// ---- The business's side ----
await owner.goto(BASE + "/clients");
await owner.waitForSelector("[data-testid=client-link-off-badge]", { timeout: 15000 }).catch(() => null);
ok("Clients page: Link off badge on Bea only", (await owner.locator("[data-testid=client-link-off-badge]").count()) === 1, String(await owner.locator("[data-testid=client-link-off-badge]").count()));
ok("Clients page: explains it and who to contact", norm(await owner.textContent("[data-testid=link-off-clients-note]").catch(() => "")).includes("Contact support@sureframe.app"));
await owner.screenshot({ path: `${shots}/link-off-clients.png`, fullPage: true });
const listed = (await (await owner.request.get(BASE + "/api/clients")).json()).clients;
ok("clients API: Bea linkOff, still counted, Cy not", listed.find((c) => c.id === bea.id)?.linkOff === true && listed.find((c) => c.id === cy.id)?.linkOff === false && listed.length === 2);
await owner.goto(`${BASE}/clients/${bea.id}`);
ok("Bea's page: banner, no copy link", (await owner.locator("[data-testid=client-link-off-banner]").count()) === 1 && (await owner.locator("text=Copy personal link").count()) === 0);
await owner.screenshot({ path: `${shots}/link-off-client-page.png`, fullPage: true });
let res = await owner.request.patch(`${BASE}/api/videos/${teamVideo.id}`, { data: { clientId: bea.id, clientKeyWrap: "k".repeat(44), keyFingerprint: FP } });
const linkOffMsg = `${bea.name}'s link has been turned off by SureFrame support, so they can't be sent anything. Contact support@sureframe.app.`;
ok("sending a video to Bea: 409 with why", res.status() === 409 && (await res.json()).error === linkOffMsg);
res = await owner.request.post(`${BASE}/api/videos/${teamVideo.id}/send`, { data: { recipients: [{ clientId: cy.id, clientKeyWrap: "k".repeat(44) }, { clientId: bea.id, clientKeyWrap: "k".repeat(44) }], keyFingerprint: FP } });
ok("send to several including Bea: 409, nothing sent", res.status() === 409 && (await res.json()).error === linkOffMsg && (await prisma.video.count({ where: { sourceId: teamVideo.id } })) === 0);
res = await owner.request.post(`${BASE}/api/videos/${teamVideo.id}/send`, { data: { recipients: [{ clientId: cy.id, clientKeyWrap: "k".repeat(44) }], keyFingerprint: FP, notify: true } });
ok("sending to Cy alone still works", res.status() === 201 && (await prisma.video.count({ where: { sourceId: teamVideo.id, clientId: cy.id } })) === 1, `${res.status()} ${await res.text()}`);
await owner.goto(`${BASE}/v/${beaVideo.id}`);
const sendStatus = await owner.waitForSelector("[data-testid=sent-row]", { timeout: 20000 }).then((e) => e.textContent()).catch(() => "");
ok("the team can still open Bea's video, and is told she can't watch it", norm(sendStatus).includes(`SureFrame support turned off ${bea.name}'s link, so they can't open this. Contact support@sureframe.app.`) && !/Copy link/.test(sendStatus), sendStatus);

// ---- Nothing goes to Bea ----
const item = await prisma.item.create({ data: { kind: "TASK", body: "t".repeat(40), dueAt: new Date(Date.now() + 30 * 60000), authorName: "Owner", workspaceId: ws, clientId: bea.id, shared: true, remindClient: true } });
const reminder = await prisma.reminder.create({ data: { itemId: item.id, sendAt: new Date(Date.now() - 60000), to: "CLIENT" } });
await cron("reminders");
const rem = await prisma.reminder.findUnique({ where: { id: reminder.id } });
ok("Bea's reminder is skipped, not emailed", !!rem.sentAt && rem.error === "client unavailable" && mailTo(bea.email).length === 0, JSON.stringify(rem));
// A key reset (someone left the team): every link changes, Cy is emailed her new one, Bea isn't, and hers stays off.
const items = await prisma.item.findMany({ where: { workspaceId: ws }, select: { id: true, body: true } });
const videos = await prisma.video.findMany({ where: { workspaceId: ws, teamKeyWrap: { not: null } }, select: { id: true, teamKeyWrap: true, clientKeyWrap: true } });
const FP2 = "e".repeat(32);
// Only a client who has opened their link is emailed the new one (lib/rekey.ts); the test link carries no key, so record it.
await prisma.client.update({ where: { id: cy.id }, data: { linkOpenedAt: new Date() } });
res = await owner.request.post(`${BASE}/api/team/rekey`, { data: { from: FP, fingerprint: FP2, teamWrap: "w".repeat(44), clients: [], videos, items } });
ok("key reset done", res.status() === 200, await res.text());
b = await prisma.client.findUnique({ where: { id: bea.id } });
ok("key reset: Bea's link changed but stays off", b.token !== bea.token && !!b.linkDisabledAt);
ok("key reset: Cy is emailed her new link, Bea isn't", !!(await waitMail(cy.email, (m) => m.subject === `${business} sent you a new private link`)) && mailTo(bea.email).length === 0);

// =====================================================================================================
// Turning it back on
// =====================================================================================================
r = await act({ action: "enableClientLink", clientId: bea.id, reason: "Owner confirmed a new device" });
ok("link on: done and emailed", r.status === 200 && r.body.emailed === true, JSON.stringify(r));
b = await prisma.client.findUnique({ where: { id: bea.id } });
ok("link on: cleared", !b.linkDisabledAt && !b.linkDisabledReason);
ok("link on twice: 409", (await act({ action: "enableClientLink", clientId: bea.id, reason: "again" })).status === 409);
row = await lastAction({ clientId: bea.id, action: "client.link_on" });
ok("logged with what was before", row?.details?.before?.linkDisabledReason === reason && row.reason === "Owner confirmed a new device", JSON.stringify(row));
const onMail = await waitMail(ownerEmail, (m) => m.subject === `${bea.name}'s link has been turned back on`);
ok("owner's email: back on, can be sent videos again", norm(onMail?.text).includes(`${bea.name} can open their videos and be sent new ones again.`), onMail?.text);
ok("owner's email: the button opens that workspace's Clients", !!onMail && onMail.text.includes(`/clients?ws=${ws}`), onMail?.text);
const beaAgain = await (await browser.newContext()).newPage();
await beaAgain.goto(`${BASE}/c/${b.token}`);
ok("Bea's (new) link opens her inbox again", new URL(beaAgain.url()).pathname === "/inbox" && (await beaAgain.locator(`a[href*="/v/${beaVideo.id}"]`).count()) > 0 && (await beaAgain.locator("[data-testid=client-link-off]").count()) === 0);
await owner.goto(BASE + "/clients");
ok("Clients page: no badge", (await owner.locator("[data-testid=client-link-off-badge]").count()) === 0 && (await owner.locator("[data-testid=link-off-clients-note]").count()) === 0);
res = await owner.request.patch(`${BASE}/api/videos/${teamVideo.id}`, { data: { clientId: bea.id, clientKeyWrap: "k".repeat(44), keyFingerprint: FP2 } });
ok("sending to Bea works again", res.status() === 200);

// A removed client can't have their link turned off (it already doesn't work).
await prisma.client.update({ where: { id: cy.id }, data: { removedAt: new Date(), purgeAt: new Date(Date.now() + 30 * 86_400_000) } });
ok("link off for a removed client: 409", (await act({ action: "disableClientLink", clientId: cy.id, reason, category: "terms" })).status === 409);
ok("unknown client: 404", (await act({ action: "disableClientLink", clientId: "nope", reason, category: "terms" })).status === 404);

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
