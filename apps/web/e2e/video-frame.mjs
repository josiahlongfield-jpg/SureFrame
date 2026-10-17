// Video frames take the video's own shape, so a camera that isn't 16:9 (a
// phone's portrait camera, simulated here) fills its frame with
// no black bars: the recording preview, the main player, the video-reply
// camera preview (on a phone-sized screen too) and video-reply playback.
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";
import { agreed } from "./agree.mjs";

const shots = process.argv[2] ?? "/tmp/claude-0/video-frame-shots";
mkdirSync(shots, { recursive: true });

const BASE = process.env.BASE ?? "http://localhost:3000";
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};
const prisma = new PrismaClient();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});

/** The video's own shape vs its frame's shape (the frame is the video's box; object-fit doesn't change it). */
const measure = (sel) => {
  const v = [...document.querySelectorAll(sel)].find((el) => el.videoWidth);
  if (!v) return null;
  const box = (v.parentElement ?? v).getBoundingClientRect();
  const r = v.getBoundingClientRect();
  return { video: v.videoWidth / v.videoHeight, frame: box.width / box.height, box: r.width / r.height, wide: box.width <= document.documentElement.clientWidth + 1 };
};
// Waits for the frame to settle on the video's shape; on timeout, reports what's there.
const shape = (page, selector) =>
  page
    .waitForFunction(
      ([sel, src]) => {
        const m = new Function(`return (${src})`)()(sel);
        return m && Math.abs(m.frame - m.video) / m.video < 0.02 ? m : null;
      },
      [selector, measure.toString()],
      { timeout: 15000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => page.evaluate(([sel, src]) => new Function(`return (${src})`)()(sel), [selector, measure.toString()]));
const fills = (s) => Math.abs(s.frame - s.video) / s.video < 0.02 && Math.abs(s.box - s.frame) / s.frame < 0.02;

const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1360, height: 900 } });
// Act like a phone held upright: the camera delivers a portrait picture.
await ctx.addInitScript(() => {
  const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) =>
    get(c?.video ? { ...c, video: { ...(typeof c.video === "object" ? c.video : {}), width: { exact: 480 }, height: { exact: 640 } } } : c);
});
const page = await ctx.newPage();
const email = `frame${Date.now()}@acme.com`;
await page.goto(BASE + "/record");
await agreed(email);
await page.fill('input[name="email"]', email);
await page.click("text=Continue");
await page.waitForURL("**/record");
await page.click("text=I've saved it");
await page.click("text=Camera only");
let s = await shape(page, "video");
ok("recording preview: frame is the camera's shape, not 16:9", fills(s) && s.video < 1, JSON.stringify(s));
await page.click("text=Start recording");
await page.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await page.waitForTimeout(2500);
await page.click("button:has-text('Stop')");
await page.waitForURL("**/v/**", { timeout: 30000 });
const videoId = page.url().split("/v/")[1].split("?")[0];
for (let i = 0; i < 100 && (await prisma.video.findUnique({ where: { id: videoId } })).status === "RECORDING"; i++) await page.waitForTimeout(200);
await page.reload();
s = await shape(page, "main video");
ok("main player: no black bars", fills(s), JSON.stringify(s));
await page.screenshot({ path: `${shots}/desktop-player.png` });

// Phone-sized screen: the video-reply camera preview and the reply's playback.
await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.click("[data-testid=chat-open]");
await page.click("button:has-text('Video')");
s = await shape(page, "[data-testid=conversation] video[autoplay]");
ok("reply camera preview (phone): fills its frame", fills(s) && s.wide, JSON.stringify(s));
await page.screenshot({ path: `${shots}/phone-reply-camera.png` });
await page.click("text=Record video reply");
await page.waitForTimeout(2500);
await page.click("text=Stop recording");
await page.click("text=Send video reply");
await page.waitForSelector("[data-testid=conversation] ul video[controls]", { timeout: 30000 });
s = await shape(page, "[data-testid=conversation] ul video[controls]");
ok("video reply playback: no black bars", fills(s) && s.wide, JSON.stringify(s));
await page.screenshot({ path: `${shots}/phone-reply-playback.png` });

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
