// The recorder's notes (how long a video can be, and that it uploads as you talk so a closed page loses nothing)
// sit straight under the recording window, lined up with its left edge, for every kind of recording, on a
// computer and on a phone, and stay there while recording.
import { chromium, devices } from "@playwright/test";
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
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});

const email = `recnotes${Date.now()}@example.com`;
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
  state = await ctx.storageState();
  await ctx.close();
}

/** Where the notes sit against the recording window. */
const place = (page) =>
  page.evaluate(() => {
    const notes = document.querySelector("[data-testid=recording-notes]");
    const win = notes?.previousElementSibling;
    if (!notes || !win) return null;
    const n = notes.getBoundingClientRect();
    const w = win.getBoundingClientRect();
    const start = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Start recording")?.getBoundingClientRect();
    return { gap: Math.round(n.top - w.bottom), left: Math.round(n.left - w.left), widthOver: Math.round(n.width - w.width), text: notes.textContent, startTop: start && Math.round(start.top), notesTop: Math.round(n.top), page: document.documentElement.scrollWidth - innerWidth };
  });

const phone = { ...devices["Pixel 7"] };
delete phone.defaultBrowserType;
for (const [name, opts] of [["computer", { viewport: { width: 1440, height: 900 } }], ["phone", phone]]) {
  const ctx = await browser.newContext({ ...opts, storageState: state, permissions: ["camera", "microphone"] });
  const page = await ctx.newPage();
  await page.goto(BASE + "/record");
  // Phones can't record the screen, so they only have Camera only (the screen choices are greyed out).
  for (const mode of name === "phone" ? ["Camera only"] : ["Screen + Camera", "Screen only", "Camera only"]) {
    await page.click(`text=${mode}`);
    await page.waitForTimeout(mode === "Camera only" ? 2500 : 500);
    const p = await place(page);
    ok(`${name} ${mode}: notes straight under the recording window`, !!p && p.gap >= 0 && p.gap <= 32, JSON.stringify(p));
    ok(`${name} ${mode}: lined up with its left edge and no wider`, !!p && Math.abs(p.left) <= 1 && p.widthOver <= 1, JSON.stringify(p));
    ok(`${name} ${mode}: both notes there`, !!p && /can be up to .+ the recording stops and is saved by itself/.test(p.text) && /uploads while you talk/.test(p.text), p?.text);
    ok(`${name} ${mode}: nothing wider than the screen`, !!p && p.page <= 0, JSON.stringify(p));
    if (name === "computer") ok(`${name} ${mode}: not under the Start button any more`, !!p && p.notesTop < p.startTop + 400 && (await page.locator("aside [data-testid=length-limit]").count()) === 0);
    await page.screenshot({ path: `${shots}/recorder-notes-${name}-${mode.replace(/\W+/g, "-").toLowerCase()}.png`, fullPage: true });
  }
  // While recording, the notes stay under the window.
  await page.click("text=Camera only");
  await page.click("text=Start recording");
  await page.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
  const p = await place(page);
  ok(`${name}: notes still under the window while recording`, !!p && p.gap >= 0 && p.gap <= 32, JSON.stringify(p));
  await page.click("button:has-text('Stop')");
  await ctx.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
