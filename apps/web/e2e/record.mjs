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
ok("first recording: camera, microphone and quality are all in view", (await page.locator("[data-testid=recorder-settings]").count()) === 0);
await page.click("text=Start recording");
// O30: the countdown says recording hasn't started yet, and nothing said during it is lost or counted.
ok("countdown says recording hasn't started yet", !!(await page.waitForSelector("[data-testid=countdown-note]", { timeout: 5000 }).catch(() => null)));
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
// What was recorded is the time from "Recording" to Stop: the countdown isn't in it, and nothing after it is cut.
const elapsed = Date.now() - t0;
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const stored = await prisma.video.findUnique({ where: { id: firstUrl.split("/v/")[1].split("?")[0] }, select: { durationMs: true } });
ok("stored length covers the whole recording after the countdown (O30)", stored?.durationMs >= 5500 && stored.durationMs <= 6000 + 3000, `${stored?.durationMs}ms for ~6000ms recorded`);
ok("the player's length matches (O30)", !Number.isFinite(dur) || (dur >= 5.3 && dur <= 9.5), `player ${dur}s, page time ${elapsed}ms`);
await prisma.$disconnect();
await page.fill('textarea[aria-label="Reply"]', "Looks great, ship it");
await page.click("button:has-text('Send reply')");
await page.waitForSelector("aside ul >> text=Looks great, ship it");
await page.screenshot({ path: `${shots}/watch.png` });

// 2) Crash mid-recording: record 25s (>5MB => at least one part uploaded), then kill the page.
await page.goto(BASE + "/record");
await page.click("text=Camera only");
// D12: after the first recording, the device choices fold away (the mic check stays in view).
const fold = page.locator("[data-testid=recorder-settings]");
ok("after a first recording: settings folded under Camera, microphone and quality", (await fold.count()) === 1 && !(await fold.evaluate((d) => d.open)) && (await page.textContent("[data-testid=recorder-settings] summary")) === "Camera, microphone and quality");
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

// A Mac that hasn't allowed the browser to record the screen: Chrome refuses "by system" after the picker closes.
// The recorder says how to fix it rather than going back to the start with nothing said.
const macPage = await ctx.newPage();
await macPage.addInitScript(() => {
  Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36" });
  navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException("Permission denied by system", "NotAllowedError"));
});
await macPage.goto(BASE + "/record");
await macPage.click("text=Screen only");
await macPage.click("text=Start recording");
const blockedNote = await macPage.waitForSelector("text=/didn't let this browser share your screen/", { timeout: 20000 }).then((e) => e.textContent()).catch(() => "");
ok("screen blocked by the Mac's settings: says where to turn it on", blockedNote.includes("Screen & System Audio Recording"), blockedNote);

// The Mac's settings blocking the camera: said as soon as the preview asks, not "allow it in the address bar".
const camBlocked = await ctx.newPage();
await camBlocked.addInitScript(() => {
  Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36" });
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) => (c?.video ? Promise.reject(new DOMException("Permission denied by system", "NotAllowedError")) : real(c));
});
await camBlocked.goto(BASE + "/record");
const camNote = await camBlocked.waitForSelector("text=/didn't let this browser use your camera/", { timeout: 20000 }).then((e) => e.textContent()).catch(() => "");
ok("camera blocked by the Mac's settings: the preview says where to turn it on", camNote.includes("Privacy & Security") && !camNote.includes("address bar"), camNote);
await browser.close();
