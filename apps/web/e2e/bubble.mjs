// Screen + camera: the floating camera bubble opens with the recording, and the page doesn't show the camera full size.
import { chromium } from "@playwright/test";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  // A tab is shared here; the whole-screen case is at the end.
  args: ["--use-fake-device-for-media-stream", "--auto-accept-this-tab-capture"],
});
const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1360, height: 900 } });
// The test browser can only share a tab when it's this one.
await ctx.addInitScript(() => {
  const gdm = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getDisplayMedia = (o) => gdm({ ...o, preferCurrentTab: true });
});
const page = await ctx.newPage();
await page.goto(BASE + "/record");
const email = `bubble${Date.now()}@acme.com`;
await agreed(email);
await page.fill('input[name="email"]', email);
await page.click("text=Continue");
await page.waitForURL("**/record");
await page.click("text=I've saved it");

// Screen + camera never shows the camera full size: it's a circle tucked into the bottom-left corner, as in the video.
const circleLive = () => page.waitForFunction(() => {
  const t = document.querySelector("[data-testid=camera-circle] video")?.srcObject?.getVideoTracks?.()[0];
  return !!t && t.readyState === "live";
}, null, { timeout: 8000 }).then(() => true, () => false);
const circle = () => page.evaluate(() => {
  const v = document.querySelector("[data-testid=camera-circle]");
  const panel = v.parentElement.getBoundingClientRect();
  const r = v.getBoundingClientRect();
  return { w: r.width, h: r.height, left: r.left - panel.left, right: panel.right - r.right, top: r.top - panel.top, bottom: panel.bottom - r.bottom, panelH: panel.height, videos: document.querySelectorAll("main video").length, corner: v.dataset.corner };
});
ok("setup: the camera is a live circle", await circleLive());
let c = await circle();
console.log("setup circle", JSON.stringify(c));
ok("setup: round, a quarter of the height, tucked into the bottom-left corner", Math.abs(c.w - c.h) < 1 && Math.abs(c.h / c.panelH - 0.24) < 0.02 && Math.abs(c.left - c.panelH * 0.03) < 2 && Math.abs(c.bottom - c.panelH * 0.03) < 2, JSON.stringify(c));
ok("setup: and no full-size camera", c.videos === 1);
// Dragged towards the top right and let go: it snaps into that corner, the same gap from both edges.
{
  // The recovery key note under the header can appear a moment after the page loads and push the page down, so wait
  // for the circle to stay put before taking hold of it.
  const steady = async () => {
    let last = "";
    for (let i = 0; i < 20; i++) {
      const now = JSON.stringify(await page.locator("[data-testid=camera-circle]").boundingBox());
      if (now === last) return;
      last = now;
      await page.waitForTimeout(250);
    }
  };
  await steady();
  const box = await page.locator("[data-testid=camera-circle]").boundingBox();
  const panel = await page.locator("[data-testid=camera-circle]").evaluate((v) => v.parentElement.getBoundingClientRect().toJSON());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(panel.right - 40, panel.top + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  c = await circle();
  ok("drag: snaps into the top-right corner", c.corner === "top-right" && Math.abs(c.right - c.panelH * 0.03) < 2 && Math.abs(c.top - c.panelH * 0.03) < 2, JSON.stringify(c));
  ok("drag: the Camera position buttons agree", (await page.getAttribute("[data-testid=corner-top-right]", "aria-pressed")) === "true");
  await page.reload();
  await page.waitForSelector("[data-testid=camera-circle]");
  ok("remembered in this browser", (await page.getAttribute("[data-testid=camera-circle]", "data-corner")) === "top-right");
  await page.click("[data-testid=corner-bottom-left]");
  ok("the buttons move it back to the bottom left", (await page.getAttribute("[data-testid=camera-circle]", "data-corner")) === "bottom-left");
}
await page.screenshot({ path: `${shots}/bubble-setup.png` });
await page.click("text=Start recording");
await page.waitForSelector("text=/Recording · \\d/", { timeout: 20000 }).catch(async (e) => {
  await page.screenshot({ path: `${shots}/bubble-fail.png` });
  console.log("page text:", (await page.textContent("main"))?.slice(0, 600));
  throw e;
});
ok("the bubble opens with the recording", await page.evaluate(() => !!window.documentPictureInPicture?.window));
const shape = await page.evaluate(() => {
  const w = window.documentPictureInPicture.window;
  const v = w.document.querySelector("video");
  const r = v.getBoundingClientRect();
  return { w: r.width, h: r.height, win: [w.innerWidth, w.innerHeight], radius: w.getComputedStyle(v).borderRadius };
});
console.log("bubble", JSON.stringify(shape));
ok("the bubble is a true circle, not an oval", shape.w > 0 && Math.abs(shape.w - shape.h) < 1 && shape.radius === "50%", JSON.stringify(shape));
ok("and as big as the window allows above its buttons", Math.abs(Math.min(shape.win[0], shape.win[1] - 52) - shape.w) < 1, JSON.stringify(shape));
// The bubble's own buttons run the recording from any window: the time, Pause/Resume and Stop.
const bar = () => page.evaluate(() => {
  const d = window.documentPictureInPicture.window.document;
  return { shown: d.querySelector("[data-testid=bubble-controls]")?.style.visibility, time: d.querySelector("[data-testid=bubble-time]")?.textContent, pause: d.querySelector("[data-testid=bubble-pause]")?.textContent, stop: d.querySelector("[data-testid=bubble-stop]")?.textContent };
});
await page.waitForTimeout(1300);
let b = await bar();
ok("the bubble shows the time, Pause and Stop while recording", b.shown === "visible" && /^\d+:\d\d$/.test(b.time) && b.time !== "0:00" && b.pause === "Pause" && b.stop === "Stop", JSON.stringify(b));
await page.evaluate(() => window.documentPictureInPicture.window.document.querySelector("[data-testid=bubble-pause]").click());
await page.waitForTimeout(400);
b = await bar();
ok("Pause in the bubble pauses the recording, and the button becomes Resume", b.pause === "Resume" && (await page.locator("text=/Paused · \\d/").count()) === 1, JSON.stringify(b));
const held = b.time;
await page.waitForTimeout(1300);
ok("the bubble's time stands still while paused", (await bar()).time === held);
await page.evaluate(() => window.documentPictureInPicture.window.document.querySelector("[data-testid=bubble-pause]").click());
await page.waitForTimeout(400);
ok("Resume in the bubble carries on recording", (await bar()).pause === "Pause" && (await page.locator("text=/Recording · \\d/").count()) === 1);
ok("and the page shows the screen panel with the corner circle", (await page.locator("[data-testid=screen-panel]").count()) === 1 && (await circleLive()));
ok("and says where the camera is: the corner circle in the video, the bubble on screen", (await page.locator("text=the floating bubble shows you, with Pause and Stop").count()) === 1);
await page.screenshot({ path: `${shots}/bubble-recording.png` });

// Not stopped here: in this test browser, closing the bubble while this same tab is shared also closes the tab.
// Stopping (which closes the bubble) is covered by the whole-screen run below and by compose.mjs.
await browser.close();

// Screen only: a floating bar with the time, Pause and Stop, and no camera.
{
  const own = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined, args: ["--use-fake-device-for-media-stream", "--auto-accept-this-tab-capture"] });
  const c = await own.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1360, height: 900 } });
  await c.addInitScript(() => {
    const gdm = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = (o) => gdm({ ...o, preferCurrentTab: true });
  });
  const p = await c.newPage();
  await p.goto(BASE + "/record");
  const e = `bubblebar${Date.now()}@acme.com`;
  await agreed(e);
  await p.fill('input[name="email"]', e);
  await p.click("text=Continue");
  await p.waitForURL("**/record");
  await p.click("text=I've saved it");
  await p.click("text=Screen only");
  await p.click("text=Start recording");
  await p.waitForSelector("text=/Recording · \\d/", { timeout: 20000 });
  await p.waitForTimeout(1300);
  const w = await p.evaluate(() => {
    const d = window.documentPictureInPicture?.window?.document;
    return d && { video: !!d.querySelector("video"), bar: d.querySelector("[data-testid=bubble-controls]")?.style.visibility, stop: !!d.querySelector("[data-testid=bubble-stop]") };
  });
  ok("screen only: a floating bar with Pause and Stop opens, without a camera", !!w && !w.video && w.bar === "visible" && w.stop, JSON.stringify(w));
  await own.close();
}

// The whole screen shared: the floating window would be recorded too, so it closes, and the camera is the circle drawn into the video.
{
  const whole = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? undefined,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--auto-select-desktop-capture-source=Entire screen"],
  });
  const c = await whole.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1360, height: 900 } });
  const p = await c.newPage();
  await p.goto(BASE + "/record");
  const e = `bubblewhole${Date.now()}@acme.com`;
  await agreed(e);
  await p.fill('input[name="email"]', e);
  await p.click("text=Continue");
  await p.waitForURL("**/record");
  await p.click("text=I've saved it");
  await p.click("text=Start recording");
  await p.waitForSelector("text=/Recording · \\d/", { timeout: 20000 });
  ok("whole screen: the floating window closes", await p.evaluate(() => !window.documentPictureInPicture?.window));
  ok("and the page says the camera is the circle in the video", (await p.locator("text=Your camera is in the circle in the corner of the video").count()) === 1);
  ok("and says to come back to this tab to pause or stop (O45)", (await p.locator("text=Come back to this tab to pause or stop.").count()) === 1);
  ok("and offers no pop-out button", (await p.locator("text=Pop out camera bubble").count()) === 0);
  ok("and shows a small camera circle on the page", (await p.locator("[data-testid=camera-circle]").count()) === 1);
  await p.waitForTimeout(2000);
  await p.click("button:has-text('Stop')");
  await p.waitForURL("**/v/**", { timeout: 30000 });
  ok("and the video saves", p.url().includes("/v/"));
  await whole.close();
}
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
