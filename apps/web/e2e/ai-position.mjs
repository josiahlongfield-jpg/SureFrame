// The AI summary box on a video's page: only there while the business pays for the AI summaries add-on (no box,
// not even an offer, without it), and then near the top for the team: under the "End-to-end encrypted" note,
// straight above the message to the client. On a computer and a phone.
import { chromium, devices } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const prisma = new PrismaClient();
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const email = `aipos${Date.now()}@example.com`;
await agreed(email);
const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login?next=/record`);
await page.fill('input[name="email"]', email);
await page.click("text=Continue");
await page.waitForURL("**/record");
await page.click("text=I've saved it");
const ws = (await prisma.membership.findFirst({ where: { user: { email } } })).workspaceId;
await prisma.workspace.update({ where: { id: ws }, data: { plan: "STUDIO", aiAssist: false } });
await page.goto(`${BASE}/record`);
await page.click("text=Camera only");
await page.click("text=Start recording");
await page.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await page.waitForTimeout(2500);
await page.click("button:has-text('Stop')");
await page.waitForURL("**/v/**", { timeout: 30000 });
const url = page.url();
await page.waitForSelector("[data-testid=message-editor]", { timeout: 20000 });

ok("without the add-on: no AI summary box", (await page.locator("[data-testid=ai-insight]").count()) === 0);
ok("without the add-on: no AI offer box either", (await page.locator("[data-testid=ai-offer]").count()) === 0 && !(await page.isVisible("text=AI summary.")));

// The business switches the add-on on.
await prisma.workspace.update({ where: { id: ws }, data: { aiAssist: true } });
for (const [name, size] of [["computer", { width: 1280, height: 900 }], ["phone", devices["iPhone 13"].viewport]]) {
  await page.setViewportSize(size);
  await page.goto(url);
  await page.waitForSelector("[data-testid=ai-insight]", { timeout: 20000 });
  const order = await page.evaluate(() => {
    const top = (s) => document.querySelector(s)?.getBoundingClientRect().top ?? null;
    const ai = document.querySelector("[data-testid=ai-insight]");
    const msg = document.querySelector("[data-testid=message-editor]");
    return { purge: top("[data-testid=purge-note]"), ai: top("[data-testid=ai-insight]"), message: top("[data-testid=message-editor]"), send: top("[data-testid=send-panel]"), next: ai?.nextElementSibling === msg };
  });
  ok(`${name}: with the add-on, the AI summary box is there`, order.ai !== null);
  ok(`${name}: it sits under the "End-to-end encrypted" note`, order.purge !== null && order.ai > order.purge, JSON.stringify(order));
  ok(`${name}: straight above the message to the client`, order.next && order.ai < order.message, JSON.stringify(order));
  ok(`${name}: above the Send box`, order.send === null || order.ai < order.send, JSON.stringify(order));
  await page.screenshot({ path: `${shots}/ai-position-${name}.png`, fullPage: true });
}

// The add-on ends: the box goes again.
await prisma.workspace.update({ where: { id: ws }, data: { aiAssist: false } });
await page.goto(url);
await page.waitForSelector("[data-testid=message-editor]", { timeout: 20000 });
ok("add-on ended: the box is gone again", (await page.locator("[data-testid=ai-insight]").count()) === 0);

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
