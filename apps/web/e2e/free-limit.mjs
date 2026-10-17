// Free plan: 25 videos in total for the life of the workspace. A place is used when an original
// finishes uploading (on any plan) and is never given back; recordings still uploading hold one.
// Also: the team's own replies on Free keep to 5 minutes, and the D4/D5 copy changes.
// Needs the app running with AUTH_DEV_LOGIN=true and SUPPORT_EMAIL=owner@test.dev.
import { chromium } from "@playwright/test";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
async function signIn(email, next, opts = {}) {
  // Agreed to the current Terms and Privacy Policy, so signing in isn't stopped at /agree (e2e/agree.mjs).
  await agreed(email);
  const page = await (await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1360, height: 900 }, ...opts })).newPage();
  await page.goto(`${BASE}/login?next=${next}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname === next, { timeout: 60000 });
  // The page streams in behind app/loading.tsx; it makes a new account's workspace, so wait until it has rendered.
  await page.waitForSelector("[role=status][aria-label=Loading]", { state: "detached", timeout: 30000 }).catch(() => {});
  return page;
}
// Pages stream in behind app/loading.tsx, so a check right after goto waits for the element to show (up to 15s).
const seen = (page, sel) => page.waitForSelector(sel, { state: "visible", timeout: 15000 }).then(() => true, () => false);
const counter = async (ws) => (await prisma.workspace.findUnique({ where: { id: ws } })).videosRecorded;
const setCounter = (ws, n) => prisma.workspace.update({ where: { id: ws }, data: { videosRecorded: n } });

// ---- API: the counter and the limit -------------------------------------------------------------
const emailA = `freelimit${Date.now()}@example.com`;
const a = await signIn(emailA, "/library");
const wsA = (await prisma.membership.findFirst({ where: { user: { email: emailA } } })).workspaceId;
const fp = "f".repeat(32), wrap = "w".repeat(44);
await prisma.workspace.update({ where: { id: wsA }, data: { keyFingerprint: fp } });
const start = () => a.request.post(BASE + "/api/videos", { data: { mimeType: "video/webm", teamKeyWrap: wrap, keyFingerprint: fp } });
const part = (id, headers = {}) => a.request.put(`${BASE}/api/videos/${id}/parts/1`, { data: Buffer.from("x".repeat(1000)), headers: { "content-type": "application/octet-stream", ...headers } });
const complete = (id, durationMs = 2000, headers = {}) => a.request.post(`${BASE}/api/videos/${id}/complete`, { data: { partCount: 1, durationMs }, headers });
const del = (id) => a.request.delete(`${BASE}/api/videos/${id}`);

ok("a new workspace starts at 0 used", (await counter(wsA)) === 0);
await setCounter(wsA, 24);
const r1 = await start();
const v1 = (await r1.json()).video?.id;
ok("24 used: a recording can start", r1.status() === 201, String(r1.status()));
ok("starting doesn't count it yet", (await counter(wsA)) === 24);

const r2 = await start();
const e2 = (await r2.json()).error ?? "";
ok("the recording still uploading holds the last place", r2.status() === 402, String(r2.status()));
ok("402 says the limit is in total and deleted videos count", e2.includes("25 videos in total") && e2.includes("Deleted videos still count"), e2);
ok("402 explains the unfinished upload", e2.includes("hasn't finished uploading") && e2.includes("delete it from your library"), e2);

ok("deleting an unfinished upload works", (await del(v1)).ok());
ok("which gives its place back (it never finished)", (await counter(wsA)) === 24);
const r3 = await start();
const v3 = (await r3.json()).video?.id;
ok("so a recording can start again", r3.status() === 201, String(r3.status()));
await part(v3);
ok("finishing the upload succeeds", (await complete(v3)).ok());
ok("a finished original uses a place", (await counter(wsA)) === 25);
const r4 = await start();
const e4 = (await r4.json()).error ?? "";
ok("25 used: a new recording is refused", r4.status() === 402, String(r4.status()));
ok("with the plain message only (nothing uploading)", e4 === "The Free plan includes 25 videos in total and you've used them all. Deleted videos still count. Upgrade to record more.", e4);
ok("completing again changes nothing", (await complete(v3)).ok() && (await counter(wsA)) === 25);
ok("deleting a finished video works", (await del(v3)).ok());
ok("but doesn't give its place back", (await counter(wsA)) === 25 && (await start()).status() === 402);

// Two completes at once (a retry racing the first try) count the video once.
await setCounter(wsA, 10);
const v5 = (await (await start()).json()).video.id;
await part(v5);
const [c1, c2] = await Promise.all([complete(v5), complete(v5)]);
ok("parallel completes both answer", c1.ok() && c2.ok(), `${c1.status()} ${c2.status()}`);
ok("parallel completes count the video once", (await counter(wsA)) === 11, String(await counter(wsA)));
ok("and the video is finished", (await prisma.video.findUnique({ where: { id: v5 } })).status === "UPLOADED");
const stream = await a.request.get(`${BASE}/api/videos/${v5}/stream`);
ok("with its bytes intact", stream.ok() && (await stream.body()).length === 1000, `${stream.status()}`);

// An upload refused at completion (too long for the plan) never uses a place.
const v6 = (await (await start()).json()).video.id;
await part(v6);
const long = await complete(v6, 6 * 60 * 1000);
ok("a recording over 5 minutes is refused", long.status() === 413, String(long.status()));
ok("refused uploads don't count", (await counter(wsA)) === 11);
ok("and aren't left holding a place", (await prisma.video.findUnique({ where: { id: v6 } })).status === "EXPIRED");

// Copies sent to more clients don't count.
const clients = await Promise.all(["Ann", "Ben"].map((name) => prisma.client.create({ data: { name, token: crypto.randomBytes(16).toString("hex"), workspaceId: wsA } })));
const sent = await a.request.post(`${BASE}/api/videos/${v5}/send`, { data: { recipients: clients.map((c) => ({ clientId: c.id, clientKeyWrap: wrap })), keyFingerprint: fp, notify: false } });
ok("sending a video to more clients works", sent.ok(), `${sent.status()} ${await sent.text()}`);
ok("and doesn't use places", (await counter(wsA)) === 11);

// ---- Replies: the team's own on Free keep to 5 minutes; clients' stay at 15 ---------------------
const startReply = (req, kind = "VIDEO", on = v5) => req.post(`${BASE}/api/videos/${on}/replies`, { data: { kind, mimeType: kind === "VIDEO" ? "video/webm" : "audio/webm", parentKeyWrap: wrap } });
const mine = await (await startReply(a.request)).json();
ok("a team video reply on Free is capped at 5 minutes", mine.maxDurationMin === 5, JSON.stringify(mine));
const tok = { "x-upload-token": mine.uploadToken };
await part(mine.mediaId, tok);
const longReply = await complete(mine.mediaId, 6 * 60 * 1000, tok);
ok("a 6-minute team reply on Free is refused", longReply.status() === 413, String(longReply.status()));
const voice = await (await startReply(a.request, "AUDIO")).json();
await part(voice.mediaId, { "x-upload-token": voice.uploadToken });
ok("a short team voice reply goes through", (await complete(voice.mediaId, 60_000, { "x-upload-token": voice.uploadToken })).ok());
ok("replies don't use places", (await counter(wsA)) === 11);
// A client replies to their copy from their own device.
const copy = await prisma.video.findFirst({ where: { sourceId: v5, clientId: clients[0].id } });
const clientCtx = await browser.newContext();
await clientCtx.addCookies([{ name: `fc_client_${wsA}`, value: clients[0].token, url: BASE }]);
const theirs = await (await startReply(clientCtx.request, "VIDEO", copy.id)).json();
ok("a client's video reply can still be 15 minutes", theirs.maxDurationMin === 15, JSON.stringify(theirs));
await clientCtx.request.put(`${BASE}/api/videos/${theirs.mediaId}/parts/1`, { data: Buffer.from("c".repeat(1000)), headers: { "content-type": "application/octet-stream", "x-upload-token": theirs.uploadToken } });
const clientLong = await clientCtx.request.post(`${BASE}/api/videos/${theirs.mediaId}/complete`, { data: { partCount: 1, durationMs: 10 * 60 * 1000 }, headers: { "x-upload-token": theirs.uploadToken } });
ok("a 10-minute client reply on Free is accepted", clientLong.ok(), String(clientLong.status()));
ok("client replies don't use places", (await counter(wsA)) === 11);

// ---- Complimentary plan: unlimited, but its recordings count if it ends -------------------------
await setCounter(wsA, 25);
const owner = await signIn("owner@test.dev", "/support/accounts");
await owner.fill('input[name="email"]', emailA);
await owner.selectOption("select", "SOLO");
await owner.fill('textarea[name="reason"]', "Test plan change");
await owner.click("text=Save");
await owner.waitForSelector("text=free of charge");
const r7 = await start();
const v7 = (await r7.json()).video?.id;
ok("on a complimentary Solo plan, recording works past 25", r7.status() === 201, String(r7.status()));
const paidReply = await (await startReply(a.request)).json();
ok("team replies on a paid plan can be 15 minutes", paidReply.maxDurationMin === 15, JSON.stringify(paidReply));
await part(v7);
await complete(v7);
ok("recordings on a paid plan count too", (await counter(wsA)) === 26);
await owner.fill('input[name="email"]', emailA);
await owner.selectOption("select", "FREE");
await owner.fill('textarea[name="reason"]', "Test plan change");
await owner.click("text=Save");
await owner.waitForSelector("text=back on the Free plan");
ok("back on Free with 26 recorded, recording is refused", (await start()).status() === 402);

// ---- The migration's backfill counts finished originals only, and can run again safely ---------
const sql = readFileSync(new URL("../prisma/migrations/20261011010000_videos_recorded/migration.sql", import.meta.url), "utf8");
const update = sql.slice(sql.indexOf("UPDATE")).trim().replace(/;$/, "") + ` AND w.id = '${wsA}'`;
const finished = await prisma.video.count({ where: { workspaceId: wsA, replyToId: null, sourceId: null, status: { not: "RECORDING" }, durationMs: { not: null } } });
await setCounter(wsA, 0);
await prisma.$executeRawUnsafe(update);
ok("backfill counts finished originals (not refused, deleted, copies or replies)", (await counter(wsA)) === finished && finished === 2, `${await counter(wsA)} vs ${finished}`);
await setCounter(wsA, 30);
await prisma.$executeRawUnsafe(update);
ok("running the backfill again never lowers the count", (await counter(wsA)) === 30);

// ---- UI: record page, recorder, library, billing, delete confirm --------------------------------
const emailB = `freeui${Date.now()}@example.com`;
const b = await signIn(emailB, "/record");
await b.click("text=I've saved it"); // first device: recovery key shown once
const wsB = (await prisma.membership.findFirst({ where: { user: { email: emailB } } })).workspaceId;
ok("record page shows the free videos left", !!(await b.waitForSelector("[data-testid=free-videos-left] >> text=25 of 25 free videos left", { timeout: 15000 }).catch(() => null)));
await b.click("text=Camera only");
await b.click("text=Start recording");
await b.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await b.waitForTimeout(3000);
ok("the live badge says Uploaded, not Saved to cloud", (await b.isVisible("text=/Uploaded: \\d/")) && !(await b.isVisible("text=Saved to cloud")));
await b.click("button:has-text('Stop')");
await b.waitForURL("**/v/**", { timeout: 30000 });
ok("a recording made in the browser uses a place", (await counter(wsB)) === 1);
await b.waitForSelector("main button:text-is('Delete')", { timeout: 20000 });
const confirmText = new Promise((r) => b.once("dialog", (d) => { r(d.message()); d.dismiss(); }));
await b.click("main button:text-is('Delete')");
const msg = await confirmText;
ok("on Free, the delete confirm says the video still counts", msg.includes("It still counts towards your 25 free videos."), msg);

await setCounter(wsB, 23);
await b.goto(BASE + "/record");
ok("record page counts what's left", !!(await b.waitForSelector("[data-testid=free-videos-left] >> text=2 of 25 free videos left", { timeout: 15000 }).catch(() => null)), await b.textContent("main"));
await setCounter(wsB, 25); // used up elsewhere while this page was open
await b.click("text=Camera only");
await b.click("text=Start recording");
await b.waitForSelector('[role="alert"] >> text=25 videos in total', { timeout: 15000 });
ok("the recorder's refusal links to the plans", await b.isVisible('[role="alert"] a[href="/pricing"]'));
await b.screenshot({ path: `${shots}/free-limit-recorder.png` });
await b.goto(BASE + "/record");
ok("record page shows the upgrade card when used up", await seen(b, "[data-testid=free-limit-reached] >> text=You've used all 25 free videos"));
ok("instead of the recorder", !(await b.isVisible("text=Start recording")));
ok("with a link to the plans", await b.isVisible("[data-testid=free-limit-reached] a[href='/pricing']"));
await b.screenshot({ path: `${shots}/free-limit-card.png` });
await b.goto(BASE + "/library");
ok("library shows 25 of 25 free videos used", await seen(b, "text=25 of 25 free videos used"));
ok("library says they're all used", await b.isVisible("[data-testid=free-videos-note] >> text=You've used all 25 free videos"));
await setCounter(wsB, 22);
await b.reload();
ok("library nudges when 5 or fewer are left", await seen(b, "[data-testid=free-videos-note] >> text=3 free videos left"));
await b.goto(BASE + "/settings/billing");
ok("billing shows the free videos used", await seen(b, "[data-testid=free-videos-used] >> text=22 of 25 free videos used"));
ok("billing lists 25 videos in total", await b.isVisible("text=25 videos in total"));

// An unfinished upload at the limit: the card explains it.
await setCounter(wsB, 24);
await prisma.video.create({ data: { id: `fl${Date.now().toString(36)}`, title: "Stuck", mimeType: "video/webm", storageKey: `videos/${wsB}/stuck/source.webm`, ownerId: (await prisma.user.findUnique({ where: { email: emailB } })).id, workspaceId: wsB, encrypted: true } });
await b.goto(BASE + "/record");
ok("the card explains a recording still uploading", await seen(b, "[data-testid=free-limit-reached] >> text=hasn't finished uploading"));

// ---- Copy (D4/D5) -------------------------------------------------------------------------------
const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await visitor.goto(BASE + "/");
const home = await visitor.textContent("main");
ok("home: headline and sub-line", home.includes("One take is") && home.includes("Record it once, send it privately"));
for (const t of ["Crash-safe recording", "End-to-end encrypted", "No account or expense for clients", "Optional AI and backup", "Ready when you are", "Nothing to install"]) ok(`home: point "${t}"`, home.includes(t));
ok("home: the device copy is only until the upload finishes", home.includes("with a copy on your device until the upload finishes") && !home.includes("backed up on your device"));
ok("home: eight feature tabs", (await visitor.locator("[role=tab]").count()) === 8);
ok("home: removed staff can't open anything through SureFrame", home.includes("your team's keys and every client link are reset, so they can't open anything through SureFrame again."));
await visitor.goto(BASE + "/pricing");
const pricing = await visitor.textContent("main");
ok("pricing: Studio badge says Best for teams", pricing.includes("Best for teams") && !pricing.includes("Most popular"));
ok("pricing: Free lists 25 videos in total", pricing.includes("25 videos in total"));
ok("pricing: footnote says deleting doesn't give a place back", pricing.includes("Free includes 25 videos in total, not per month") && pricing.includes("give its place back"));
// The first screen fits narrow phones without sideways scrolling.
for (const width of [320, 360, 375]) {
  const phone = await (await browser.newContext({ viewport: { width, height: 740 } })).newPage();
  await phone.goto(BASE + "/");
  await seen(phone, "h1");
  const wide = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok(`home: no sideways scroll at ${width}px`, !wide);
  ok(`home: headline and tabs visible at ${width}px`, (await seen(phone, "h1")) && (await phone.isVisible("[role=tablist]")));
  if (width === 320) await phone.screenshot({ path: `${shots}/free-limit-home-320.png` });
  await phone.context().close();
}

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
