// The recorder's Camera menu: a phone or tablet offers just Front camera and Rear camera (not every lens it
// lists), a computer still lists its cameras; and changing Quality keeps the camera picture the same size.
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
  // Three cameras, the way a phone lists its wide, ultra-wide and zoom lenses.
  args: ["--use-fake-device-for-media-stream=device-count=3", "--use-fake-ui-for-media-stream"],
});

// A paid plan, so there's a Quality menu.
const email = `phonecams${Date.now()}@acme.com`;
await agreed(email);
let state;
{
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1360, height: 900 } });
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

const PHONE = { ...devices["Pixel 7"], isMobile: true, hasTouch: true };

/**
 * The recorder in a fresh context. The camera gives its usual picture (upright on a phone) when it's opened
 * fresh; asked again while it's still open, it can only share the picture it's already making, cut to a smaller,
 * squarer one, as real cameras do. Every camera request is noted, with whether a camera was still open then.
 */
async function recorder(opts, { phone, oneCamera = false } = {}) {
  const ctx = await browser.newContext({ ...opts, permissions: ["camera", "microphone"], storageState: state });
  await ctx.addInitScript(({ phone, oneCamera }) => {
    const md = navigator.mediaDevices;
    const gum = md.getUserMedia.bind(md);
    const list = md.enumerateDevices.bind(md);
    const tracks = [];
    window.__asks = [];
    md.getUserMedia = async (c) => {
      if (!c?.video) return gum(c);
      const shared = tracks.some((t) => t.readyState === "live");
      window.__asks.push({ video: c.video, shared });
      const size = shared ? { width: { exact: 320 }, height: { exact: 240 } } : phone ? { width: { exact: 480 }, height: { exact: 640 } } : { width: { exact: 640 }, height: { exact: 360 } };
      const s = await gum({ ...c, video: { ...(typeof c.video === "object" ? c.video : {}), ...size } });
      tracks.push(...s.getVideoTracks());
      return s;
    };
    if (oneCamera) {
      md.enumerateDevices = async () => {
        const all = await list();
        const first = all.find((d) => d.kind === "videoinput");
        return all.filter((d) => d.kind !== "videoinput" || d === first);
      };
    }
  }, { phone, oneCamera });
  const page = await ctx.newPage();
  await page.goto(BASE + "/record");
  await page.waitForSelector("[data-testid=mode-camera]", { timeout: 20000 });
  if (!phone) await page.click("text=Camera only");
  // After the first recording, the camera and quality choices fold away (D12): open them to change them.
  await page.evaluate(() => document.querySelector("[data-testid=recorder-settings]")?.setAttribute("open", ""));
  return { ctx, page };
}

/** The camera preview: the picture's shape and size, and the frame around it. */
const preview = (page) =>
  page.evaluate(() => {
    const v = document.querySelector("main video");
    const t = v?.srcObject?.getVideoTracks?.()[0];
    const f = v.parentElement.getBoundingClientRect();
    return { live: t?.readyState === "live", vw: v.videoWidth, vh: v.videoHeight, fw: Math.round(f.width), fh: Math.round(f.height), fit: getComputedStyle(v).objectFit, mirrored: v.className.includes("-scale-x-100") };
  });
/** Waits for a live preview whose frame has settled on the picture's shape. */
const settled = (page) =>
  page
    .waitForFunction(() => {
      const v = document.querySelector("main video");
      const t = v?.srcObject?.getVideoTracks?.()[0];
      if (t?.readyState !== "live" || !v.videoWidth) return false;
      const f = v.parentElement.getBoundingClientRect();
      return Math.abs(f.width / f.height - v.videoWidth / v.videoHeight) < 0.02;
    }, null, { timeout: 15000 })
    .then(() => page.waitForTimeout(600))
    .then(() => preview(page), () => preview(page));
const options = (page) => page.$$eval("[data-testid=camera-select] option", (o) => o.map((x) => x.textContent));
const fills = (p) => p.live && p.fit === "cover" && Math.abs(p.fw / p.fh - p.vw / p.vh) < 0.02;

// 1) A computer: the camera list as before.
{
  const { ctx, page } = await recorder({ viewport: { width: 1360, height: 900 } }, { phone: false });
  await settled(page);
  const o = await options(page);
  ok("computer: Default camera and each camera are listed", o[0] === "Default camera" && o.length === 4, JSON.stringify(o));
  ok("computer: no Front or Rear camera choice", !o.includes("Front camera") && !o.includes("Rear camera"), JSON.stringify(o));
  const asks = await page.evaluate(() => window.__asks);
  ok("computer: asks for the default camera, not a side", asks.every((a) => !a.video.facingMode), JSON.stringify(asks));
  await ctx.close();
}

// 2) A phone: just Front and Rear, Front first, each sized and filling its frame the same way.
{
  const { ctx, page } = await recorder(PHONE, { phone: true });
  const front = await settled(page);
  const o = await options(page);
  ok("phone: only Front camera and Rear camera", JSON.stringify(o) === JSON.stringify(["Front camera", "Rear camera"]), JSON.stringify(o));
  ok("phone: Front camera is chosen to start with", (await page.$eval("[data-testid=camera-select]", (s) => s.value)) === "user");
  const asks = await page.evaluate(() => window.__asks);
  ok("phone: asks for the front camera", asks.at(-1)?.video.facingMode?.ideal === "user", JSON.stringify(asks.at(-1)));
  ok("phone: front camera fills its frame, upright", fills(front) && front.vw < front.vh && front.mirrored, JSON.stringify(front));
  await page.selectOption("[data-testid=camera-select]", "environment");
  await page.waitForFunction(() => window.__asks.at(-1)?.video.facingMode?.ideal === "environment", null, { timeout: 10000 }).catch(() => {});
  const rear = await settled(page);
  ok("phone: Rear camera asks for the camera on the back", (await page.evaluate(() => window.__asks.at(-1)?.video.facingMode?.ideal)) === "environment");
  ok("phone: rear camera fills its frame the same as the front", fills(rear) && rear.fw === front.fw && rear.fh === front.fh, JSON.stringify({ front, rear }));
  ok("phone: rear camera isn't shown mirrored", !rear.mirrored);
  await page.screenshot({ path: `${shots}/phone-cameras-rear.png` });
  await ctx.close();
}

// 3) A 320px-wide phone: the menu fits, with no sideways scrolling.
{
  const { ctx, page } = await recorder({ ...PHONE, viewport: { width: 320, height: 640 } }, { phone: true });
  await settled(page);
  const fit = await page.evaluate(() => {
    const s = document.querySelector("[data-testid=camera-select]").getBoundingClientRect();
    return { right: s.right, page: document.documentElement.scrollWidth };
  });
  ok("320px: the Camera menu fits and the page doesn't scroll sideways", fit.right <= 320 && fit.page <= 320, JSON.stringify(fit));
  await page.screenshot({ path: `${shots}/phone-cameras-320.png`, fullPage: true });
  await ctx.close();
}

// 4) A phone with one camera: nothing to choose, so no Camera menu.
{
  const { ctx, page } = await recorder(PHONE, { phone: true, oneCamera: true });
  const p = await settled(page);
  ok("one camera: no Camera menu", (await page.locator("[data-testid=camera-select]").count()) === 0);
  ok("one camera: its picture still fills the frame", fills(p), JSON.stringify(p));
  await ctx.close();
}

// 5) Changing Quality keeps the camera picture the same size, on a computer and on a phone.
for (const [name, opts, phone] of [["computer", { viewport: { width: 1360, height: 900 } }, false], ["phone", PHONE, true]]) {
  const { ctx, page } = await recorder(opts, { phone });
  const before = await settled(page);
  const qualities = await page.$$eval("select:has(option[value='720']) option", (o) => o.map((x) => x.value));
  const start = await page.inputValue("select:has(option[value='720'])");
  let same = true;
  const seen = [];
  // Each other quality in turn, then back to the first.
  for (const q of [...qualities.filter((q) => q !== start), start]) {
    // Marks the preview, so a new stream can be seen to get a new one (Safari draws a reused one at the old size).
    await page.evaluate(() => (document.querySelector("main video").dataset.old = "1"));
    const n = await page.evaluate(() => window.__asks.length);
    await page.selectOption("select:has(option[value='720'])", q);
    await page.waitForFunction((n) => window.__asks.length > n, n, { timeout: 10000 }).catch(() => {});
    const after = await settled(page);
    after.fresh = await page.evaluate(() => !document.querySelector("main video").dataset.old);
    seen.push({ q, ...after });
    if (!after.fresh) same = false;
    if (!fills(after) || after.fw !== before.fw || after.fh !== before.fh || after.vw !== before.vw || after.vh !== before.vh) same = false;
  }
  ok(`${name}: Quality offers more than one choice here`, qualities.length > 1, JSON.stringify(qualities));
  ok(`${name}: changing Quality keeps the picture's size and fill`, same, JSON.stringify({ before, seen }));
  const shared = await page.evaluate(() => window.__asks.filter((a) => a.shared).length);
  ok(`${name}: the camera is let go before it's asked for again`, shared === 0, `${shared} asks while the camera was still open`);
  if (phone) {
    // After a quality change the preview keeps filling its frame while recording, too.
    await page.selectOption("select:has(option[value='720'])", qualities.find((q) => q !== start));
    await settled(page);
    await page.click("text=Start recording");
    await page.waitForSelector("text=/Recording · \\d/", { timeout: 20000 });
    const rec = await settled(page);
    ok(`${name}: recording after a quality change, the preview still fills its frame`, fills(rec) && rec.fw === before.fw && rec.fh === before.fh, JSON.stringify({ before, rec }));
  }
  await ctx.close();
}

// 6) On a phone, every quality with either camera: starting to record uses the camera that's already showing, so
// the picture can't come back a different size (Josiah, 20 October 2026), through the countdown and recording.
for (const side of ["user", "environment"]) {
  const { ctx: c0, page: p0 } = await recorder(PHONE, { phone: true });
  const qualities = await p0.$$eval("select:has(option[value='720']) option", (o) => o.map((x) => x.value));
  await c0.close();
  for (const q of qualities) {
    const name = `phone, ${side === "user" ? "front" : "rear"} camera, ${q}`;
    const { ctx, page } = await recorder(PHONE, { phone: true });
    await settled(page);
    if (side !== "user") await page.selectOption("[data-testid=camera-select]", side);
    if ((await page.inputValue("select:has(option[value='720'])")) !== q) await page.selectOption("select:has(option[value='720'])", q);
    await page.waitForFunction((q) => window.__asks.at(-1)?.video?.height?.ideal === Math.min(Number(q), 1080), q, { timeout: 10000 }).catch(() => {});
    const before = await settled(page);
    const asks = await page.evaluate(() => window.__asks.length);
    const track = await page.evaluate(() => document.querySelector("main video").srcObject.getVideoTracks()[0].id);
    await page.click("text=Start recording");
    await page.waitForSelector("text=/^[123]$/", { timeout: 10000 }).catch(() => {});
    const counting = await preview(page);
    await page.waitForSelector("text=/Recording · \\d/", { timeout: 20000 });
    await page.waitForTimeout(1200);
    const rec = await preview(page);
    const same = await page.evaluate((id) => document.querySelector("main video").srcObject.getVideoTracks()[0].id === id, track);
    const fresh = (await page.evaluate(() => window.__asks.length)) === asks;
    ok(`${name}: starting doesn't open the camera again`, fresh && same, JSON.stringify({ fresh, same }));
    ok(`${name}: the picture fills the same frame through the countdown and recording`, [counting, rec].every((p) => fills(p) && p.fw === before.fw && p.fh === before.fh), JSON.stringify({ before, counting, rec }));
    await ctx.close();
  }
}

await browser.close();
await db.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
