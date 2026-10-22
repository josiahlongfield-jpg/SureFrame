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
// After the paste: the box closes once everyone fitted, and "Done" is a real button that takes you to the list (O20).
ok("after a paste that all fitted, the paste box closes", (await page.locator("[data-testid=bulk-add]").count()) === 0);
const done = page.locator("[data-testid=added-done]");
ok("Done is a proper button", (await done.count()) === 1 && /border/.test((await done.getAttribute("class")) ?? ""));
await done.click();
ok("Done clears the note", (await page.locator("[data-testid=added-note]").count()) === 0);
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
  ok(`${width}px: a client who hasn't opened a link yet has the same Copy link as everyone`, all.find((r) => r.name === "Client A").controls.some((c) => c.text === "Copy link"));
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

// Remove client asks in a dialog that behaves like Billing's (O110, S97): opened from the keyboard, focus moves
// into it, Escape closes it without removing anyone, and focus goes back to the Remove client button.
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}/clients`);
// The list is on the page before this browser's key is checked (Decision 15); Copy link turns on once the page is live.
await page.waitForSelector("button[aria-label^='Copy link for']:not([disabled])", { timeout: 20000 });
const removeB = page.locator("button[aria-label='Remove client Client B']");
await removeB.focus();
await page.keyboard.press("Enter");
await page.waitForSelector("[role=dialog][data-testid=remove-client-confirm]");
ok("Remove client opens a dialog", (await page.getAttribute("[data-testid=remove-client-confirm]", "aria-modal")) === "true");
ok("focus moves into it", await page.evaluate(() => !!document.activeElement?.closest("[data-testid=remove-client-confirm]")));
await page.keyboard.press("Escape");
await page.waitForSelector("[data-testid=remove-client-confirm]", { state: "detached", timeout: 5000 }).catch(() => {});
ok("Escape closes it", (await page.locator("[data-testid=remove-client-confirm]").count()) === 0);
ok("and nobody was removed", !!(await page.locator("a:text-is('Client B')").count()));
ok("focus is back on Remove client", await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Remove client Client B"));

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
