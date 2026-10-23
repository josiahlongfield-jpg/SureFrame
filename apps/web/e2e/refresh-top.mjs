// Refresh on phones (Josiah, 23 October 2026): reloading any page on a phone starts at the top, wherever it was left.
// src/app/layout.tsx topScript turns the browser's own scroll restoring off for a reload on a touch or narrow screen;
// a desktop reload still keeps its place.
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();

for (const path of ["/", "/pricing", "/faq", "/login", "/help"]) {
  await page.goto(BASE + path);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.reload();
  await page.waitForLoadState("networkidle").catch(() => {});
  const top = await page.evaluate(() => ({ y: window.scrollY, mode: history.scrollRestoration }));
  ok(`${path}: reloaded at the top, it starts at the top with the browser's restoring off for that load`, top.y === 0 && top.mode === "manual", JSON.stringify(top));
  await page.waitForTimeout(1300);
  ok(`${path}: restoring is back on afterwards`, (await page.evaluate(() => history.scrollRestoration)) === "auto");
}

for (const path of ["/", "/pricing", "/help"]) {
  await page.goto(BASE + path);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(200);
  ok(`${path}: long enough to test (scrolled to 600)`, (await page.evaluate(() => window.scrollY)) >= 590);
  await page.reload();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(300);
  const y = await page.evaluate(() => window.scrollY);
  ok(`${path}: phone reloaded part-way down starts at the top`, y === 0, String(y));
}

const desk = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
for (const path of ["/", "/pricing"]) {
  await desk.goto(BASE + path);
  await desk.waitForLoadState("networkidle").catch(() => {});
  await desk.evaluate(() => window.scrollTo(0, 600));
  await desk.waitForTimeout(200);
  ok(`${path}: desktop long enough to test (scrolled to 600)`, (await desk.evaluate(() => window.scrollY)) >= 590);
  await desk.reload();
  await desk.waitForLoadState("networkidle").catch(() => {});
  await desk.waitForTimeout(300);
  const y = await desk.evaluate(() => window.scrollY);
  ok(`${path}: desktop reloaded part-way down keeps its place`, y > 400, String(y));
}

await browser.close();
