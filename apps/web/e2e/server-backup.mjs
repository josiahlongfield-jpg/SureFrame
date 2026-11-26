// Server backup while recording (src/lib/pieces.ts): a recording reaches the server every few seconds, so it
// survives its page closing even when it's reopened somewhere else: another browser, a private tab, an app's
// own browser. The owner's recording and a client's video reply are each closed mid-recording, then opened in a
// different browser (nothing kept locally there): the server finishes them from its copy. Back in the first
// browser, its own leftover copy is tidied away and the recording plays.
// Run the app with UPLOAD_JOIN_BYTES small (e.g. 65536) so pieces are joined into parts mid-recording too.
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
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
// Cleared, unless it holds a last few seconds the server never got (closed between saving and sending a piece): that
// part is then kept, marked as left over, for the Record page to offer as a file (REC-2), and never sent again.
const left = await waitFor(() => a2.evaluate(() => new Promise((r) => {
  const req = indexedDB.open("framecast-recorder");
  req.onsuccess = () => {
    const tx = req.result.transaction("sessions", "readonly");
    const all = tx.objectStore("sessions").getAll();
    all.onsuccess = () => r(all.result.length === 0 ? "empty" : all.result.every((s) => s.leftover) ? "leftover" : null);
  };
})));
ok("the first browser's leftover copy is cleared, or kept only as the part the server never got", left === "empty" || left === "leftover", String(left));

// ---- A client's video reply, closed mid-recording, then opened from the link in another browser. ----
await a2.goto(BASE + "/clients");
await a2.fill('input[aria-label="Client name"]', "Client A");
await a2.check("[data-testid=route-link]");
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
await c.waitForSelector("[data-testid=reply-notes]");
ok("before recording, the client is told a closed page brings the reply back in about 90 seconds", /within about 90 seconds/.test((await c.textContent("[data-testid=reply-crash-note]").catch(() => "")) ?? ""));
// Record sits straight under the recording window, where a phone shows it without scrolling; the notes come after it (C27).
ok("Record sits straight under the recording window, the notes below it", await c.$eval("button:has-text('Record video reply')", (b) => {
  const w = b.previousElementSibling.getBoundingClientRect();
  const r = b.getBoundingClientRect();
  const notes = document.querySelector("[data-testid=reply-notes]").getBoundingClientRect();
  return r.top - w.bottom >= 0 && r.top - w.bottom <= 16 && notes.top >= r.bottom && r.bottom <= innerHeight;
}));
await c.click("button:has-text('Record video reply')");
await c.waitForSelector("text=/Recording · \\d/");
ok("while recording, the notes said before recording aren't repeated (C28)", (await c.locator("[data-testid=reply-notes]").count()) === 0);
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

// ---- A client's reply closed and reopened elsewhere straight away: told it's coming back, and roughly when. ----
const h = await (await browser.newContext({ ...devices["Pixel 7"], permissions: ["camera", "microphone"] })).newPage();
await skipIntro(h);
await h.goto(personal);
await h.waitForURL("**/v/**");
await h.waitForSelector("main video", { timeout: 20000 });
await h.click("[data-testid=chat-open]");
await h.waitForSelector("[data-testid=conversation][data-sheet]");
await h.click("role=tab[name='Video']");
await h.click("button:has-text('Record video reply')");
await h.waitForSelector("text=/Recording · \\d/");
const soonReply = await waitFor(() => sql(`select "mediaId" from "Reply" where "videoId"='${videoId}' and "byClient" and kind='VIDEO' and "mediaId"<>'${mediaId}' limit 1`) || null);
await h.waitForTimeout(5000);
await h.close({ runBeforeUnload: false });
const k = await (await browser.newContext({ ...devices["Pixel 7"], permissions: ["camera", "microphone"] })).newPage();
await skipIntro(k);
await k.goto(personal);
await k.waitForURL("**/v/**");
await k.waitForSelector("main video", { timeout: 20000 });
const inlineNote = await k.waitForSelector("[data-testid=inline-recovering]", { timeout: 20000 }).catch(() => null);
ok("the client's page says their reply is coming back, roughly when, and not to record it again", /Your reply that was interrupted is coming back in about \d+ seconds\. No need to record it again/.test(inlineNote ? await inlineNote.textContent() : ""));
await k.click("[data-testid=chat-open]");
const panelNote = await k.waitForSelector("[data-testid=recovering-reply]", { timeout: 5000 }).catch(() => null);
ok("and so does the conversation, where it will appear", /appear here in about \d+ seconds, ready to send/.test(panelNote ? await panelNote.textContent() : ""));
await k.screenshot({ path: `${shots}/server-backup-client-waiting.png` });
ok("it appears there without a reload, ready to send", !!(await k.waitForSelector("[data-testid=held-reply]", { timeout: 120000 }).catch(() => null)) && sql(`select status from "Video" where id='${soonReply}'`) === "UPLOADED");
ok("the notice gives way to it", !(await k.isVisible("[data-testid=recovering-reply]")));

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

// ---- REC-20: offline for a while mid-recording. The chunks waiting meanwhile are kept on disk only, then read back
// and sent in order once the connection returns: the whole recording arrives and plays. ----
const n = await aCtx.newPage();
await n.goto(BASE + "/record");
await n.click("text=Camera only");
await n.click("text=Start recording");
await n.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await n.waitForTimeout(3000);
await aCtx.setOffline(true);
await n.waitForSelector("text=Connection lost", { timeout: 15000 }).catch(() => {});
await n.waitForTimeout(12000);
await aCtx.setOffline(false);
await n.waitForTimeout(3000);
await n.click("button:has-text('Stop')");
await n.waitForURL("**/v/**", { timeout: 90000 }).catch(() => {});
ok("offline mid-recording: it finishes once back online", /\/v\//.test(n.url()), n.url());
await n.waitForSelector("main video", { timeout: 30000 }).catch(() => {});
const offlinePlayed = await n.$eval("main video", finiteDuration).catch(() => 0);
ok("...and plays in full, the part recorded offline included", offlinePlayed >= 15, String(offlinePlayed));
await n.close();

// ---- REC-2: offline so long that another browser finishes it from the server's copy. What was recorded meanwhile
// never reached the server: the recorder stops, says so, and offers the whole recording as a file to save. ----
const o = await aCtx.newPage();
await o.goto(BASE + "/record");
await o.click("text=Camera only");
await o.click("text=Start recording");
await o.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
const cutId = await waitFor(() => sql(`select id from "Video" where status='RECORDING' and "ownerId"=(select id from "User" where email='${email}') and "replyToId" is null limit 1`) || null);
await o.waitForTimeout(5000);
await aCtx.setOffline(true);
await o.waitForTimeout(8000);
quietFor(cutId);
await b.goto(BASE + "/library");
ok("offline for long, it's finished elsewhere from the server's copy", (await waitFor(() => sql(`select status from "Video" where id='${cutId}'`) === "UPLOADED" || null, 60000)) === true);
const onServerBytes = Number(sql(`select "sizeBytes" from "Video" where id='${cutId}'`));
await aCtx.setOffline(false);
const cutNote = await o.waitForSelector("[data-testid=recorder-leftover]", { timeout: 90000 }).catch(() => null);
const cutSays = (await o.textContent("[role=alert]").catch(() => "")) ?? "";
ok("back online, the recorder stops and says the rest is kept to save as a file", !!cutNote && /kept in this browser, for you to save as a file/.test(cutSays), cutSays);
ok("...and offers it as a file", !!cutNote && /isn.t in your library\. That part is kept in this browser/.test(await cutNote.textContent()));
await o.screenshot({ path: `${shots}/server-backup-leftover.png` });
const [dl] = await Promise.all([o.waitForEvent("download", { timeout: 60000 }), o.click("[data-testid=recorder-leftover] >> text=Save as a file")]);
const savedPath = await dl.path().catch(() => null);
const savedBytes = savedPath ? statSync(savedPath).size : 0;
ok("the file is the whole recording, more than the server's copy", savedBytes > onServerBytes, `${savedBytes} vs ${onServerBytes}`);
const head = savedPath ? readFileSync(savedPath).subarray(0, 4).toString("hex") : "";
ok("...opened on the device into a video file (not the encrypted copy)", head === "1a45dfa3", head);
ok("after saving it says where to look", !!(await o.waitForSelector("[data-testid=recorder-leftover] >> text=/Saved\\. Look in your browser/", { timeout: 10000 }).catch(() => null)));
await o.click("[data-testid=recorder-leftover] >> button:has-text('Remove')");
const cutGone = await waitFor(() => o.evaluate((id) => new Promise((r) => {
  const req = indexedDB.open("framecast-recorder");
  req.onsuccess = () => {
    const got = req.result.transaction("sessions", "readonly").objectStore("sessions").get(id);
    got.onsuccess = () => r(got.result ? null : true);
  };
}), cutId));
ok("Remove after saving clears the copy kept in this browser", cutGone === true);

// ---- REC-2 for a client's video reply: offline so long that the server finishes it from its copy (a reply's upload is
// then refused as not found, its one-time token being used up). It says so truly, the review still plays, and the
// whole reply can be saved as a file from this device's own copy. ----
const rCtx = await browser.newContext({ ...devices["Pixel 7"], permissions: ["camera", "microphone"] });
const r = await rCtx.newPage();
await skipIntro(r);
await r.goto(personal);
await r.waitForURL("**/v/**");
await r.waitForSelector("main video", { timeout: 20000 });
await r.click("[data-testid=chat-open]");
await r.waitForSelector("[data-testid=conversation][data-sheet]");
await r.click("role=tab[name='Video']");
await r.click("button:has-text('Record video reply')");
await r.waitForSelector("text=/Recording · \\d/");
const cutReply = await waitFor(() => sql(`select "mediaId" from "Reply" where "videoId"='${videoId}' and "byClient" and kind='VIDEO' and "mediaId" not in ('${mediaId}', '${soonReply}') limit 1`) || null);
await r.waitForTimeout(5000);
await rCtx.setOffline(true);
await r.waitForTimeout(8000);
quietFor(cutReply);
const elsewhere = await (await browser.newContext({ ...devices["Pixel 7"], permissions: ["camera", "microphone"] })).newPage();
await skipIntro(elsewhere);
await elsewhere.goto(personal);
ok("a client's reply offline for long is finished elsewhere from the server's copy", (await waitFor(() => sql(`select status from "Video" where id='${cutReply}'`) === "UPLOADED" || null, 60000)) === true);
await rCtx.setOffline(false);
await r.click("button:has-text('Stop recording')");
const saveReply = await r.waitForSelector("[data-testid=reply-save-file]", { timeout: 90000 }).catch(() => null);
const replySays = (await r.textContent("[role=alert]").catch(() => "")) ?? "";
ok("the reply says it was finished from what had uploaded, not that it finishes next time", /finished from what had already uploaded/.test(replySays) && !/next time/.test(replySays), replySays);
ok("...and offers to save it as a file", !!saveReply);
ok("its review still plays from this device's copy (not let go of when the review changed)", await r.$eval("[data-testid=reply-review] video", (v) => fetch(v.currentSrc || v.src).then((x) => x.ok, () => false)).catch(() => false));
const [replyDl] = await Promise.all([r.waitForEvent("download", { timeout: 30000 }), r.click("[data-testid=reply-save-file]")]);
const replyPath = await replyDl.path().catch(() => null);
ok("the saved reply is a video file", replyPath ? readFileSync(replyPath).subarray(0, 4).toString("hex") === "1a45dfa3" : false);
await r.screenshot({ path: `${shots}/server-backup-reply-cut.png` });

await browser.close();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
