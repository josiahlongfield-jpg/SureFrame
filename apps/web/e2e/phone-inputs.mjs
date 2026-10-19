// Typing boxes on phones are at least 16px, so Safari doesn't zoom the page in when one is tapped; computers keep
// the smaller text. Checks every visible text box, text area and select on the main pages.
import { chromium, devices } from "@playwright/test";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});

const email = `phoneinputs${Date.now()}@acme.com`;
await agreed(email);
let state, video;
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
  await page.waitForTimeout(2000);
  await page.click("button:has-text('Stop')");
  await page.waitForURL("**/v/**", { timeout: 30000 });
  video = new URL(page.url()).pathname;
  await page.waitForSelector('textarea[aria-label="Reply"]', { timeout: 20000 });
  const size = await page.$eval('textarea[aria-label="Reply"]', (t) => parseFloat(getComputedStyle(t).fontSize));
  ok("computer: reply box keeps its smaller text", size < 16, String(size));
  state = await ctx.storageState();
  await ctx.close();
}

// Every visible box under 16px, as "tag[name or label]: size".
const small = (page) =>
  page.$$eval('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=hidden]), textarea, select', (els) =>
    els
      .filter((e) => e.offsetParent !== null)
      .map((e) => ({ what: `${e.tagName.toLowerCase()}[${e.getAttribute("name") ?? e.getAttribute("aria-label") ?? e.type}]`, size: parseFloat(getComputedStyle(e).fontSize) }))
      .filter((e) => e.size < 16)
      .map((e) => `${e.what}: ${e.size}px`),
  );

const phone = { ...devices["iPhone 13"] };
delete phone.defaultBrowserType;
for (const [label, path, signedIn] of [
  ["sign-in", "/login", false],
  ["clients", "/clients", true],
  ["branding", "/settings/branding", true],
  ["reminders", "/reminders", true],
  ["video page", video, true],
]) {
  const ctx = await browser.newContext({ ...phone, ...(signedIn ? { storageState: state } : {}), permissions: ["camera", "microphone"] });
  const page = await ctx.newPage();
  await page.goto(BASE + path);
  await page.waitForLoadState("networkidle").catch(() => {});
  if (label === "video page") {
    await page.click("[data-testid=chat-open]", { timeout: 20000 });
    await page.waitForSelector('textarea[aria-label="Reply"]');
  }
  const count = await page.$$eval("input:not([type=hidden]), textarea, select", (els) => els.filter((e) => e.offsetParent !== null).length);
  const under = await small(page);
  ok(`phone ${label}: every typing box at least 16px (${count} boxes)`, under.length === 0, under.join(", "));
  if (label === "video page") {
    // Tapping the reply box leaves the page at its normal zoom and width.
    await page.tap('textarea[aria-label="Reply"]');
    await page.waitForTimeout(400);
    const view = await page.evaluate(() => ({ scale: window.visualViewport?.scale ?? 1, wide: document.documentElement.scrollWidth, width: window.innerWidth }));
    ok("phone: tapping the reply box doesn't zoom or widen the page", view.scale === 1 && view.wide <= view.width, JSON.stringify(view));
  }
  await ctx.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
