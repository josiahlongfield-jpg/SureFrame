// Screen + camera: the camera is drawn into the recording as a circle, and the recording keeps going
// while the SureFrame tab is in the background.
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
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--auto-select-desktop-capture-source=Entire screen"],
});
const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1360, height: 900 } });
// Keep hold of what the recorder records, and count the frames it gets.
await ctx.addInitScript(() => {
  const MR = window.MediaRecorder;
  window.MediaRecorder = class extends MR {
    constructor(stream, opts) {
      super(stream, opts);
      window.__recorded = stream;
    }
  };
  window.MediaRecorder.isTypeSupported = MR.isTypeSupported.bind(MR);
  // Unplugging a camera ends every copy of its track; stopping one track doesn't, so keep the copies.
  window.__clones = [];
  const clone = MediaStreamTrack.prototype.clone;
  MediaStreamTrack.prototype.clone = function () {
    const c = clone.call(this);
    if (this.kind === "video") window.__clones.push(c);
    return c;
  };
});
const page = await ctx.newPage();
await page.goto(BASE + "/record");
const email = `compose${Date.now()}@acme.com`;
await agreed(email);
await page.fill('input[name="email"]', email);
await page.click("text=Continue");
await page.waitForURL("**/record");
await page.click("text=I've saved it");

await page.click("text=Start recording");
await page.waitForSelector("text=/Recording · \\d/", { timeout: 20000 });
ok("the recording's picture is the combined one, not the raw screen", await page.evaluate(() => {
  const t = window.__recorded?.getVideoTracks()[0];
  return !!t && "writable" in t;
}));
// The bubble closed: the circle goes to the bottom-left corner.
await page.evaluate(() => window.documentPictureInPicture?.window?.close());

const countFrames = () =>
  page.evaluate(() => new Promise((done) => {
    const v = document.createElement("video");
    v.muted = true;
    v.srcObject = new MediaStream(window.__recorded.getVideoTracks());
    let n = 0;
    const tick = () => { n++; v.requestVideoFrameCallback(tick); };
    v.requestVideoFrameCallback(tick);
    v.play();
    setTimeout(() => { v.pause(); done(n); }, 2000);
  }));
ok("frames keep coming with the tab in front", (await countFrames()) >= 20);

// Another tab in front: the recorder's tab is hidden, and the worker keeps drawing.
const other = await ctx.newPage();
await other.goto(BASE + "/pricing");
await other.bringToFront();
await page.waitForTimeout(500);
// Headless Chromium still reports this tab as visible, so this checks the worker path, not real background throttling.
console.log("recorder tab visibility:", await page.evaluate(() => document.visibilityState));
// Counted from the track itself, not by drawing it, since a page in the background doesn't draw.
await page.evaluate(() => {
  window.__frames = 0;
  const reader = new MediaStreamTrackProcessor({ track: window.__recorded.getVideoTracks()[0].clone() }).readable.getReader();
  (async () => { for (;;) { const { value, done } = await reader.read(); if (done) break; value.close(); window.__frames++; } })();
});
await other.waitForTimeout(6000);
const hidden = await page.evaluate(() => window.__frames);
await page.bringToFront();
ok("and keep coming with another tab in front", hidden >= 6 * 20, String(hidden));

// The camera stops (unplugged): the recording carries on with the screen only, and says so.
await page.waitForTimeout(1500);
await page.evaluate(() => {
  window.__unplugged = performance.now();
  for (const v of document.querySelectorAll("video")) v.srcObject?.getVideoTracks?.().forEach((t) => t.label && !t.label.includes("screen") && t.stop());
  window.__clones.forEach((t) => t.label.includes("screen") || t.stop());
});
ok("camera unplugged: says the recording carries on with the screen", await page.waitForSelector("text=Your camera stopped", { timeout: 5000 }).then(() => true, () => false));
await page.waitForTimeout(2000);
await page.click("button:has-text('Stop')");
await page.waitForURL("**/v/**", { timeout: 30000 });
await page.waitForSelector("main video", { timeout: 20000 });
// A frame from the saved video: the camera circle sits in the bottom-left corner.
const grab = (at) => page.evaluate(({ at }) => { window.__at = at; return (new Promise((done) => {
  const v = document.querySelector("main video");
  const go = () => {
    v.currentTime = window.__at === "end" ? Math.max(0, (Number.isFinite(v.duration) ? v.duration : 8) - 0.5) : 2;
    v.addEventListener("seeked", () => {
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const g = c.getContext("2d");
      g.drawImage(v, 0, 0);
      const W = c.width, H = c.height, d = Math.round(Math.min(W, H) * 0.24), m = Math.round(Math.min(W, H) * 0.035);
      const at = (x, y) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3));
      done({ W, H, ring: at(m + d / 2, H - m - d + 1), centre: at(m + d / 2, H - m - d / 2), url: c.toDataURL("image/png") });
    }, { once: true });
  };
  if (v.readyState >= 1) go(); else v.addEventListener("loadedmetadata", go, { once: true });
  setTimeout(() => done(null), 15000);
})); }, { at });
const early = await grab("early");
const late = await grab("end");
ok("the saved video has frames to check", !!early && !!late, "no frame");
if (early && late) {
  console.log("early ring", early.ring, "centre", early.centre, "| end ring", late.ring);
  const fs = await import("node:fs");
  fs.writeFileSync(`${shots}/compose-frame.png`, Buffer.from(early.url.split(",")[1], "base64"));
  fs.writeFileSync(`${shots}/compose-frame-end.png`, Buffer.from(late.url.split(",")[1], "base64"));
  ok("with the white ring of the camera circle in the bottom-left corner", early.ring.every((c) => c > 200), JSON.stringify(early.ring));
  ok("and no circle once the camera was unplugged", !late.ring.every((c) => c > 200), JSON.stringify(late.ring));
}

await browser.close();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
