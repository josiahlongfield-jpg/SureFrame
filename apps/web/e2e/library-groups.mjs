// The library folds older videos away (src/app/library/page.tsx, src/lib/libraryGroups.ts):
// - by date: the last 7 days a folder each, then a folder a week, then a folder a month (weeks inside, days inside
//   those); only the first folder starts open, and a closed folder's videos aren't drawn until it's opened;
// - by client: a folder per client, newest first, a video sent to two clients in both, and "Not sent yet";
// - tiles or one line per video;
// - both choices are remembered in this browser, and everything fits a 320px phone.
import crypto from "node:crypto";
import { chromium } from "@playwright/test";
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
const waitFor = async (fn, ms = 20000) => {
  for (let t = 0; t < ms; t += 250) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return fn();
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const ctx = await browser.newContext({ permissions: ["camera", "microphone"], timezoneId: "UTC" });
const page = await ctx.newPage();
const email = `groups${Date.now()}@example.com`;
await agreed(email);
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', email);
await page.click("text=Continue");
await page.waitForURL((u) => u.pathname === "/library");
const me = await waitFor(() => prisma.membership.findFirst({ where: { user: { email } } }));
const ws = me.workspaceId;

// One real recording, then more made from it at chosen ages.
await page.goto(BASE + "/record");
await page.waitForSelector("text=I've saved it", { timeout: 5000 }).then((b) => b.click()).catch(() => {});
await page.click("text=Camera only");
await page.click("text=Start recording");
await page.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await page.waitForTimeout(1500);
await page.click("button:has-text('Stop')");
await page.waitForURL("**/v/**", { timeout: 30000 });
const realId = page.url().split("/v/")[1].split("?")[0];
const real = await prisma.video.findUnique({ where: { id: realId } });

const DAY = 86_400_000;
const now = Date.now();
const make = async (daysAgo, title, data = {}) =>
  (
    await prisma.video.create({
      data: {
        id: crypto.randomBytes(6).toString("base64url"),
        title,
        status: "READY",
        mimeType: real.mimeType,
        storageKey: real.storageKey,
        sizeBytes: real.sizeBytes,
        durationMs: real.durationMs,
        encrypted: real.encrypted,
        teamKeyWrap: real.teamKeyWrap,
        ownerId: real.ownerId,
        workspaceId: ws,
        purgeAt: real.purgeAt,
        createdAt: new Date(now - daysAgo * DAY),
        ...data,
      },
    })
  ).id;
const clientA = await prisma.client.create({ data: { name: "Client A", email: `a${Date.now()}@example.com`, token: crypto.randomBytes(16).toString("hex"), workspaceId: ws } });
const clientB = await prisma.client.create({ data: { name: "Client B", email: `b${Date.now()}@example.com`, token: crypto.randomBytes(16).toString("hex"), workspaceId: ws } });
const ages = [2, 3, 9, 10, 16, 45, 46, 47, 80, 81, 110];
const made = {};
for (const d of ages) made[d] = await make(d, `Video ${d} days ago`, d === 9 || d === 46 ? { clientId: clientA.id } : d === 3 ? { clientId: clientB.id } : {});
// Video 46 also went to Client B, as a copy.
await make(46, "Video 46 days ago", { clientId: clientB.id, sourceId: made[46] });
await prisma.video.update({ where: { id: realId }, data: { clientId: clientA.id } });
const total = ages.length + 1;

await page.goto(BASE + "/library");
await page.waitForSelector("[data-testid=view-date]");
const top = await page.$$eval("main [data-testid$=-folder]:not([data-testid$=-folder] [data-testid$=-folder])", (els) => els.map((e) => e.dataset.testid));
const counts = await page.$$eval("main [data-testid$=-folder]:not([data-testid$=-folder] [data-testid$=-folder]) > summary [data-testid$=-count]", (els) => els.map((e) => parseInt(e.textContent)));
ok("every video is in a top-level folder once", counts.reduce((a, b) => a + b, 0) === total, JSON.stringify(counts));
const firstWeek = top.indexOf("week-folder");
const firstMonth = top.indexOf("month-folder");
ok(
  "days first, then weeks, then months",
  top[0] === "day-folder" && firstWeek > 0 && firstMonth > firstWeek && top.slice(0, firstWeek).every((t) => t === "day-folder") && top.slice(firstMonth).every((t) => t === "month-folder"),
  JSON.stringify(top),
);
ok("no more than 7 day folders", top.filter((t) => t === "day-folder").length <= 7);
ok("today's folder starts open", await page.isVisible(`main a[href="/v/${realId}"]`));
ok("a closed folder's videos aren't drawn yet", (await page.$(`main a[href="/v/${made[110]}"]`)) === null);
const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(now - 46 * DAY));
ok("months are named", (await page.$$eval("[data-testid=month-label]", (els) => els.map((e) => e.textContent))).includes(monthLabel));
await page.screenshot({ path: `${shots}/library-groups-date.png`, fullPage: true });

// Open the month with three videos on three days in a row: inside, folders, then videos.
const month = page.locator("[data-testid=month-folder]", { has: page.locator(`[data-testid=month-label]:text-is("${monthLabel}")`) }).first();
await month.locator("> summary").click();
const inner = month.locator("[data-testid=week-folder], [data-testid=day-folder]");
ok("an opened month shows folders inside", (await inner.count()) >= 1, String(await inner.count()));
// Keep opening the first closed folder until the 46-day-old video shows.
for (let i = 0; i < 3 && !(await page.isVisible(`main a[href="/v/${made[46]}"]`)); i++) {
  const closed = month.locator("details:not([open]) > summary").first();
  if (await closed.count()) await closed.click();
}
ok("opening folders inside it reaches the video", await page.isVisible(`main a[href="/v/${made[46]}"]`));
const arrows = await month.evaluate((m) =>
  [...m.querySelectorAll("details details:not([open]) > summary svg")].map((s) => getComputedStyle(s).transform),
);
ok("closed folders inside an open one keep their arrow pointing down", arrows.every((t) => t === "none"), JSON.stringify(arrows));
await page.reload();
await page.waitForSelector("[data-testid=view-date]");
ok("an opened month stays open after a reload in this tab", !!(await page.waitForSelector(`main a[href="/v/${made[46]}"]`, { timeout: 10000 }).catch(() => null)));

// By client.
await page.click("[data-testid=view-client]");
await page.waitForSelector("[data-testid=client-folder]");
const clientLabels = await page.$$eval("[data-testid=client-label]", (els) => els.map((e) => e.textContent));
ok("one folder per client, newest first, then Not sent yet", JSON.stringify(clientLabels) === JSON.stringify(["Client A", "Client B", "Not sent yet"]), JSON.stringify(clientLabels));
const clientCount = async (name) => page.locator("[data-testid=client-folder]", { has: page.locator(`[data-testid=client-label]:text-is("${name}")`) }).locator("> summary [data-testid=client-count]").textContent();
ok("Client A has its 3 videos", (await clientCount("Client A")) === "3 videos", await clientCount("Client A"));
ok("a video sent to two clients is in both", (await clientCount("Client B")) === "2 videos", await clientCount("Client B"));
ok("the rest are under Not sent yet", (await clientCount("Not sent yet")) === `${total - 4} videos`, await clientCount("Not sent yet"));
ok("the first client starts open", await page.isVisible(`main a[href="/v/${realId}"]`));
await page.reload();
await page.waitForSelector("[data-testid=client-folder]");
ok("By client is remembered", (await page.getAttribute("[data-testid=view-client]", "aria-pressed")) === "true");
await page.screenshot({ path: `${shots}/library-groups-client.png`, fullPage: true });

// The one-line list.
const rowTiles = await page.locator("[data-testid=client-folder] > summary").nth(1).evaluate((e) => e.getBoundingClientRect().height);
await page.click("[data-testid=layout-list]");
await page.waitForSelector("[data-testid=video-list]");
const rowList = await page.locator("[data-testid=client-folder] > summary").nth(1).evaluate((e) => e.getBoundingClientRect().height);
ok("List makes the folder rows smaller too", rowList < rowTiles - 15, JSON.stringify({ rowTiles, rowList }));
ok("List drops the extra stills beside a folder", (await page.$$("[data-testid=folder-strip]")).length === 0);
const rowHeight = await page.locator(`[data-testid=video-list] a[href="/v/${realId}"]`).evaluate((a) => a.getBoundingClientRect().height);
ok("a list line is short", rowHeight < 110, String(rowHeight));
await page.reload();
ok("List is remembered", !!(await page.waitForSelector("[data-testid=video-list]", { timeout: 10000 }).catch(() => null)));
await page.screenshot({ path: `${shots}/library-groups-list.png`, fullPage: true });

// Search still works, in the chosen layout, with no folders.
await page.fill("[data-testid=library-search]", "Video 9 days");
await page.waitForURL(/q=Video/, { timeout: 10000 });
await page.waitForSelector("[data-testid=search-summary]");
ok("search shows matches without folders", (await page.$$("main [data-testid$=-folder]")).length === 0 && (await page.isVisible(`main a[href="/v/${made[9]}"]`)));
await page.goto(BASE + "/library");

// Phones, in every mode.
await page.setViewportSize({ width: 320, height: 700 });
for (const [view, layout] of [["client", "list"], ["client", "tiles"], ["date", "tiles"], ["date", "list"]]) {
  await page.click(`[data-testid=view-${view}]`);
  await page.click(`[data-testid=layout-${layout}]`);
  await page.waitForTimeout(800);
  await page.waitForSelector(`[data-testid=layout-${layout}][aria-pressed=true]`);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(`fits a 320px screen: by ${view}, ${layout}`, wide <= 320, String(wide));
}
await page.locator("[data-testid=month-folder] > summary").first().click();
await page.waitForTimeout(300);
const wide = await page.evaluate(() => document.documentElement.scrollWidth);
ok("fits a 320px screen with a month open", wide <= 320, String(wide));
await page.screenshot({ path: `${shots}/library-groups-phone.png`, fullPage: true });

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
