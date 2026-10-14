// Screen + camera: the floating camera bubble opens with the recording, and the page doesn't show the camera full size.
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
const page = await ctx.newPage();
await page.goto(BASE + "/record");
const email = `bubble${Date.now()}@acme.com`;
await agreed(email);
await page.fill('input[name="email"]', email);
await page.click("text=Continue");
await page.waitForURL("**/record");
await page.click("text=I've saved it");

ok("setup: the camera shows full size", (await page.locator("main video").count()) === 1 && (await page.locator("[data-testid=camera-circle]").count()) === 0);
await page.click("text=Start recording");
await page.waitForSelector("text=/Recording · \\d/", { timeout: 20000 });
ok("the bubble opens with the recording", await page.evaluate(() => !!window.documentPictureInPicture?.window));
ok("and the page shows the screen panel, not the camera full size", (await page.locator("[data-testid=screen-panel]").count()) === 1 && (await page.locator("[data-testid=camera-circle]").count()) === 0);
ok("and says the camera is in the bubble", (await page.locator("text=Your camera is in the floating bubble").count()) === 1);
await page.screenshot({ path: `${shots}/bubble-recording.png` });

// Closing the bubble by hand: a small camera circle and the button to bring it back.
await page.evaluate(() => window.documentPictureInPicture.window.close());
await page.waitForSelector("text=Pop out camera bubble", { timeout: 5000 }).catch(() => {});
ok("closed by hand: the pop-out button comes back", (await page.locator("text=Pop out camera bubble").count()) === 1);
const circleLive = await page.waitForFunction(() => {
  const t = document.querySelector("[data-testid=camera-circle]")?.srcObject?.getVideoTracks?.()[0];
  return !!t && t.readyState === "live";
}, null, { timeout: 5000 }).then(() => true, () => false);
ok("and a small camera circle shows on the page", circleLive);
await page.click("text=Pop out camera bubble");
ok("the button opens it again", await page.waitForFunction(() => !!window.documentPictureInPicture?.window, null, { timeout: 5000 }).then(() => true, () => false));

await page.waitForTimeout(3000);
await page.click("button:has-text('Stop')");
await page.waitForURL("**/v/**", { timeout: 30000 });
ok("stopping saves the video", page.url().includes("/v/"));
ok("and closes the bubble", await page.evaluate(() => !window.documentPictureInPicture?.window));

await browser.close();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
