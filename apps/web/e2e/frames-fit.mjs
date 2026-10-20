// Home page feature frames: at every screen size, nothing in a frame runs out of its box or gets cut off by the window.
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
for (const width of [320, 375, 390, 430, 600, 768, 1024, 1280, 1440, 1920]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  await page.goto(BASE + "/");
  const tabs = page.locator("[role=tab]");
  await tabs.first().waitFor();
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click();
    await page.waitForTimeout(150);
    const name = (await tabs.nth(i).textContent()).trim();
    const fits = () => page.evaluate(() => {
      const panel = document.querySelector(".ff-panel:not([hidden])");
      const pb = panel.getBoundingClientRect().bottom - parseFloat(getComputedStyle(panel).paddingBottom) + 1;
      const out = [];
      for (const el of panel.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (!r.height || getComputedStyle(el).visibility === "hidden") continue;
        const box = el.parentElement.closest(".f-box");
        const limit = box ? Math.min(pb, box.getBoundingClientRect().bottom - parseFloat(getComputedStyle(box).paddingBottom) + 1) : pb;
        if (r.bottom > limit && r.top < limit + 400) out.push((el.textContent || el.className).trim().slice(0, 40));
      }
      return [...new Set(out)].slice(0, 4);
    });
    const bad = await fits();
    ok(`${width}px ${name}: everything fits in the frame`, bad.length === 0, JSON.stringify(bad));
    // A frame with two steps (To-dos/Reminders): the second step must fit too.
    if (await page.locator(".ff-panel:not([hidden]) .ff-flip").count()) {
      await page.evaluate(() => {
        const f = document.querySelector(".ff-panel:not([hidden]) .ff-flip");
        f.querySelector(".v1").style.cssText = "animation:none;visibility:hidden";
        f.querySelector(".v2").style.cssText = "animation:none;visibility:visible;opacity:1";
      });
      const bad2 = await fits();
      ok(`${width}px ${name}, second step: everything fits in the frame`, bad2.length === 0, JSON.stringify(bad2));
    }
  }
  const clipped = await page.locator("[role=tab]").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()));
  ok(`${width}px: every tab label fits`, clipped.length === 0, JSON.stringify(clipped));
  await page.close();
}
// To-dos/Reminders switches from its To-dos tab to Reminder settings halfway through its turn (20s after a click).
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + "/");
  await page.locator("[role=tab]", { hasText: "To-dos" }).click();
  // Off the window, or hovering pauses the tour.
  await page.mouse.move(2, 2);
  const shown = () => page.evaluate(() => [...document.querySelectorAll(".ff-panel:not([hidden]) .ff-flip > *")].filter((e) => getComputedStyle(e).visibility === "visible").map((e) => e.className.split(" ")[0]).join());
  await page.waitForTimeout(2000);
  ok("To-dos/Reminders starts on its To-dos tab", (await shown()) === "v1", await shown());
  await page.waitForTimeout(9500);
  ok("and shows Reminder settings for the second half", (await shown()) === "v2", await shown());
  await page.close();
}
await browser.close();
