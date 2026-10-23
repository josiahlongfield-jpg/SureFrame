// Sign-in send button (Josiah, 23 October 2026): pressing "Email me a sign-in link" seemed to do nothing while the email
// was on its way, so he pressed it again; every press sent another email and the page was slow to move on. The button
// now says it's sending and can't be pressed again until the check page opens. Needs AUTH_EMAIL_LINKS (email form).
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });

for (const [name, size] of [["computer", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
  const page = await (await browser.newContext({ viewport: size, isMobile: name === "phone", hasTouch: name === "phone" })).newPage();
  let posts = 0;
  // Holds each send back 3 seconds, like a slow email service.
  await page.route("**/login**", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      await new Promise((r) => setTimeout(r, 3000));
    }
    await route.continue();
  });
  await page.goto(BASE + "/login");
  await page.fill("input[name=email]", `send-busy-${name}-${Date.now()}@example.com`);
  const button = page.locator("[data-testid=send-link]");
  await button.click();
  await page.waitForTimeout(300);
  ok(`${name}: the button says it's sending straight away`, (await button.textContent())?.includes("Sending your link"), await button.textContent());
  ok(`${name}: and can't be pressed again while it sends`, await button.isDisabled());
  await button.click({ force: true }).catch(() => {});
  await page.press("input[name=email]", "Enter").catch(() => {});
  await page.waitForURL("**/login/check**", { timeout: 20000 }).catch(() => {});
  ok(`${name}: the check page opens`, new URL(page.url()).pathname === "/login/check", page.url());
  ok(`${name}: only one email was sent`, posts === 1, String(posts));
  await page.context().close();
}

await browser.close();
