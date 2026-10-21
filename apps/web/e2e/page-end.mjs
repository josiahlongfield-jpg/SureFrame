// Pages with the navy site footer end at the footer's bottom edge: nothing is left to scroll below it, on phones
// (where the floating Help button needs room at the end) and on computers. The footer keeps its usual size.
import { chromium, devices } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
let failed = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};

const pages = ["/", "/pricing", "/help", "/faq", "/about", "/legal/terms", "/legal/privacy", "/legal/dpa", "/legal/archive", "/no-such-page"];
const phone = { ...devices["iPhone 13"] };
delete phone.defaultBrowserType;
const sizes = [
  ["phone", phone],
  ["computer", { viewport: { width: 1280, height: 800 } }],
  ["big screen", { viewport: { width: 1920, height: 1080 } }],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined });
for (const [name, opts] of sizes) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  for (const path of pages) {
    await page.goto(BASE + path, { waitUntil: "load" });
    // Wait for the Help button, which adds the room on phones.
    await page.waitForSelector("footer", { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const f = document.querySelector("[data-site-footer], footer > [data-theme=navy]");
      if (!f) return null;
      scrollTo(0, document.documentElement.scrollHeight);
      const inner = f.firstElementChild.getBoundingClientRect().height;
      return { footerHeight: Math.round(f.getBoundingClientRect().height), footerContent: Math.round(inner), rem: parseFloat(getComputedStyle(document.documentElement).fontSize), footerBottom: Math.round(f.getBoundingClientRect().bottom + scrollY), pageEnd: document.documentElement.scrollHeight, view: innerHeight, scrollY: Math.round(scrollY) };
    });
    ok(`${name} ${path}: the footer is its usual size`, !!m && m.footerHeight <= m.footerContent + 2 * m.rem * 2.5 + 2, JSON.stringify(m));
    ok(`${name} ${path}: the page ends at the bottom of the navy footer`, !!m && Math.abs(m.pageEnd - m.footerBottom) <= 1 && m.scrollY + m.view <= m.footerBottom + 1, JSON.stringify(m));
  }
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
