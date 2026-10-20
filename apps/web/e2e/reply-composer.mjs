// The reply box under a video: Enter sends a text reply (Shift+Enter is a new
// line), and voice and video replies show the live microphone bar.
import { chromium } from "@playwright/test";
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
const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();

await page.goto(BASE + "/record");
const loginEmail = `composer${Date.now()}@acme.com`;
await agreed(loginEmail);
await page.fill('input[name="email"]', loginEmail);
await page.click("text=Continue");
await page.waitForURL("**/record");
await page.click("text=I've saved it");
await page.click("text=Camera only");
await page.click("text=Start recording");
await page.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await page.waitForTimeout(3000);
await page.click("button:has-text('Stop')");
await page.waitForURL("**/v/**", { timeout: 30000 });
await page.waitForSelector('textarea[aria-label="Reply"]', { timeout: 20000 });

const box = 'textarea[aria-label="Reply"]';
ok("text replies: no microphone bar", (await page.locator("aside [data-testid=mic-level]").count()) === 0);

await page.fill(box, "First line");
await page.press(box, "Shift+Enter");
await page.type(box, "second line");
ok("Shift+Enter adds a new line", (await page.inputValue(box)) === "First line\nsecond line");

await page.press(box, "Enter");
await page.waitForSelector("aside ul >> text=second line", { timeout: 15000 });
ok("Enter sends the reply", true);
ok("the box is cleared after sending", (await page.inputValue(box)) === "");

await page.press(box, "Enter");
await page.waitForTimeout(800);
ok("Enter on an empty box sends nothing", (await page.locator("aside ul li").count()) === 2); // the reply + the list end marker

await page.click("role=tab[name='Voice']");
const voiceBar = await page.waitForSelector("aside [data-testid=mic-level][data-state=hearing]", { timeout: 15000 }).catch(() => null);
ok("voice reply: microphone bar picks up sound", !!voiceBar);
ok("voice reply: no 'choose another one above' wording", !(await page.isVisible("aside >> text=/above/")));

await page.click("role=tab[name='Video']");
ok("video reply: microphone bar shown", !!(await page.waitForSelector("aside [data-testid=mic-level]", { timeout: 15000 }).catch(() => null)));
await page.click("button:has-text('Record video reply')");
await page.waitForSelector("aside >> text=/Recording · \\d/", { timeout: 15000 });
ok("microphone bar stays while recording", (await page.locator("aside [data-testid=mic-level]").count()) === 1);
await page.waitForTimeout(2500);
await page.click("button:has-text('Stop recording')");
await page.waitForSelector("aside [data-testid=reply-review] video", { timeout: 15000 });
ok("after Stop: a review step plays it back before sending", (await page.locator("aside ul [data-testid=reply-video-still]").count()) === 0);
await page.click("button:has-text('Send video reply')");
await page.waitForSelector("aside ul [data-testid=reply-video-still]", { timeout: 30000 });
ok("video reply still sends", true);
ok("says it's sent, and stays on the Video tab", (await page.isVisible("[data-testid=reply-sent]")) && (await page.getAttribute("role=tab[name='Video']", "aria-selected")) === "true");

await page.click("role=tab[name='Text']");
ok("back to text: microphone bar gone", (await page.locator("aside [data-testid=mic-level]").count()) === 0);

await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
