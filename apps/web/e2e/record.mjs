// Drives a real Chromium with fake camera/mic through: sign in, record, stop,
// watch; then a crash mid-recording followed by automatic recovery.
import { chromium, devices } from "@playwright/test";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${detail}`}`);
  if (!cond) process.exitCode = 1;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));

await page.goto(BASE + "/");
await page.screenshot({ path: `${shots}/landing.png`, fullPage: true });
await page.goto(BASE + "/pricing");
await page.screenshot({ path: `${shots}/pricing.png`, fullPage: true });

await page.goto(BASE + "/record");
const loginEmail = `demo${Date.now()}@acme.com`;
await agreed(loginEmail);
await page.fill('input[name="email"]', loginEmail);
await page.click("text=Continue");
await page.waitForURL("**/record");
await page.click("text=I've saved it"); // first device: recovery key shown once

// 1) Normal recording
await page.click("text=Camera only");
await page.click("text=Start recording");
await page.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
const t0 = Date.now(); await page.waitForTimeout(6000);
await page.screenshot({ path: `${shots}/recording.png` });
console.log("clicking stop after", Date.now() - t0, await page.textContent("text=/Recording · \\d/")); await page.click("button:has-text('Stop')");
await page.waitForURL("**/v/**", { timeout: 30000 });
const firstUrl = page.url();
await page.waitForSelector("main video", { timeout: 20000 });
const dur = await page.$eval("main video", (v) => new Promise((r) => {
  const check = () => (Number.isFinite(v.duration) ? r(v.duration) : setTimeout(check, 200));
  check();
  setTimeout(() => r(v.duration), 10000);
}));
console.log("watch url", firstUrl, "player duration", dur);
await page.fill('textarea[aria-label="Reply"]', "Looks great, ship it");
await page.click("button:has-text('Send reply')");
await page.waitForSelector("aside ul >> text=Looks great, ship it");
await page.screenshot({ path: `${shots}/watch.png` });

// 2) Crash mid-recording: record 25s (>5MB => at least one part uploaded), then kill the page.
await page.goto(BASE + "/record");
await page.click("text=Camera only");
await page.click("text=Start recording");
await page.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await page.waitForTimeout(25000);
const status = await page.textContent("text=/Uploaded: /");
console.log("before crash:", status);
await page.close({ runBeforeUnload: false });

const page2 = await ctx.newPage();
await page2.goto(BASE + "/record");
await page2.waitForSelector("text=We finished uploading", { timeout: 30000 });
console.log("recovery banner shown");
await page2.screenshot({ path: `${shots}/recovered.png` });
const recoveredHref = await page2.getAttribute("text=View it", "href");
await page2.goto(BASE + recoveredHref);
await page2.waitForSelector("main video", { timeout: 20000 });
const dur2 = await page2.$eval("main video", (v) => new Promise((r) => {
  const check = () => (Number.isFinite(v.duration) ? r(v.duration) : setTimeout(check, 200));
  check();
  setTimeout(() => r(v.duration), 10000);
}));
console.log("recovered video duration", dur2);

await page2.goto(BASE + "/library");
await page2.screenshot({ path: `${shots}/library.png` });

// The plan's length limit, and what happens at it, is said before Start.
await page2.goto(BASE + "/record");
ok("length limit said before recording", /up to .+\. At .+ the recording stops and is saved by itself/.test(await page2.textContent("[data-testid=length-limit]")));

// Closing the browser while "Discard this recording?" is open: it counts as discarded, never uploaded.
await page2.click("text=Camera only");
await page2.click("text=Start recording");
await page2.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
ok("no recovery note while recording", (await page2.locator("[data-testid=recorder-recovered]").count()) === 0);
await page2.waitForTimeout(3000);
const pendingId = await page2.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open("framecast-recorder");
  req.onsuccess = () => {
    const all = req.result.transaction("sessions").objectStore("sessions").getAll();
    all.onsuccess = () => resolve(all.result.at(-1)?.videoId ?? null);
  };
}));
await page2.click("text=Discard and start over");
await page2.waitForSelector("[data-testid=discard-confirm]");
await page2.waitForTimeout(800);
await page2.close({ runBeforeUnload: false });
const page3 = await ctx.newPage();
await page3.goto(BASE + "/library");
await page3.waitForTimeout(5000);
ok("an unanswered Discard isn't recovered", (await page3.locator("[data-testid=recovered-uploads]").count()) === 0);
const gone = await page3.evaluate(async (id) => (await fetch(`/api/videos/${id}`)).status, pendingId);
ok("and the recording is deleted, not uploaded", !!pendingId && gone === 404, `${pendingId} ${gone}`);

// On a phone, the screen modes are greyed with a reason.
const phoneCtx = await browser.newContext({ ...devices["Pixel 7"], permissions: ["camera", "microphone"], storageState: await ctx.storageState() });
const phone = await phoneCtx.newPage();
await phone.goto(BASE + "/record");
await phone.waitForSelector("[data-testid=mode-camera]", { timeout: 20000 });
ok("phone: screen modes greyed, camera chosen", (await phone.getAttribute("[data-testid=mode-screen]", "aria-disabled")) === "true" && (await phone.isChecked("[data-testid=mode-camera] input")));
ok("phone: says why", await phone.isVisible("[data-testid=screen-modes-note]"));
await browser.close();
