// The "add the extension" prompt before a screen recording, in a browser without the extension. Needs a build with
// NEXT_PUBLIC_EXTENSION_URL set (the prompt only shows once the extension has a store page to send people to).
import { chromium } from "@playwright/test";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${detail}`}`);
  if (!cond) process.exitCode = 1;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--auto-select-desktop-capture-source=Entire screen"],
});
const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));

await page.goto(BASE + "/record");
const email = `prompt${Date.now()}@example.com`;
await agreed(email);
await page.fill('input[name="email"]', email);
await page.click("text=Continue");
await page.waitForURL("**/record");
await page.click("text=I've saved it");

const prompt = page.locator("[data-testid=extension-prompt]");
const startBtn = page.locator("button", { hasText: "Start recording" });
const recording = () => page.waitForSelector("text=/Recording · \\d/", { timeout: 20000 }).then(() => true, () => false);
async function discard() {
  await page.click("text=Discard and start over");
  await page.click("[data-testid=discard-confirm] >> text=Discard recording");
  await page.waitForSelector("text=Start recording", { timeout: 15000 });
}

// Camera only never asks.
await page.click("text=Camera only");
await startBtn.click();
ok("camera only: no prompt, it just records", (await recording()) && !(await prompt.isVisible()));
await discard();

// Screen + camera asks first.
await page.click("text=Screen + camera");
await startBtn.click();
await prompt.waitFor({ timeout: 5000 }).catch(() => {});
ok("screen recording: asks to add the extension first", await prompt.isVisible());
const text = await prompt.innerText();
ok("says what it does", /camera bubble, with Pause and Stop, on any tab/.test(text), text);
ok("says why it's safe", /Why it.s safe/.test(text) && /doesn.t read, collect or send anything/.test(text), text);
const add = page.locator("[data-testid=extension-add]");
ok("Add goes to the store in a new tab", (await add.getAttribute("href")) === process.env.EXPECT_URL && (await add.getAttribute("target")) === "_blank", await add.getAttribute("href"));
ok("Start is out of the way meanwhile", !(await startBtn.isVisible()));
await page.screenshot({ path: `${shots}/extension-prompt.png` });

// Fits a small phone-width window without spilling sideways.
await page.setViewportSize({ width: 320, height: 800 });
await page.waitForTimeout(300);
const spill = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok("fits 320px", spill <= 0, String(spill));
await prompt.screenshot({ path: `${shots}/extension-prompt-320.png` });
await page.setViewportSize({ width: 1360, height: 900 });

// Back: the Start button again.
await prompt.locator("button", { hasText: "Back" }).click();
ok("Back: Start recording again", (await startBtn.isVisible()) && !(await prompt.isVisible()));

// Record without it: records straight away; asks again next time.
await startBtn.click();
await page.click("[data-testid=extension-skip]");
ok("Record without it: records", await recording());
await discard();
await page.click("text=Screen + camera");
await startBtn.click();
ok("asks again next time", await prompt.isVisible());

// Added while the prompt is open (its script says hello): offers to start.
await page.click("[data-testid=extension-add]").catch(() => {});
await page.waitForTimeout(500);
for (const p of ctx.pages()) if (p !== page) await p.close();
ok("after Add: tells them to come back here", await page.isVisible("[data-testid=extension-waiting]"));
await page.evaluate(() => window.postMessage({ sureframe: "from-extension", type: "hello", version: "9.9.9" }, location.origin));
await page.waitForSelector("text=SureFrame extension added", { timeout: 5000 }).catch(() => {});
ok("noticed without a reload", await page.isVisible("text=SureFrame extension added"));
await page.screenshot({ path: `${shots}/extension-prompt-added.png` });
await prompt.locator("button", { hasText: "Start recording" }).click();
ok("then Start recording records", await recording());
await discard();

// Don't ask again: remembered in this browser. (A fresh page: the pretend extension above has gone.)
await page.reload();
await page.waitForSelector("text=Start recording");
await page.click("text=Screen only");
await startBtn.click();
await page.check("[data-testid=extension-dont-ask]");
await page.click("[data-testid=extension-skip]");
ok("don't ask again: records", await recording());
await discard();
await page.click("text=Screen only");
await startBtn.click();
ok("don't ask again: not asked next time", (await recording()) && !(await prompt.isVisible()));

// Edge, while the extension is only on the Chrome Web Store: how to install from there.
const ePage = await ctx.newPage();
await ePage.addInitScript(() => {
  const ua = navigator.userAgent + " Edg/131.0.0.0";
  Object.defineProperty(Navigator.prototype, "userAgent", { get: () => ua });
});
// (Asking again: "Don't ask me again" was chosen above.)
await page.evaluate(() => localStorage.removeItem("sureframe.extensionPrompt"));
await ePage.goto(BASE + "/record");
await ePage.waitForSelector("text=I've saved it", { timeout: 5000 }).then((b) => b.click()).catch(() => {});
await ePage.click("text=Screen + camera");
await ePage.locator("button", { hasText: "Start recording" }).click();
const note = ePage.locator("[data-testid=extension-edge-note]");
await note.waitFor({ timeout: 5000 }).catch(() => {});
ok("Edge: says to allow other stores on the Chrome Web Store", (await note.isVisible()) && /Allow extensions from other stores/.test(await note.innerText()));
await ePage.screenshot({ path: `${shots}/extension-prompt-edge.png` });
ok("Chrome: no Edge note", !(await page.isVisible("[data-testid=extension-edge-note]")));

await browser.close();
