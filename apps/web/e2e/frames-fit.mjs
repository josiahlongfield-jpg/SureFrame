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
    const bad = await page.evaluate(() => {
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
    ok(`${width}px ${name}: everything fits in the frame`, bad.length === 0, JSON.stringify(bad));
  }
  await page.close();
}
await browser.close();
