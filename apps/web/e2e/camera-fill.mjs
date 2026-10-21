// The camera picture is only ever shown filling its whole frame: never a small picture inside it first, never a
// blank one. Watched on every drawn frame of the page while a phone opens the recorder, changes Quality, flips the
// camera, the camera changes size by itself while showing (as Safari's can), and records; and the frame starts in
// the shape the camera had last time.
import { chromium, devices } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};
const db = new PrismaClient();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  args: ["--use-fake-device-for-media-stream=device-count=2", "--use-fake-ui-for-media-stream"],
});

// A paid plan, so there's a Quality menu.
const email = `camfill${Date.now()}@example.com`;
await agreed(email);
let state;
{
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  const page = await ctx.newPage();
  await page.goto(BASE + "/record");
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL("**/record");
  await page.click("text=I've saved it");
  const user = await db.user.findUnique({ where: { email }, include: { memberships: true } });
  await db.workspace.update({ where: { id: user.memberships[0].workspaceId }, data: { plan: "STUDIO" } });
  state = await ctx.storageState();
  await ctx.close();
}

const PHONE = { ...devices["iPhone 13"], permissions: ["camera", "microphone"] };
delete PHONE.defaultBrowserType;
const ctx = await browser.newContext({ ...PHONE, storageState: state });
await ctx.addInitScript(() => {
  // A phone's portrait camera, slow to start the way real ones can be.
  const md = navigator.mediaDevices;
  const gum = md.getUserMedia.bind(md);
  window.__tracks = [];
  md.getUserMedia = async (c) => {
    if (!c?.video) return gum(c);
    await new Promise((r) => setTimeout(r, 400));
    const s = await gum({ ...c, video: { ...(typeof c.video === "object" ? c.video : {}), width: { exact: 480 }, height: { exact: 640 } } });
    window.__tracks.push(...s.getVideoTracks());
    return s;
  };
  // Every drawn frame: is a camera picture showing, and does it fill its frame?
  window.__samples = [];
  const look = () => {
    for (const v of document.querySelectorAll("main video")) {
      if (!v.srcObject || !v.isConnected) continue;
      const shown = getComputedStyle(v).opacity !== "0" && v.offsetParent !== null;
      if (!shown) continue;
      const f = v.parentElement.getBoundingClientRect();
      const fit = v.videoWidth ? Math.abs(f.width / f.height - v.videoWidth / v.videoHeight) : null;
      window.__samples.push({ t: performance.now(), blank: !v.videoWidth || v.readyState < 2, off: fit !== null && fit > 0.03, fit, frame: [Math.round(f.width), Math.round(f.height)], video: [v.videoWidth, v.videoHeight] });
    }
    // The camera's own frame, once the page is on Camera only (before the page has started, it can briefly show the
    // computer's Screen + Camera layout, whose camera circle is round).
    if (!window.__firstFrame && document.querySelector("[data-testid=mode-camera] input")?.checked) {
      const f = document.querySelector("main video")?.parentElement?.getBoundingClientRect();
      if (f?.height) window.__firstFrame = f.width / f.height;
    }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
});

/** The longest run of drawn frames showing a blank or small picture, in milliseconds. */
const worst = (page) =>
  page.evaluate(() => {
    let longest = 0;
    let from = null;
    let example = null;
    for (const s of window.__samples) {
      if (s.blank || s.off) {
        from ??= s.t;
        example ??= s;
        longest = Math.max(longest, s.t - from || 16);
      } else from = null;
    }
    const n = window.__samples.length;
    window.__samples = [];
    return { longest: Math.round(longest), example, n };
  });
// One drawn frame can land between the camera's new size and the frame taking it; anything longer is seen.
const NEVER = 50;
const filled = (page) =>
  page.waitForFunction(() => {
    const v = document.querySelector("main video");
    if (!v?.videoWidth || getComputedStyle(v).opacity === "0") return false;
    const f = v.parentElement.getBoundingClientRect();
    return Math.abs(f.width / f.height - v.videoWidth / v.videoHeight) < 0.02;
  }, null, { timeout: 15000 }).then(() => page.waitForTimeout(800));

const page = await ctx.newPage();
await page.goto(BASE + "/record");
await filled(page);
let w = await worst(page);
ok("opening the camera: never a small or blank picture", w.n > 0 && w.longest <= NEVER, JSON.stringify(w));
ok("the 'Starting camera' note is gone once it shows", (await page.locator("[data-testid=camera-starting]").count()) === 0);

// Every quality in turn, and back.
const quality = "select:has(option[value='720'])";
const qualities = await page.$$eval(`${quality} option`, (o) => o.map((x) => x.value));
const first = await page.inputValue(quality);
for (const q of [...qualities.filter((q) => q !== first), first]) {
  await page.selectOption(quality, q);
  await page.waitForTimeout(200);
  await filled(page);
  w = await worst(page);
  ok(`Quality ${q}: never a small or blank picture`, w.longest <= NEVER, JSON.stringify(w));
}

// The other camera, and back.
for (const side of ["environment", "user"]) {
  await page.selectOption("[data-testid=camera-select]", side);
  await page.waitForTimeout(200);
  await filled(page);
  w = await worst(page);
  ok(`camera ${side === "user" ? "front" : "rear"}: never a small or blank picture`, w.longest <= NEVER, JSON.stringify(w));
}

// The camera changes size by itself while showing: the picture is drawn fresh, hidden until it fills again.
await page.evaluate(() => window.__tracks.filter((t) => t.readyState === "live").forEach((t) => t.applyConstraints({ width: { exact: 640 }, height: { exact: 480 } })));
await page.waitForTimeout(300);
await filled(page);
w = await worst(page);
const turned = await page.evaluate(() => [document.querySelector("main video").videoWidth, document.querySelector("main video").videoHeight]);
ok("camera changing size by itself: never a small or blank picture, and the frame follows", w.longest <= NEVER && turned[0] === 640, JSON.stringify({ w, turned }));
await page.screenshot({ path: `${shots}/camera-fill-phone.png` });

// Recording.
await page.click("text=Start recording");
await page.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await page.waitForTimeout(1500);
w = await worst(page);
ok("through the countdown and recording: never a small or blank picture", w.longest <= NEVER, JSON.stringify(w));
await page.click("button:has-text('Stop')");

// Next time, the frame starts in the camera's last shape (landscape now), not 16:9 then a jump.
const again = await ctx.newPage();
await again.goto(BASE + "/record");
await filled(again);
const firstFrame = await again.evaluate(() => window.__firstFrame);
ok("next visit: the frame starts in the camera's last shape", Math.abs(firstFrame - 640 / 480) < 0.03 || Math.abs(firstFrame - 480 / 640) < 0.03, String(firstFrame));
w = await worst(again);
ok("next visit: never a small or blank picture", w.longest <= NEVER, JSON.stringify(w));

await browser.close();
await db.$disconnect();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
