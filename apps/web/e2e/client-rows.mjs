// The Clients list: every row's controls (who looks after them, the personal link buttons, Remove client) sit
// on the right, the same size, on one line on a computer, whether or not the client still needs their personal
// link. On phones they sit under the client's name. Needs the app running with AUTH_DEV_LOGIN=true.
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const prisma = new PrismaClient();
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};
const shots = process.argv[2] ?? "/tmp";
const stamp = Date.now();
const email = `rows-owner${stamp}@example.com`;
await prisma.rateLimit.deleteMany();
await agreed(email);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] })).newPage();
await page.goto(`${BASE}/login?next=/clients`);
await page.fill('input[name="email"]', email);
await page.click("text=Continue");
await page.waitForURL((u) => u.pathname === "/clients", { timeout: 60000 });
await page.waitForSelector("text=I've saved it", { timeout: 15000 }).then((b) => b.click()).catch(() => {});

// Three clients: one with an email who hasn't opened their link (the most buttons), one without, one who has.
await page.click("[data-testid=bulk-open]");
await page.fill("#bulk-list", `Client A, client-a${stamp}@example.com\nClient B\nClient C, client-c${stamp}@example.com`);
await page.click("[data-testid=bulk-add] >> button:has-text('Add 3 clients')");
await page.waitForSelector("text=Added 3 clients");
const ws = (await prisma.membership.findFirst({ where: { user: { email } } })).workspaceId;
await prisma.workspace.update({ where: { id: ws }, data: { plan: "STUDIO" } });
// A second team member, so each row has the "who looks after them" choice.
const staffUser = await prisma.user.create({ data: { email: `rows-staff${stamp}@example.com`, name: "Team member 1" } });
await prisma.membership.create({ data: { userId: staffUser.id, workspaceId: ws, role: "MEMBER" } });
await prisma.client.updateMany({ where: { workspaceId: ws, name: "Client C" }, data: { linkOpenedAt: new Date() } });

/** For each row: its controls' boxes and the row's box. */
const rows = () =>
  page.$$eval("[data-testid=client-row-actions]", (els) =>
    els.map((el) => {
      const li = el.closest("li").getBoundingClientRect();
      const controls = [...el.querySelectorAll("select, button")].filter((b) => b.offsetParent).map((b) => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent.trim().slice(0, 20), top: Math.round(r.top), height: Math.round(r.height), right: Math.round(r.right), fontSize: getComputedStyle(b).fontSize };
      });
      return { name: el.closest("li").querySelector("a").textContent, liRight: Math.round(li.right), controls };
    }),
  );

for (const width of [1440, 1280, 1100]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${BASE}/clients`);
  await page.waitForSelector("[data-testid=client-row-actions] select", { timeout: 20000 });
  const all = await rows();
  ok(`${width}px: three rows, each with the choice of who looks after them`, all.length === 3 && all.every((r) => r.controls.some((c) => c.text.startsWith("Unassigned"))), JSON.stringify(all));
  for (const r of all) {
    const tops = new Set(r.controls.map((c) => c.top + c.height / 2).map(Math.round));
    ok(`${width}px ${r.name}: controls on one line`, [...tops].every((t) => Math.abs(t - [...tops][0]) <= 1), JSON.stringify(r.controls));
    ok(`${width}px ${r.name}: controls the same size`, new Set(r.controls.map((c) => c.fontSize)).size === 1 && Math.max(...r.controls.map((c) => c.height)) - Math.min(...r.controls.map((c) => c.height)) <= 4, JSON.stringify(r.controls));
  }
  const rights = all.map((r) => r.controls.at(-1).right);
  ok(`${width}px: every row's Remove client ends at the same right edge`, Math.max(...rights) - Math.min(...rights) <= 1, rights.join(","));
  ok(`${width}px: the client still needing their link has its buttons there too`, all.find((r) => r.name === "Client A").controls.some((c) => c.text === "Copy link + message"));
  await page.locator("[data-testid=client-row-actions]").first().locator("xpath=ancestor::ul").screenshot({ path: `${shots}/client-rows-${width}.png` });
  if (width === 1280) await page.screenshot({ path: `${shots}/client-rows-page.png`, fullPage: true });
}

// On a phone the controls go under the name and still fit the screen.
await page.setViewportSize({ width: 375, height: 800 });
await page.goto(`${BASE}/clients`);
await page.waitForSelector("[data-testid=client-row-actions] select");
const phone = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: innerWidth }));
ok("phone: nothing wider than the screen", phone.scroll <= phone.view, JSON.stringify(phone));
await page.locator("[data-testid=client-row-actions]").first().locator("xpath=ancestor::ul").screenshot({ path: `${shots}/client-rows-phone.png` });

// The removal box still spans the whole row.
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}/clients`);
await page.click("button[aria-label='Remove client Client B']");
const box = await page.$eval("[data-testid=remove-client-confirm]", (el) => [Math.round(el.getBoundingClientRect().width), Math.round(el.closest("li").getBoundingClientRect().width)]);
ok("the Remove confirm box spans the row", box[0] >= box[1] - 80, box.join(","));

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
