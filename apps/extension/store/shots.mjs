// Draws the store images (1280x800 screenshots, 440x280 promo tile) from the test build, with a drawn, generic
// person as the camera. Usage: node build.mjs && node store/shots.mjs
import { chromium } from "../../web/node_modules/@playwright/test/index.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, "../dist/test");
const work = mkdtempSync(join(tmpdir(), "sf-store-"));
const camera = join(work, "person.y4m");
execFileSync("python3", [join(here, "person.py"), camera]);

const page = (body) => `<!doctype html><html><head><style>
  body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2937;background:#f6f7f9}
  header{height:56px;background:#fff;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:12px;padding:0 28px;font-weight:600}
  .dot{width:22px;height:22px;border-radius:6px;background:#c7d2fe}
  main{max-width:760px;margin:40px auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:36px 44px}
  h1{font-size:28px;margin:0 0 6px} .sub{color:#6b7280;margin:0 0 24px}
  h2{font-size:18px;margin:26px 0 8px} li{margin:6px 0} .bar{height:10px;border-radius:5px;background:#e5e7eb;margin:12px 0}
  .bar i{display:block;height:100%;width:62%;border-radius:5px;background:#93c5fd}
</style></head><body>${body}</body></html>`;
const plan = page(`<header><span class="dot"></span>Your workspace</header><main>
  <h1>Project plan</h1><p class="sub">Shared with Client A</p>
  <h2>This week</h2><ul><li>Review the draft with Client A</li><li>Update the timeline</li><li>Send the next steps</li></ul>
  <h2>Progress</h2><div class="bar"><i></i></div>
  <h2>Notes</h2><p>Walk through each section, point out what changed since last time, and leave a few questions for the reply.</p></main>`);
const site = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(plan);
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${site.address().port}/`;

const profile = mkdtempSync(join(tmpdir(), "sf-store-profile-"));
const args = [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${camera}`, "--use-fake-ui-for-media-stream"];
const launch = () => chromium.launchPersistentContext(profile, { headless: true, executablePath: process.env.CHROMIUM || undefined, args, viewport: { width: 1280, height: 800 } });
let ctx = await launch();
let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
const id = sw.url().split("/")[2];
const welcome = await ctx.waitForEvent("page", { predicate: (p) => p.url().includes("welcome.html"), timeout: 10000 });
await welcome.waitForLoadState();
// The test browser answers camera questions by itself, so the page may already say it's allowed.
  await welcome.waitForLoadState();
  if (await welcome.isVisible("#allow")) await welcome.click("#allow");
await welcome.waitForSelector("text=All set");
await welcome.waitForTimeout(800);
await welcome.screenshot({ path: join(here, "welcome-1280x800.png") });
await ctx.close();
// The person's "Allow" on the welcome page, remembered (the test browser's automatic answer isn't).
const prefsFile = join(profile, "Default/Preferences");
const prefs = JSON.parse(readFileSync(prefsFile, "utf8"));
prefs.profile.content_settings ??= {};
prefs.profile.content_settings.exceptions ??= {};
prefs.profile.content_settings.exceptions.media_stream_camera = { [`chrome-extension://${id}/,*`]: { setting: 1, last_modified: "13300000000000000" } };
(await import("node:fs")).writeFileSync(prefsFile, JSON.stringify(prefs));

ctx = await launch();
sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
const p = ctx.pages()[0] ?? (await ctx.newPage());
await p.goto(url);
const rec = (mode, phase, ms) => sw.evaluate(([mode, phase, ms]) => chrome.storage.session.set({ rec: { id: "store", mode, phase, ms, at: Date.now(), beat: Date.now(), tabId: -1 } }), [mode, phase, ms]);
const prefsSet = (b) => sw.evaluate((b) => chrome.storage.local.set({ bubble: b }), b);

await prefsSet({ left: 40, bottom: 40, size: 220, collapsed: false });
await rec("screen+camera", "recording", 83_000);
await p.waitForSelector("#sureframe-bubble-frame");
await p.waitForTimeout(2500);
await p.screenshot({ path: join(here, "bubble-1280x800.png") });

await prefsSet({ left: 990, bottom: 60, size: 260, collapsed: true });
await p.waitForTimeout(1500);
await p.screenshot({ path: join(here, "moved-1280x800.png") });

await prefsSet({ left: 40, bottom: 40, size: 220, collapsed: false });
await rec("screen", "paused", 47_000);
await p.waitForTimeout(1500);
await p.screenshot({ path: join(here, "screen-only-1280x800.png") });

// The small promo tile.
const tile = await ctx.newPage();
await tile.setViewportSize({ width: 440, height: 280 });
const icon = readFileSync(join(here, "../icons/128.png")).toString("base64");
await tile.setContent(`<body style="margin:0;width:440px;height:280px;background:#0f2747;color:#fff;font:600 30px/1.15 system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;justify-content:center;gap:16px;padding:0 36px;box-sizing:border-box">
  <div style="display:flex;align-items:center;gap:12px;font-size:26px"><img src="data:image/png;base64,${icon}" width="44" height="44"><span><b style="font-weight:700">Sure</b><span style="font-weight:200">Frame</span></span></div>
  <div>Your camera and controls<br><span style="color:#ff8f84">on every tab.</span></div></body>`);
await tile.screenshot({ path: join(here, "promo-440x280.png") });

await ctx.close();
site.close();
console.log("Store images written to", here);
