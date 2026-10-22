// A video reply on a phone: the conversation panel keeps the Record button on screen with the camera open, and
// flipping the camera gives the preview a fresh picture at full size (not the old stream's size).
import { execFileSync } from "node:child_process";
import { chromium, devices } from "@playwright/test";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  // Two cameras, so Flip camera shows.
  args: ["--use-fake-device-for-media-stream=device-count=2", "--use-fake-ui-for-media-stream"],
});

// Record a short video on a computer, to reply to.
const email = `phonereply${Date.now()}@acme.com`;
await agreed(email);
let state, url;
{
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/record");
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL("**/record");
  await page.click("text=I've saved it");
  await page.click("text=Camera only");
  await page.click("text=Start recording");
  await page.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.click("button:has-text('Stop')");
  await page.waitForURL("**/v/**", { timeout: 30000 });
  url = page.url();
  state = await ctx.storageState();
  await ctx.close();
}

// Phones of different heights, the shortest first.
for (const [name, device] of [["iPhone SE", devices["iPhone SE"]], ["iPhone 13", devices["iPhone 13"]], ["Pixel 7", devices["Pixel 7"]]]) {
  // Chromium stands in for the phone's browser; the fake camera needs it.
  const phone = { ...device };
  delete phone.defaultBrowserType;
  const ctx = await browser.newContext({
    ...phone,
    storageState: state,
    permissions: ["camera", "microphone"],
  });
  const page = await ctx.newPage();
  await page.goto(url);
  // Before it's played, the video shows a picture from the recording, not a black box.
  const cover = await page.waitForSelector("[data-testid=poster-cover] img", { timeout: 30000 }).catch(() => null);
  ok(`${name}: the video shows a picture from it before playing`, !!cover && (await cover.evaluate((i) => i.complete && i.naturalWidth > 0)));
  if (name === "iPhone SE") {
    await page.tap("[data-testid=poster-cover]");
    ok(`${name}: tapping the picture plays the video`, !!(await page.waitForFunction(() => { const v = document.querySelector("main video"); return v && !v.paused; }, null, { timeout: 10000 }).catch(() => null)));
    ok(`${name}: the picture goes once it plays`, (await page.locator("[data-testid=poster-cover]").count()) === 0);
    await page.evaluate(() => document.querySelector("main video").pause());
  }
  await page.click("[data-testid=chat-open]", { timeout: 20000 });
  await page.click("role=tab[name='Video']");
  await page.waitForSelector("button:has-text('Flip camera')", { timeout: 15000 });
  // Decision 14: a phone flips between front and rear; the computer's camera and microphone menus aren't shown.
  ok(`${name}: Flip camera on the picture, no camera list`, (await page.getAttribute("[data-testid=reply-flip-camera]", "aria-label")) === "Flip camera: use the rear camera" && (await page.locator("[data-testid=reply-camera-select]").count()) === 0);
  const vh = page.viewportSize().height;
  const rec = await page.locator("button:has-text('Record video reply')").boundingBox();
  ok(`${name}: Record button on screen with the camera open`, !!rec && rec.y >= 0 && rec.y + rec.height <= vh, JSON.stringify({ rec, vh }));
  const frameBox = async () => page.locator("[data-testid=reply-composer] video").evaluate((v) => {
    const r = v.parentElement.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  const before = await frameBox();
  await page.locator("[data-testid=reply-composer] video").evaluate((v) => (v.dataset.old = "1"));
  await page.click("button:has-text('Flip camera')");
  await page.waitForFunction(() => {
    const v = document.querySelector("[data-testid=reply-composer] video");
    return v && !v.dataset.old && v.srcObject && v.readyState >= 2;
  }, null, { timeout: 15000 });
  ok(`${name}: flipping draws a fresh preview`, true);
  await page.waitForTimeout(500);
  const after = await frameBox();
  ok(`${name}: preview keeps its size after flipping`, Math.abs(after.w - before.w) <= 2 && Math.abs(after.h - before.h) <= 2, JSON.stringify({ before, after }));
  const rec2 = await page.locator("button:has-text('Record video reply')").boundingBox();
  ok(`${name}: Record button still on screen after flipping`, !!rec2 && rec2.y + rec2.height <= vh);
  const tracks = await page.evaluate(() => document.querySelector("[data-testid=reply-composer] video").srcObject.getTracks().filter((t) => t.readyState === "live").length);
  ok(`${name}: preview shows pictures only, one live track`, tracks === 1, String(tracks));
  await page.screenshot({ path: `${shots}/phone-reply-${name.replace(/\s/g, "-")}.png` });
  // Recording still works from the phone panel.
  await page.click("button:has-text('Record video reply')");
  await page.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
  await page.waitForTimeout(1500);
  const stop = await page.locator("button:has-text('Stop recording')").boundingBox();
  ok(`${name}: Stop button on screen while recording`, !!stop && stop.y + stop.height <= vh);
  await page.click("button:has-text('Stop recording')");
  await page.waitForSelector("[data-testid=reply-review] video", { timeout: 15000 });
  await page.click("button:has-text('Send video reply')");
  await page.waitForSelector("[data-testid=reply-sent]", { timeout: 30000 });
  ok(`${name}: video reply sends`, true);
  // In the conversation it's a small still with a play button, not a full-size player.
  const chip = page.locator("[data-testid=conversation] li [data-testid=reply-video-chip]").last();
  await chip.waitFor({ timeout: 30000 });
  await page.waitForSelector("[data-testid=conversation] li [data-testid=reply-video-chip] [data-testid=reply-video-still]", { timeout: 30000 });
  const small = await chip.boundingBox();
  ok(`${name}: the sent video reply is a small still in the chat`, !!small && small.height <= 100 && small.width <= 170, JSON.stringify(small));
  ok(`${name}: no player in the chat until it's tapped`, (await page.locator("[data-testid=conversation] li video[controls]").count()) === 0);
  await chip.tap();
  const big = page.locator("[data-testid=reply-video-dialog][open] video[controls]");
  await big.waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const box = await big.boundingBox();
  const vw = page.viewportSize().width;
  ok(`${name}: tapping it plays it large over the page`, !!box && box.width >= vw * 0.85, JSON.stringify({ box, vw }));
  ok(`${name}: it starts playing`, await big.evaluate((v) => !v.paused || v.ended));
  await page.screenshot({ path: `${shots}/phone-reply-open-${name.replace(/\s/g, "-")}.png` });
  await page.click("[data-testid=reply-video-dialog][open] [data-testid=reply-video-close]");
  await page.waitForTimeout(300);
  ok(`${name}: Close shuts it and nothing keeps playing`, (await page.locator("[data-testid=reply-video-dialog][open]").count()) === 0 && (await page.locator("[data-testid=reply-video-dialog] video").count()) === 0);
  await chip.tap();
  await big.waitFor({ timeout: 15000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  ok(`${name}: Escape closes it too`, (await page.locator("[data-testid=reply-video-dialog][open]").count()) === 0);
  ok(`${name}: Escape leaves the conversation open`, await page.isVisible("[data-testid=reply-sent]"));
  await ctx.close();
}

// A computer (Decision 14, C54): Camera and Microphone menus, no Flip camera, and Record right under the picture.
{
  const ctx = await browser.newContext({ storageState: state, permissions: ["camera", "microphone"], viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.click("[data-testid=chat-open]", { timeout: 20000 });
  await page.click("role=tab[name='Video']");
  await page.waitForSelector("[data-testid=reply-camera-select]", { timeout: 15000 });
  const cams = await page.$$eval("[data-testid=reply-camera-select] option", (os) => os.map((o) => o.value).filter(Boolean));
  ok("computer: a Camera menu lists its cameras", cams.length === 2, JSON.stringify(cams));
  ok("computer: a Microphone menu too", (await page.locator("[data-testid=reply-mic-select]").count()) === 1);
  ok("computer: no Flip camera", (await page.locator("[data-testid=reply-flip-camera]").count()) === 0);
  const picture = await page.locator("[data-testid=reply-composer] video").evaluate((v) => v.parentElement.getBoundingClientRect().bottom);
  const rec = await page.locator("button:has-text('Record video reply')").boundingBox();
  ok("computer: Record is right under the picture", !!rec && rec.y >= picture && rec.y - picture <= 16, JSON.stringify({ picture, rec }));
  const menus = await page.locator("[data-testid=reply-devices]").boundingBox();
  ok("computer: the menus are under Record, not between it and the picture", !!menus && !!rec && menus.y > rec.y);
  await page.locator("[data-testid=reply-composer] video").evaluate((v) => (v.dataset.old = "1"));
  await page.selectOption("[data-testid=reply-camera-select]", cams[1]);
  const using = await page
    .waitForFunction(
      (id) => {
        const v = document.querySelector("[data-testid=reply-composer] video");
        return v && !v.dataset.old && v.srcObject && v.srcObject.getVideoTracks()[0]?.getSettings().deviceId === id;
      },
      cams[1],
      { timeout: 15000 },
    )
    .then(() => true, () => false);
  ok("computer: choosing a camera switches the picture to it", using);
  await page.click("button:has-text('Record video reply')");
  await page.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
  ok("computer: the menus go while recording", (await page.locator("[data-testid=reply-devices]").count()) === 0);
  await page.waitForTimeout(1200);
  await page.click("button:has-text('Stop recording')");
  await page.waitForSelector("[data-testid=reply-review] video", { timeout: 15000 });
  ok("computer: recorded with the chosen camera", true);
  await page.screenshot({ path: `${shots}/reply-devices-computer.png` });
  await ctx.close();
}

await browser.close();

// A portrait camera, the way most phones send their picture: the tall preview still leaves Record on screen.
// Needs ffmpeg to make the fake camera's picture; skipped without it.
const y4m = `${shots}/portrait-camera.y4m`;
let made = false;
try {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=30", "-t", "2", "-pix_fmt", "yuv420p", y4m]);
  made = true;
} catch {
  console.log("SKIP portrait camera checks: no ffmpeg");
}
if (made) {
  const tall = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? undefined,
    args: ["--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`, "--use-fake-ui-for-media-stream"],
  });
  for (const [name, device] of [["iPhone SE", devices["iPhone SE"]], ["iPhone 13", devices["iPhone 13"]]]) {
    const phone = { ...device };
    delete phone.defaultBrowserType;
    const ctx = await tall.newContext({ ...phone, storageState: state, permissions: ["camera", "microphone"] });
    const page = await ctx.newPage();
    await page.goto(url);
    await page.click("[data-testid=chat-open]", { timeout: 20000 });
    await page.click("role=tab[name='Video']");
    await page.waitForFunction(() => {
      const v = document.querySelector("[data-testid=reply-composer] video");
      return v && v.videoHeight > v.videoWidth;
    }, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const vh = page.viewportSize().height;
    const box = await page.locator("[data-testid=reply-composer] video").evaluate((v) => {
      const r = v.parentElement.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    ok(`${name} portrait: preview is tall, the camera's own shape`, box.h > box.w, JSON.stringify(box));
    const rec = await page.locator("button:has-text('Record video reply')").boundingBox();
    ok(`${name} portrait: Record button on screen`, !!rec && rec.y >= 0 && rec.y + rec.height <= vh, JSON.stringify({ rec, vh }));
    await page.screenshot({ path: `${shots}/phone-reply-portrait-${name.replace(/\s/g, "-")}.png` });
    await ctx.close();
  }
  await tall.close();
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
