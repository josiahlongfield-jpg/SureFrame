// The business name can be set on the branding page, shows in the client
// preview before saving, and is saved with the branding.
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const db = new PrismaClient();
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined });
const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
const email = `brandname${Date.now()}@acme.com`;
await page.goto(BASE + "/record");
await agreed(email);
await page.fill('input[name="email"]', email);
await page.click("text=Continue");
await page.waitForURL("**/record");
await page.goto(BASE + "/library");
const user = await db.user.findUnique({ where: { email }, include: { memberships: true } });
const wsId = user.memberships[0].workspaceId;
await db.workspace.update({ where: { id: wsId }, data: { plan: "STUDIO" } });

await page.goto(BASE + "/settings/branding");
const field = page.getByLabel("Business name");
await field.waitFor({ timeout: 20000 });
ok("name field shows the current name", (await field.inputValue()).endsWith("'s workspace"));
ok("hint to replace the default name", await page.isVisible("[data-testid=name-hint]"));

await field.fill("Peak Fitness Co");
ok("hint goes once a real name is typed", !(await page.isVisible("[data-testid=name-hint]")));
const frame = page.frameLocator('iframe[src*="/settings/branding/preview"]').first();
const shown = await frame.locator("text=Peak Fitness Co").first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
ok("preview shows the new name before saving", shown);
ok("marked as not saved", await page.isVisible("[data-testid=unsaved]"));

await field.fill("");
ok("empty name can't be saved", await page.isDisabled("button:has-text('Save branding')"));
await field.fill("Peak Fitness Co");
await page.click("button:has-text('Save branding')");
await page.waitForSelector("text=Saved. Your clients see this now.", { timeout: 15000 });
ok("name saved", (await db.workspace.findUnique({ where: { id: wsId } })).name === "Peak Fitness Co");
// O102: the button itself says it's saved, until something changes again.
ok("after saving, the button says Saved", (await page.isVisible("button:has-text('Saved ✓')")) && (await page.locator("[data-testid=unsaved]").count()) === 0);
await field.fill("Peak Fitness Co.");
ok("changing it again: back to Save branding, the saved line goes", (await page.isVisible("button:has-text('Save branding')")) && (await page.locator("[data-testid=branding-saved]").count()) === 0);
await field.fill("Peak Fitness Co");

await page.reload();
await page.getByLabel("Business name").waitFor();
ok("saved name shown after reload", (await page.getByLabel("Business name").inputValue()) === "Peak Fitness Co");

await browser.close();
await db.$disconnect();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
