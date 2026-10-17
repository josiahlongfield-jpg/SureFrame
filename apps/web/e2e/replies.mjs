// End-to-end encrypted conversation between a business and its client.
// A coach adds a client, records a video and sends it. The client, on a
// phone-sized screen with no account, opens their personal link and replies
// with text, voice and video. Checks the server only stores ciphertext,
// another device needs the recovery key, videos are private, seats are
// capped, and expired relay copies are cleaned up.
import { chromium, devices } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { agreed } from "./agree.mjs";
import { chooseClients, sendByLink } from "./send.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args });
const sql = (q) => execSync(`su postgres -c "psql -d ${process.env.PGDATABASE ?? "framecast"} -tAc \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();

const finiteDuration = (el) => new Promise((r) => {
  const check = () => (Number.isFinite(el.duration) && el.duration > 0 ? r(el.duration) : setTimeout(check, 200));
  check();
  setTimeout(() => r(el.duration), 10000);
});

// Coach signs in; this first device creates the team key and shows the recovery key once
const coachCtx = await browser.newContext({ permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"], viewport: { width: 1360, height: 900 } });
const coach = await coachCtx.newPage();
coach.on("console", (m) => m.type() === "error" && console.log("coach console:", m.text()));
const email = `coach${Date.now()}@studio.com`;
await coach.goto(BASE + "/record");
await agreed(email);
await coach.fill('input[name="email"]', email);
await coach.click("text=Continue");
await coach.waitForURL("**/record");
const recoveryKey = await coach.getAttribute("[data-recovery-key]", "data-recovery-key");
console.log("recovery key shown once:", recoveryKey ? `${recoveryKey.length} chars` : "MISSING");
await coach.click("text=I've saved it");

await coach.click("text=Camera only");
await coach.click("text=Start recording");
await coach.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await coach.waitForTimeout(4000);
await coach.click("button:has-text('Stop')");
await coach.waitForURL("**/v/**", { timeout: 30000 });
const link = coach.url().split("?")[0];
const rootId = link.split("/v/")[1];
await coach.waitForSelector("main video", { timeout: 20000 });
console.log("coach plays own video, duration", await coach.$eval("main video", finiteDuration));

// The server only has ciphertext
const keyPath = sql(`select "storageKey" from "Video" where id='${rootId}'`);
// Local disk driver, or the Postgres driver (STORAGE_DRIVER=db): read the first bytes either way.
const stored = existsSync(join(".data/uploads", keyPath))
  ? readFileSync(join(".data/uploads", keyPath))
  : Buffer.from(sql(`select encode(substring(data from 1 for 64), 'hex') from "StoredPart" where key='${keyPath}' order by "partNumber" limit 1`), "hex");
const isWebm = stored[0] === 0x1a && stored[1] === 0x45 && stored[2] === 0xdf && stored[3] === 0xa3;
console.log("stored file", stored.length, "bytes; readable WebM on server:", isWebm);

// Nobody can watch before it is sent
const strangerCtx = await browser.newContext();
const stranger = await strangerCtx.newPage();
await stranger.goto(link);
console.log("stranger sees:", await stranger.textContent("h1"));

// Add a client through the UI (their key is made in the coach's browser), then send
await coach.goto(BASE + "/clients");
await coach.fill('input[aria-label="Client name"]', "Sam Client");
await coach.click("button:has-text('Add client')");
await coach.waitForSelector("text=Sam Client");
await coach.goto(link);
// First video for Sam: the link is copied to send him (it holds Sam's key).
await sendByLink(coach, "Sam Client");
const personal = await coach.evaluate(() => navigator.clipboard.readText());
console.log("personal link carries key in fragment:", /\?v=\w+#k=[\w-]{43}$/.test(personal));
await coach.screenshot({ path: `${shots}/send-to-client.png` });

// Client on a phone opens their personal link and replies
const clientCtx = await browser.newContext({ ...devices["Pixel 7"], permissions: ["camera", "microphone"] });
const client = await clientCtx.newPage();
// The coach is on the Free plan, so clients see a short intro the first time; wait it out and continue.
const skipIntro = (p) =>
  p.addLocatorHandler(p.getByTestId("sureframe-promo"), async () => {
    await p.click("text=/^Watch now$/", { timeout: 15000 });
  });
client.on("console", (m) => m.type() === "error" && console.log("client console:", m.text()));
await client.goto(personal);
await client.waitForURL("**/v/**");
console.log("free plan: client sees the SureFrame intro:", !!(await client.waitForSelector("[data-testid=sureframe-promo]", { timeout: 5000 }).catch(() => null)));
await skipIntro(client);
await client.waitForSelector("main video", { timeout: 20000 });
console.log("key removed from address bar:", !client.url().includes("#k="));
console.log("client plays video, duration", await client.$eval("main video", finiteDuration));
// On a phone the conversation opens from the reply card under the video.
await client.click("[data-testid=chat-open]");
await client.waitForSelector("[data-testid=conversation][data-sheet]");
await client.fill('textarea[aria-label="Reply"]', "Felt strong this week!");
await client.click("button:has-text('Send reply')");
await client.waitForSelector("aside ul >> text=Felt strong this week!");
const storedText = sql(`select body from "Reply" where "videoId"='${rootId}' order by "createdAt" desc limit 1`);
console.log("reply text readable on server:", storedText.includes("Felt strong"));

await client.click("role=tab[name='Voice']");
await client.click("button:has-text('Record voice reply')");
await client.waitForSelector("text=/Recording · \\d/");
await client.waitForTimeout(3000);
await client.click("button:has-text('Stop recording')");
await client.click("button:has-text('Send voice reply')");
await client.waitForSelector("aside ul audio", { timeout: 30000 });
console.log("voice reply duration", await client.$eval("aside ul audio", finiteDuration));

await client.click("role=tab[name='Video']");
await client.click("button:has-text('Record video reply')");
await client.waitForSelector("text=/Recording · \\d/");
await client.waitForTimeout(4000);
await client.click("button:has-text('Stop recording')");
await client.click("button:has-text('Send video reply')");
await client.waitForSelector("aside ul video", { timeout: 30000 });
console.log("video reply duration", await client.$eval("aside ul video", finiteDuration));
await client.screenshot({ path: `${shots}/reply-phone.png`, fullPage: true });

// Interrupted video reply: close the tab mid-recording; reopening (no link) finishes the upload but never
// sends it: the client is asked to send or delete it.
await client.click("[data-testid=reply-sent] >> text=Record another");
await client.click("button:has-text('Record video reply')");
await client.waitForSelector("text=/Recording · \\d/");
await client.waitForTimeout(5000);
await client.close({ runBeforeUnload: false });
const client2 = await clientCtx.newPage();
client2.on("dialog", (d) => (console.log("dialog:", d.message()), d.dismiss()));
await skipIntro(client2);
await client2.goto(link);
await client2.waitForSelector("[data-testid=held-reply]", { state: "attached", timeout: 30000 });
console.log("interrupted reply recovered, not sent:", (await client2.$$eval("aside ul video", (els) => els.length)) === 1);
await client2.click("[data-testid=chat-open]");
await client2.waitForSelector("[data-testid=held-reply] video", { timeout: 30000 });
await client2.click("[data-testid=held-reply] >> button:has-text('Send it')");
await client2.waitForFunction(() => document.querySelectorAll("aside ul video").length === 2, null, { timeout: 30000 });
console.log("interrupted reply sent once asked, playable:", await client2.$$eval("aside ul video", (els) => els.length));
await client2.click("[data-testid=chat-close]");

// Coach sees and answers
await coach.reload();
await coach.waitForSelector("aside ul >> text=Felt strong this week!");
await coach.fill('textarea[aria-label="Reply"]', "Great work Sam.");
await coach.click("button:has-text('Send reply')");
await coach.waitForSelector("aside ul >> text=Great work Sam.");
await coach.waitForFunction(() => document.querySelectorAll("aside ul audio").length === 1 && document.querySelectorAll("aside ul video").length === 2, null, { timeout: 20000 });
console.log("coach sees all replies decrypted");
await coach.screenshot({ path: `${shots}/reply-coach.png` });

// A second device for the coach needs the recovery key
const laptop = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
await laptop.goto(BASE + "/login?next=" + encodeURIComponent("/v/" + rootId));
await laptop.fill('input[name="email"]', email);
await laptop.click("text=Continue");
await laptop.waitForSelector("text=Unlock your videos in this browser");
await laptop.fill('input[aria-label="Recovery key"]', "A".repeat(43));
await laptop.click("button:has-text('Unlock')");
// Next.js's route announcer is also role=alert (empty), so wait for the message itself.
console.log("wrong recovery key:", await laptop.textContent("p[role=alert]", { timeout: 15000 }));
await laptop.fill('input[aria-label="Recovery key"]', recoveryKey);
await laptop.click("button:has-text('Unlock')");
await laptop.waitForSelector("main video", { timeout: 20000 });
// Decrypting the whole file on a fresh device can take a while on a dev server.
await laptop.waitForFunction(() => Number.isFinite(document.querySelector("main video")?.duration), null, { timeout: 30000 }).catch(() => {});
console.log("new device with recovery key, duration", await laptop.$eval("main video", finiteDuration));

// Seat limit on Free (3)
for (const n of ["Two", "Three"]) {
  await coach.goto(BASE + "/clients");
  await coach.fill('input[aria-label="Client name"]', `Client ${n}`);
  await coach.click("button:has-text('Add client')");
  await coach.waitForSelector(`text=Client ${n}`);
}
console.log("add button disabled when full:", await coach.isDisabled("button:has-text('Add client')"));

// Relay window: force the copy past its deletion date and run the daily job
sql(`update "Video" set "purgeAt"=now() - interval '1 minute' where id='${rootId}'`);
const purge = await strangerCtx.request.get(`${BASE}/api/cron/purge`, { headers: { authorization: "Bearer test-cron-secret" } });
console.log("purge job:", purge.status(), await purge.text());
console.log("purge without secret:", (await strangerCtx.request.get(`${BASE}/api/cron/purge`)).status());
await client2.reload();
await client2.waitForSelector("text=deleted from SureFrame");
const onDisk = (() => { try { statSync(join(".data/uploads", keyPath)); return true; } catch { return false; } })();
const inDb = sql(`select count(*) from "StoredPart" where key='${keyPath}'`) !== "0";
console.log("client sees expiry notice; file on server:", onDisk || inDb ? "still there" : "deleted");

await browser.close();
