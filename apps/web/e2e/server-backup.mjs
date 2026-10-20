// Server backup while recording (src/lib/pieces.ts): a recording reaches the server every few seconds, so it
// survives its page closing even when it's reopened somewhere else: another browser, a private tab, an app's
// own browser. The owner's recording and a client's video reply are each closed mid-recording, then opened in a
// different browser (nothing kept locally there): the server finishes them from its copy. Back in the first
// browser, its own leftover copy is tidied away and the recording plays.
// Run the app with UPLOAD_JOIN_BYTES small (e.g. 65536) so pieces are joined into parts mid-recording too.
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import { agreed } from "./agree.mjs";
import { sendByLink } from "./send.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args });
const sql = (q) => execSync(`su postgres -c "psql -d ${process.env.PGDATABASE ?? "framecast"} -tAc \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};
const waitFor = async (fn, ms = 20000) => {
  for (let t = 0; t < ms; t += 250) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return fn();
};
const finiteDuration = (el) =>
  new Promise((r) => {
    const check = () => (Number.isFinite(el.duration) && el.duration > 0 ? r(el.duration) : setTimeout(check, 200));
    check();
    setTimeout(() => r(el.duration), 10000);
  });
const signIn = async (page, email, path = "/record") => {
  await page.goto(BASE + path);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
};
// As if the recorder went quiet a while ago (the server waits SALVAGE_AFTER_MS before another browser may finish it).
const quietFor = (id) => sql(`update "Video" set "piecesAt" = now() - interval '5 minutes' where id='${id}'`);

// ---- The owner records, and the page closes mid-recording. ----
const email = `backup${Date.now()}@studio.com`;
await agreed(email);
const aCtx = await browser.newContext({ permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"], viewport: { width: 1360, height: 900 } });
const a = await aCtx.newPage();
await signIn(a, email);
await a.click("text=I've saved it");
await a.click("text=Camera only");
await a.click("text=Start recording");
await a.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
const videoId = await waitFor(() => sql(`select id from "Video" where status='RECORDING' and "ownerId"=(select id from "User" where email='${email}') limit 1`) || null);
await a.waitForTimeout(7000);
const pieces = Number(sql(`select count(*) from "UploadPiece" where "videoId"='${videoId}'`));
const joined = Number(sql(`select "partsJoined" from "Video" where id='${videoId}'`));
ok("pieces reach the server while recording", pieces + joined > 0, JSON.stringify({ pieces, joined }));
ok("pieces are joined into parts as they add up", joined > 0, String(joined));
const onServer = Number(sql(`select coalesce(max("offset" + "sizeBytes"), 0) from "UploadPiece" where "videoId"='${videoId}'`));
ok("the server holds the recording up to the last few seconds", onServer > 0 || joined > 0, String(onServer));
await a.close({ runBeforeUnload: false });

// ---- Reopened in a different browser (nothing local): the server finishes it. ----
quietFor(videoId);
const bCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const b = await bCtx.newPage();
await signIn(b, email, "/library");
const banner = await b.waitForSelector("[data-testid=recovered-uploads]", { timeout: 30000 }).catch(() => null);
ok("another browser finishes it from the server and says so", !!banner);
ok("its link opens that recording", banner ? (await b.getAttribute("[data-testid=recovered-uploads] a", "href")) === `/v/${videoId}` : false);
const done = sql(`select status || ' ' || "sizeBytes" || ' ' || coalesce("durationMs", 0) from "Video" where id='${videoId}'`).split(" ");
ok("the recording is finished", done[0] === "UPLOADED", done.join(" "));
ok("it kept its length (about 7 seconds)", Number(done[2]) >= 5000, done[2]);
ok("no pieces are left on the server", Number(sql(`select count(*) from "UploadPiece" where "videoId"='${videoId}'`)) === 0);
await b.screenshot({ path: `${shots}/server-backup-library.png` });

// ---- Back in the first browser: its leftover copy is tidied away and the recording plays. ----
const a2 = await aCtx.newPage();
await a2.goto(BASE + `/v/${videoId}`);
await a2.waitForSelector("main video", { timeout: 20000 });
const played = await a2.$eval("main video", finiteDuration);
ok("the finished recording plays in full", played >= 5, String(played));
const left = await waitFor(() => a2.evaluate(() => new Promise((r) => {
  const req = indexedDB.open("framecast-recorder");
  req.onsuccess = () => {
    const tx = req.result.transaction("sessions", "readonly");
    const all = tx.objectStore("sessions").getAll();
    all.onsuccess = () => r(all.result.length === 0 ? "empty" : null);
  };
})));
ok("the first browser's leftover copy is cleared", left === "empty", String(left));

// ---- A client's video reply, closed mid-recording, then opened from the link in another browser. ----
await a2.goto(BASE + "/clients");
await a2.fill('input[aria-label="Client name"]', "Client A");
await a2.click("button:has-text('Add client')");
await a2.waitForSelector("text=Client A");
await a2.goto(BASE + `/v/${videoId}`);
await sendByLink(a2, "Client A");
const personal = await a2.evaluate(() => navigator.clipboard.readText());
const skipIntro = (p) => p.addLocatorHandler(p.getByTestId("sureframe-promo"), async () => p.click("text=/^Watch now$/", { timeout: 15000 }));

const cCtx = await browser.newContext({ ...devices["Pixel 7"], permissions: ["camera", "microphone"] });
const c = await cCtx.newPage();
await skipIntro(c);
await c.goto(personal);
await c.waitForURL("**/v/**");
await c.waitForSelector("main video", { timeout: 20000 });
await c.click("[data-testid=chat-open]");
await c.waitForSelector("[data-testid=conversation][data-sheet]");
await c.click("role=tab[name='Video']");
await c.click("button:has-text('Record video reply')");
await c.waitForSelector("text=/Recording · \\d/");
ok("the client is told how a closed page is recovered", /within about 90 seconds/.test((await c.textContent("[data-testid=reply-crash-note]").catch(() => "")) ?? ""));
const mediaId = await waitFor(() => sql(`select "mediaId" from "Reply" where "videoId"='${videoId}' and "byClient" and kind='VIDEO' limit 1`) || null);
await c.waitForTimeout(7000);
ok("the client's reply reaches the server while recording", Number(sql(`select count(*) from "UploadPiece" where "videoId"='${mediaId}'`)) + Number(sql(`select "partsJoined" from "Video" where id='${mediaId}'`)) > 0);
await c.close({ runBeforeUnload: false });
quietFor(mediaId);

// Opened again from the same link, in another browser (as if from a messaging app's own browser).
const dCtx = await browser.newContext({ ...devices["Pixel 7"], permissions: ["camera", "microphone"] });
const d = await dCtx.newPage();
await skipIntro(d);
await d.goto(personal);
await d.waitForURL("**/v/**");
await d.waitForSelector("main video", { timeout: 20000 });
ok("the client's reply is finished from the server", (await waitFor(() => sql(`select status from "Video" where id='${mediaId}'`) === "UPLOADED")) === true);
ok("it waits for them to send or delete it", !!(await d.waitForSelector("[data-testid=inline-unsent]", { timeout: 30000 }).catch(() => null)));
await d.click("[data-testid=chat-open]");
await d.waitForSelector("[data-testid=held-reply] [data-testid=reply-video-still]", { timeout: 30000 });
await d.screenshot({ path: `${shots}/server-backup-client.png` });
await d.click("[data-testid=held-reply] >> button:has-text('Send it')");
await d.waitForSelector("aside ul [data-testid=reply-video-chip]", { timeout: 30000 });
ok("once sent it's in the conversation", true);
// The business sees it.
await a2.goto(BASE + `/v/${videoId}`);
ok("the business sees the client's reply", !!(await a2.waitForSelector("aside ul [data-testid=reply-video-still]", { timeout: 30000 }).catch(() => null)));

// ---- Still the same browser first: a recording still going isn't finished by someone else. ----
const e = await aCtx.newPage();
await e.goto(BASE + "/record");
await e.click("text=Camera only");
await e.click("text=Start recording");
await e.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
const liveId = await waitFor(() => sql(`select id from "Video" where status='RECORDING' and "ownerId"=(select id from "User" where email='${email}') and "replyToId" is null limit 1`) || null);
await e.waitForTimeout(3000);
await b.goto(BASE + "/library");
await b.waitForTimeout(3000);
ok("a recording still being made isn't finished from another browser", sql(`select status from "Video" where id='${liveId}'`) === "RECORDING");
await e.click("button:has-text('Stop')");
await e.waitForURL("**/v/**", { timeout: 30000 });
await e.waitForSelector("main video", { timeout: 20000 });
ok("and it finishes normally when stopped", sql(`select status from "Video" where id='${liveId}'`) !== "RECORDING" && (await e.$eval("main video", finiteDuration)) >= 2);

// ---- Reopened somewhere else straight away: finished once it's been quiet long enough, without a reload. ----
const f = await aCtx.newPage();
await f.goto(BASE + "/record");
await f.click("text=Camera only");
await f.click("text=Start recording");
await f.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
const soonId = await waitFor(() => sql(`select id from "Video" where status='RECORDING' and "ownerId"=(select id from "User" where email='${email}') and "replyToId" is null limit 1`) || null);
await f.waitForTimeout(5000);
await f.close({ runBeforeUnload: false });
const g = await bCtx.newPage();
await g.goto(BASE + "/library");
await g.waitForTimeout(3000);
ok("not finished while it might still be going", sql(`select status from "Video" where id='${soonId}'`) === "RECORDING");
const waitNote = await g.waitForSelector("[data-testid=recovering-upload]", { timeout: 10000 }).catch(() => null);
const waitText = waitNote ? await waitNote.textContent() : "";
ok("says it's finishing one, with roughly how long", /interrupted.*ready in about \d+ seconds/.test(waitText), waitText);
await g.screenshot({ path: `${shots}/server-backup-waiting.png` });
const later = await g.waitForSelector(`[data-testid=recovered-uploads] a[href="/v/${soonId}"]`, { timeout: 120000 }).catch(() => null);
ok("finished on the same page once it has been quiet a while", !!later && sql(`select status from "Video" where id='${soonId}'`) === "UPLOADED");
ok("the waiting notice gives way to the finished one", !(await g.isVisible("[data-testid=recovering-upload]")));

await browser.close();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
