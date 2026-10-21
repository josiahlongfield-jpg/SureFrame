// Preview pictures are sharp (src/lib/thumb.ts):
// - a recording's library still is up to 960px wide, the same still the client sees;
// - the poster over a video before it plays keeps the recording's own size;
// - a still made smaller than that (before stills were sharpened) is remade once in the library, not every visit.
// Needs ffmpeg, for an HD camera.
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const prisma = new PrismaClient();
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

// Cameras that give a moving test picture of a set size.
function camera(size) {
  const file = join(tmpdir(), `sureframe-camera-${size}.y4m`);
  if (!existsSync(file)) execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=15`, "-t", "2", "-pix_fmt", "yuv420p", file]);
  return file;
}
const hd = camera("1280x720");
const sd = camera("640x360");

const stamp = Date.now();
const email = `sharp${stamp}@example.com`;
const userDataDir = join(tmpdir(), `sureframe-sharp-${stamp}`);
const base = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];

/** One browser on this device (the same profile each time), with the given camera. */
async function device(camera) {
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath: process.env.CHROMIUM,
    args: [...base, `--use-file-for-fake-video-capture=${camera}`],
    permissions: ["camera", "microphone"],
    viewport: { width: 1360, height: 900 },
  });
  return { ctx, page: ctx.pages()[0] ?? (await ctx.newPage()) };
}

async function record(page, ws) {
  await page.goto(BASE + "/record");
  await page.waitForSelector("text=I've saved it", { timeout: 5000 }).then((b) => b.click()).catch(() => {});
  await page.click("text=Camera only");
  await page.click("text=Start recording");
  await page.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
  const id = (await waitFor(() => prisma.video.findFirst({ where: { workspaceId: ws, status: "RECORDING" }, orderBy: { createdAt: "desc" } }), 10000))?.id;
  await waitFor(() => prisma.videoThumb.findUnique({ where: { videoId: id } }), 8000);
  await page.waitForTimeout(1500);
  await page.click("button:has-text('Stop')");
  await page.waitForURL("**/v/**", { timeout: 30000 });
  return id;
}

const widthOf = (page, sel) =>
  page
    .waitForFunction((s) => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth ? i.naturalWidth : 0; }, sel, { timeout: 30000 })
    .then((h) => h.jsonValue(), () => 0);

// 1. A small camera (640x360): its still can't be any bigger than the recording.
// Signing in ends when the browser closes, so each time it opens.
async function signIn(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname === "/library");
}

let { ctx, page } = await device(sd);
await agreed(email);
await signIn(page);
const ws = (await waitFor(() => prisma.membership.findFirst({ where: { user: { email } } }))).workspaceId;
const small = await record(page, ws);
await ctx.close();

// 2. An HD camera.
({ ctx, page } = await device(hd));
await signIn(page);
const big = await record(page, ws);
const video = await prisma.video.findUnique({ where: { id: big }, select: { width: true } }).catch(() => null);
const poster = await widthOf(page, "[data-testid=poster-cover] img");
ok("the poster before playing is the recording's full size", poster === 1280, `${poster} (recording ${video?.width ?? "?"})`);

await page.goto(BASE + "/library");
const bigStill = await widthOf(page, `a[href="/v/${big}"] [data-testid=library-thumb]`);
ok("an HD recording's library still is 960 wide", bigStill === 960, String(bigStill));
const saved = (await prisma.videoThumb.findUnique({ where: { videoId: big } }))?.data.length ?? 0;
ok("the sharper still fits what the server takes", saved > 0 && saved <= 1_000_000, String(saved));

// 3. The small recording's still is under the sharp size, like one made before: remade once, then left alone.
const smallBefore = (await prisma.videoThumb.findUnique({ where: { videoId: small } }))?.data;
const smallStill = await widthOf(page, `a[href="/v/${small}"] [data-testid=library-thumb]`);
ok("a small recording's still is its own size", smallStill === 640, String(smallStill));
const remade = await waitFor(async () => {
  const now = (await prisma.videoThumb.findUnique({ where: { videoId: small } }))?.data;
  return now && now !== smallBefore ? now : null;
}, 20000);
ok("a still under the sharp size is remade from the recording", !!remade);
await page.waitForTimeout(1000);
await page.reload();
await widthOf(page, `a[href="/v/${small}"] [data-testid=library-thumb]`);
await page.waitForTimeout(4000);
const after = (await prisma.videoThumb.findUnique({ where: { videoId: small } }))?.data;
ok("only once on this device, not on every visit", !!remade && after === remade);
ok("the library still shows it", (await widthOf(page, `a[href="/v/${small}"] [data-testid=library-thumb]`)) === 640);
await page.screenshot({ path: `${shots}/sharp-stills-library.png` });

await ctx.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
