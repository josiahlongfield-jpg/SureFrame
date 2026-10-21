// The SureFrame browser extension (apps/extension): while the recorder records the screen, every web page gets
// the floating camera bubble and the Pause/Stop bar, which run the recording from anywhere; the bubble can be
// dragged, resized and its bar tucked away, everywhere at once; the camera circle is drawn into the video only while
// the bubble isn't on screen; Stop on a bubble saves the video and takes the bubbles away.
// Builds the extension's test copy first (node ../extension/build.mjs).
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};

const extDir = new URL("../../extension/", import.meta.url).pathname;
execFileSync("node", [join(extDir, "build.mjs")], { stdio: "inherit" });
const ext = join(extDir, "dist/test");
const EXT_ID = "ojanfkhiedeaimfopnodgkhjgkdapmnb";

// Two ordinary websites: one that allows cameras, and one that blocks them for everything on it.
const site = http.createServer((req, res) => {
  const blocked = req.url.startsWith("/blocked");
  res.writeHead(200, { "content-type": "text/html", ...(blocked ? { "Permissions-Policy": "camera=()" } : {}) });
  res.end(`<!doctype html><html><head><title>${blocked ? "Blocked" : "Plain"}</title></head><body style="margin:0;background:#eeeeee;min-height:100vh;font:16px sans-serif"><p style="padding:2rem">An ordinary web page</p></body></html>`);
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const SITE = `http://127.0.0.1:${site.address().port}`;

// Allowing the camera once on the welcome page, as a person would.
const profile = mkdtempSync(join(tmpdir(), "sf-ext-"));
const args = [
  `--disable-extensions-except=${ext}`,
  `--load-extension=${ext}`,
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--auto-select-desktop-capture-source=Entire screen",
];
const launch = () => chromium.launchPersistentContext(profile, { headless: true, executablePath: process.env.CHROMIUM ?? undefined, args, viewport: { width: 1360, height: 900 } });
{
  const first = await launch();
  const sw = first.serviceWorkers()[0] ?? (await first.waitForEvent("serviceworker"));
  ok("the extension loads with its fixed id", sw.url().includes(EXT_ID), sw.url());
  // Installing opens the welcome page, which asks for the camera.
  const welcome = await first.waitForEvent("page", { predicate: (p) => p.url().includes("welcome.html"), timeout: 10000 }).catch(() => null);
  ok("installing opens the welcome page", !!welcome);
  if (welcome) {
    // The test browser answers camera questions by itself, so the page may already say it's allowed.
  await welcome.waitForLoadState();
  if (await welcome.isVisible("#allow")) await welcome.click("#allow");
    await welcome.waitForSelector("text=All set", { timeout: 10000 }).catch(() => {});
    ok("welcome: Allow camera shows it working", await welcome.isVisible("text=All set"));
    await welcome.screenshot({ path: `${shots}/extension-welcome.png` });
  }
  await first.close();
  // The test browser's automatic camera answer isn't remembered, so the person's "Allow" is written in.
  const file = join(profile, "Default/Preferences");
  const prefs = JSON.parse(readFileSync(file, "utf8"));
  prefs.profile ??= {};
  prefs.profile.content_settings ??= {};
  prefs.profile.content_settings.exceptions ??= {};
  prefs.profile.content_settings.exceptions.media_stream_camera = { [`chrome-extension://${EXT_ID}/,*`]: { setting: 1, last_modified: "13300000000000000" } };
  writeFileSync(file, JSON.stringify(prefs));
}

const ctx = await launch();
await ctx.grantPermissions(["camera", "microphone"], { origin: new URL(BASE).origin });
const rec = ctx.pages()[0] ?? (await ctx.newPage());
const email = `ext${Date.now()}@example.com`;
await agreed(email);
await rec.goto(BASE + "/record");
await rec.fill('input[name="email"]', email);
await rec.click("text=Continue");
await rec.waitForURL("**/record");
await rec.click("text=I've saved it");
await rec.waitForSelector("text=floats in a bubble", { timeout: 10000 }).catch(() => {});
ok("the recorder knows the extension is there", await rec.isVisible("text=floats in a bubble over your web pages"));

const plain = await ctx.newPage();
await plain.goto(SITE + "/plain");
const frameOf = (page) => page.frames().find((f) => f.url().startsWith("chrome-extension://") && f.url().includes("bubble.html"));
const box = (page) => page.evaluate(() => document.getElementById("sureframe-bubble-frame")?.getBoundingClientRect().toJSON() ?? null);
ok("before recording: no bubble on web pages", (await box(plain)) === null);

// Screen + camera.
await rec.bringToFront();
await rec.click("text=Start recording");
await rec.waitForSelector("text=/Recording · \\d/", { timeout: 20000 });
await plain.bringToFront();
await plain.waitForSelector("#sureframe-bubble-frame", { timeout: 10000 }).catch(() => {});
ok("recording: the bubble is on the web page", (await box(plain)) !== null);
const camOn = (page) =>
  page.waitForFunction(() => true).then(async () => {
    for (let i = 0; i < 40; i++) {
      const f = frameOf(page);
      const v = f && (await f.evaluate(() => { const v = document.getElementById("video"); return { w: v.videoWidth, playing: !v.paused, clock: document.getElementById("clock").textContent }; }).catch(() => null));
      if (v?.w > 0 && v.playing) return v;
      await page.waitForTimeout(250);
    }
    return null;
  });
let cam = await camOn(plain);
ok("the bubble shows the camera", !!cam, JSON.stringify(cam));
ok("its bar shows the recording's time", /^\d+:\d\d$/.test(cam?.clock ?? ""), cam?.clock);
// Bottom left by default, a 200px circle with the bar under it.
let b = await box(plain);
ok("bottom left by default", b && Math.round(b.left) === 24 && Math.round(900 - b.bottom) === 24, JSON.stringify(b));
await plain.screenshot({ path: `${shots}/extension-bubble.png` });
// See-through around the circle: the page shows in the frame's corner.
{
  const png = await plain.screenshot({ clip: { x: b.left + 2, y: b.top + 2, width: 2, height: 2 } });
  const px = await plain.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 2;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    return [...g.getImageData(0, 0, 1, 1).data];
  }, png.toString("base64"));
  ok("see-through around the circle", Math.abs(px[0] - 238) < 4 && Math.abs(px[2] - 238) < 4, px.join(","));
}

// The recorder's own tab gets the bubble too (this site lets the extension's frame use the camera).
cam = await camOn(rec);
ok("the SureFrame tab shows the bubble with the camera too", !!cam);

// While the bubble is on screen it's the camera in the video; a page that blocks cameras means the circle goes in.
const recorderSays = () => rec.locator("[data-testid=screen-panel]").innerText();
await plain.bringToFront();
await plain.waitForTimeout(2500);
let says = await recorderSays();
ok("bubble on screen: it's the camera in the video", /camera is the floating bubble/.test(says), says);
const blocked = await ctx.newPage();
await blocked.goto(SITE + "/blocked");
await blocked.waitForSelector("#sureframe-bubble-frame", { timeout: 10000 }).catch(() => {});
await blocked.waitForTimeout(2500);
const note = await frameOf(blocked)?.evaluate(() => document.getElementById("camera-note").innerText).catch(() => "");
ok("a page that blocks cameras: the bubble says so, with nothing to allow", /doesn't allow cameras/.test(note ?? "") && !/Allow camera/.test(note ?? ""), note);
says = await recorderSays();
ok("...and the camera circle goes into the video meanwhile", /isn.t on screen right now/.test(says), says);
await blocked.screenshot({ path: `${shots}/extension-blocked.png` });
await blocked.close();
await plain.bringToFront();
await plain.waitForTimeout(2500);
says = await recorderSays();
ok("back on an ordinary page: the circle comes out again", /camera is the floating bubble/.test(says), says);

// Pause and Resume from the bubble.
const pill = () => rec.locator("text=/(Paused|Recording) · \\d/").first().innerText();
await frameOf(plain).click("#pause");
await rec.waitForSelector("text=/Paused · \\d/", { timeout: 5000 }).catch(() => {});
ok("Pause on the bubble pauses the recording", /Paused/.test(await pill()));
await plain.waitForTimeout(600);
const t1 = await frameOf(plain).evaluate(() => document.getElementById("clock").textContent);
await plain.waitForTimeout(1500);
const t2 = await frameOf(plain).evaluate(() => document.getElementById("clock").textContent);
ok("paused: the bubble's clock stands still", t1 === t2, `${t1} ${t2}`);
ok("paused: its button says Resume", (await frameOf(plain).getAttribute("#pause", "aria-label")) === "Resume");
await frameOf(plain).click("#pause");
await rec.waitForSelector("text=/Recording · \\d/", { timeout: 5000 }).catch(() => {});
ok("Resume on the bubble carries on recording", /Recording/.test(await pill()));

// Dragged: it moves, and moves in the other tabs too.
b = await box(plain);
await plain.mouse.move(b.left + 100, b.top + 100);
await plain.mouse.down();
await plain.mouse.move(b.left + 250, b.top + 20, { steps: 10 });
await plain.mouse.up();
await plain.waitForTimeout(500);
const moved = await box(plain);
ok("drag: the bubble follows the pointer", Math.abs(moved.left - (b.left + 150)) < 3 && Math.abs(moved.top - (b.top - 80)) < 3, JSON.stringify({ b, moved }));
await rec.waitForTimeout(500);
const there = await box(rec);
ok("drag: the bubble moves on the other tabs too", Math.abs(there.left - moved.left) < 3 && Math.abs(there.bottom - moved.bottom) < 3, JSON.stringify({ there, moved }));
// Dragged off the edge: kept on the screen.
await plain.mouse.move(moved.left + 100, moved.top + 100);
await plain.mouse.down();
await plain.mouse.move(2, moved.top + 100, { steps: 10 });
await plain.mouse.up();
await plain.waitForTimeout(300);
ok("drag: never off the screen", Math.round((await box(plain)).left) === 0);

// Resized from its corner grip.
const size = () => frameOf(plain).evaluate(() => document.getElementById("circle").getBoundingClientRect().width);
const before = await size();
b = await box(plain);
const grip = await frameOf(plain).evaluate(() => document.getElementById("grow").getBoundingClientRect().toJSON());
await plain.mouse.move(b.left + 100, b.top + 100);
await plain.mouse.move(b.left + grip.x + 11, b.top + grip.y + 11, { steps: 3 });
await plain.mouse.down();
await plain.mouse.move(b.left + grip.x + 71, b.top + grip.y + 11, { steps: 8 });
await plain.mouse.up();
await plain.waitForTimeout(400);
const after = await size();
ok("resize: the grip makes it bigger", after > before + 40, `${before} -> ${after}`);
ok("resize: the frame grows to fit", (await box(plain)).width >= after);
await rec.waitForTimeout(500);
ok("resize: the other tabs' bubble too", (await frameOf(rec).evaluate(() => document.getElementById("circle").getBoundingClientRect().width)) === after);
await plain.screenshot({ path: `${shots}/extension-bigger.png` });

// The size dial, opened from the bar: real clicks on the page, as a person would.
const fr = () => frameOf(plain);
const clickIn = async (sel) => {
  const f = await box(plain);
  const r = await fr().evaluate((s) => document.querySelector(s).getBoundingClientRect().toJSON(), sel);
  await plain.mouse.click(f.left + r.x + r.width / 2, f.top + r.y + r.height / 2);
  await plain.waitForTimeout(300);
};
ok("dial: hidden until asked for", !(await fr().isVisible("#sizer")));
await clickIn("#size");
ok("dial: the size button opens it", await fr().isVisible("#sizer"));
{
  const f = await box(plain);
  const c = await fr().evaluate(() => document.getElementById("circle").getBoundingClientRect().toJSON());
  ok("dial: the frame fits the circle, dial and bar", f.height >= c.height + 34 + 40, JSON.stringify(f));
}
let s0 = await size();
await clickIn("#bigger");
ok("dial: + makes it bigger", (await size()) === Math.min(440, s0 + 20), `${s0} -> ${await size()}`);
s0 = await size();
await clickIn("#smaller");
await clickIn("#smaller");
ok("dial: - makes it smaller", (await size()) === s0 - 40, `${s0} -> ${await size()}`);
{
  // Sliding the dial all the way left: the smallest bubble.
  const f = await box(plain);
  const r = await fr().evaluate(() => document.getElementById("scale").getBoundingClientRect().toJSON());
  const thumbX = f.left + r.x + 8 + ((Number(await fr().evaluate(() => document.getElementById("scale").value)) - 120) / 320) * (r.width - 16);
  await plain.mouse.move(thumbX, f.top + r.y + r.height / 2);
  await plain.mouse.down();
  await plain.mouse.move(f.left + r.x - 30, f.top + r.y + r.height / 2, { steps: 8 });
  await plain.mouse.up();
  await plain.waitForTimeout(400);
  ok("dial: sliding it changes the size", (await size()) === 120, String(await size()));
  // It grows and shrinks around its middle: the dial stays where it was under the pointer.
  const f2 = await box(plain);
  const r2 = await fr().evaluate(() => document.getElementById("scale").getBoundingClientRect().toJSON());
  ok("dial: stays put while the bubble changes size", Math.abs(f2.left + r2.x + r2.width / 2 - (f.left + r.x + r.width / 2)) < 2 && Math.abs(f2.top + r2.y - (f.top + r.y)) < 2, `${f.left + r.x},${f.top + r.y} -> ${f2.left + r2.x},${f2.top + r2.y}`);
  ok("dial: the bubble stays on the page", (await box(plain)).bottom <= 900);
}
await rec.waitForTimeout(500);
ok("dial: the other tabs' bubble too", (await frameOf(rec).evaluate(() => document.getElementById("circle").getBoundingClientRect().width)) === 120);
{
  // All the way up: a bit bigger than before (440).
  await fr().focus("#scale");
  await plain.keyboard.press("End");
  await plain.waitForTimeout(400);
  ok("dial: biggest is 440", (await size()) === 440, String(await size()));
  await rec.waitForTimeout(500);
  ok("dial: the other tabs' bubble is 440 too", (await frameOf(rec).evaluate(() => document.getElementById("circle").getBoundingClientRect().width)) === 440);
  await plain.keyboard.press("Home");
  await plain.waitForTimeout(400);
}
await plain.screenshot({ path: `${shots}/extension-dial.png` });
await clickIn("#size");
ok("dial: the size button closes it", !(await fr().isVisible("#sizer")));
await clickIn("#bigger").catch(() => {});
// Back to the grip's size for the checks below.
await fr().evaluate((n) => chrome.storage.local.set({ bubbleLook: { size: n, collapsed: false } }), after);
await plain.waitForTimeout(400);

// A tab opened while recording gets the bubble and the camera too.
{
  const extra = await ctx.newPage();
  await extra.goto(SITE + "/plain?another");
  await extra.waitForSelector("#sureframe-bubble-frame", { timeout: 10000 }).catch(() => {});
  const c = await camOn(extra);
  ok("new tab: the bubble shows the camera", !!c, JSON.stringify(c));
  const problem = await frameOf(extra)?.evaluate(() => { const n = document.getElementById("camera-note"); return n.hidden ? "" : n.textContent; }).catch(() => "?");
  ok("new tab: no camera problem shown", problem === "", problem);
  // A mirror of the other tabs: the same size and the same place.
  const sz = (pg) => frameOf(pg).evaluate(() => document.getElementById("circle").getBoundingClientRect().width);
  const [a, bb] = [await box(plain), await box(extra)];
  ok("new tab: same size as the other tabs", (await sz(extra)) === (await sz(plain)), `${await sz(extra)} vs ${await sz(plain)}`);
  ok("new tab: same place as the other tabs", Math.round(a.left) === Math.round(bb.left) && Math.round(a.bottom) === Math.round(bb.bottom), `${JSON.stringify(a)} vs ${JSON.stringify(bb)}`);
  await extra.close();
  await plain.bringToFront();
}

// The bar tucked away and brought back.
await frameOf(plain).click("#collapse");
await plain.waitForTimeout(300);
ok("tuck away: the bar goes, the circle stays", !(await frameOf(plain).isVisible("#bar")) && (await frameOf(plain).isVisible("#circle")));
const tucked = await box(plain);
ok("tuck away: the frame shrinks to the circle", tucked.height < after + 20, JSON.stringify(tucked));
await frameOf(plain).hover("#circle");
await frameOf(plain).click("#expand");
await plain.waitForTimeout(300);
ok("bring back: the bar is there again", await frameOf(plain).isVisible("#bar"));

// Stop on the bubble: back to the SureFrame tab, the video is saved and the bubbles go.
await frameOf(plain).click("#stop");
await rec.waitForURL("**/v/**", { timeout: 30000 }).catch(() => {});
ok("Stop on the bubble saves the video", /\/v\//.test(rec.url()), rec.url());
await plain.waitForTimeout(1500);
ok("after Stop: no bubble on web pages", (await box(plain)) === null);

// Screen only: just the bar, which stays even when the whole screen is shared.
await rec.goto(BASE + "/record");
await rec.click("text=Screen only");
await rec.click("text=Start recording");
await rec.waitForSelector("text=/Recording · \\d/", { timeout: 20000 });
await plain.bringToFront();
await plain.waitForSelector("#sureframe-bubble-frame", { timeout: 10000 }).catch(() => {});
await plain.waitForTimeout(800);
const only = await box(plain);
ok("screen only: the bar alone, no camera", only && only.height <= 44 && !(await frameOf(plain).isVisible("#circle")), JSON.stringify(only));
await plain.screenshot({ path: `${shots}/extension-screen-only.png` });
await rec.bringToFront();
await rec.click("button:has-text('Stop')");
await rec.waitForURL("**/v/**", { timeout: 30000 }).catch(() => {});
await plain.waitForTimeout(1500);
ok("Stop on the SureFrame tab takes the bar away too", (await box(plain)) === null);

await ctx.close();

// Typical Mac and Windows screens (a Retina laptop, 125% scaling, a big monitor): the bubble fits, follows the pointer
// exactly when dragged, and resizes. A recording is put straight into the extension here.
for (const [name, viewport, deviceScaleFactor] of [
  ["mac-retina", { width: 1440, height: 900 }, 2],
  ["windows-125", { width: 1536, height: 864 }, 1.25],
  ["big-monitor", { width: 1920, height: 1080 }, 1],
  ["small-laptop", { width: 1280, height: 720 }, 1],
]) {
  const c = await chromium.launchPersistentContext(profile, { headless: true, executablePath: process.env.CHROMIUM ?? undefined, args, viewport, deviceScaleFactor });
  const sw = c.serviceWorkers()[0] ?? (await c.waitForEvent("serviceworker"));
  await sw.evaluate(() => chrome.storage.local.remove(["bubble", "bubbleLook", "bubblePlace"]));
  const p = c.pages()[0] ?? (await c.newPage());
  await p.goto(SITE + "/plain");
  await sw.evaluate(() => chrome.storage.session.set({ rec: { id: "sizes", mode: "screen+camera", phase: "recording", ms: 0, at: Date.now(), beat: Date.now(), tabId: -1 } }));
  await p.waitForSelector("#sureframe-bubble-frame", { timeout: 10000 }).catch(() => {});
  const live = !!(await camOn(p));
  let r = await box(p);
  ok(`${name}: the bubble shows its camera, inside the screen`, live && r && r.left >= 0 && r.bottom <= viewport.height, JSON.stringify(r));
  await p.mouse.move(r.left + 100, r.top + 100);
  await p.mouse.down();
  await p.mouse.move(r.left + 400, r.top - 200, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  const m = await box(p);
  ok(`${name}: dragging follows the pointer exactly`, Math.abs(m.left - r.left - 300) < 2 && Math.abs(m.top - r.top + 300) < 2, JSON.stringify({ r, m }));
  const g = await frameOf(p).evaluate(() => document.getElementById("grow").getBoundingClientRect().toJSON());
  await p.mouse.move(m.left + g.x + 11, m.top + g.y + 11, { steps: 3 });
  await p.mouse.down();
  await p.mouse.move(m.left + g.x + 61, m.top + g.y + 11, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  const grown = await frameOf(p).evaluate(() => document.getElementById("circle").getBoundingClientRect().width);
  ok(`${name}: resizing follows the grip`, Math.abs(grown - 250) < 3, String(grown));
  await p.screenshot({ path: `${shots}/extension-${name}.png` });
  await sw.evaluate(() => chrome.storage.session.remove("rec"));
  await p.waitForTimeout(500);
  ok(`${name}: gone when the recording ends`, (await box(p)) === null);
  await c.close();
}
site.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
