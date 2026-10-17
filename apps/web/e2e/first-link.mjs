// Clients first, then sending (src/components/SendPanel.tsx):
// - a new business is shown "Start here: add your clients", and can paste a whole list;
// - a video is sent by choosing clients from one dropdown, then Send by email or Copy link;
// - a client who hasn't opened their personal link yet gets it from the business (it holds their key),
//   after which Send by email works for them;
// - the library shows an encrypted still from each recording.
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const prisma = new PrismaClient();
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};
mkdirSync(".data/outbox", { recursive: true });
const mailTo = (to) => readdirSync(".data/outbox").map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8"))).filter((m) => m.to === to && /sent you a video/.test(m.subject));
const waitFor = async (fn, ms = 20000) => {
  for (let t = 0; t < ms; t += 250) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return fn();
};

const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args });
const perms = { permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"] };
const stamp = Date.now();
const owner = await (await browser.newContext(perms)).newPage();
const clipboard = () => owner.evaluate(() => navigator.clipboard.readText());

// A new business lands on the start step, with Clients first in the menu.
await owner.goto(`${BASE}/login`);
await agreed(`fl-owner${stamp}@example.com`);
await owner.fill('input[name="email"]', `fl-owner${stamp}@example.com`);
await owner.click("text=Continue");
await owner.waitForURL((u) => u.pathname === "/library");
ok("new business: start here step", !!(await owner.waitForSelector("[data-testid=start-here] >> text=Add your clients first", { timeout: 10000 }).catch(() => null)));
await owner.screenshot({ path: `${process.argv[2] ?? "/tmp"}/first-link-start.png` });
const menu = await owner.locator("header nav a[href='/clients'], header nav a[href='/library']").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
ok("Clients comes before Library in the menu", menu.indexOf("/clients") > -1 && menu.indexOf("/clients") < menu.indexOf("/library"), menu.join("|"));

// Paste a list: names and emails, a bare email, a repeat and a bad line.
const zoeEmail = `zoe${stamp}@example.com`;
const annEmail = `ann.lee${stamp}@example.com`;
await owner.click("[data-testid=start-here] >> a:has-text('Add your clients')");
await owner.waitForURL("**/clients");
await owner.waitForSelector("text=I've saved it", { timeout: 15000 }).then((b) => b.click()).catch(() => {});
await owner.click("[data-testid=bulk-open]");
await owner.fill("#bulk-list", `Zoe Park, ${zoeEmail}\n${annEmail}\nZoe again <${zoeEmail}>\nnot an email@\nMo Diaz`);
const summary = await owner.textContent("[data-testid=bulk-summary]");
ok("pasted list: 3 ready, 1 repeat, 1 to check", /3 clients ready to add/.test(summary) && /1 already on your list/.test(summary) && /Check this line/.test(summary), summary);
await owner.locator("[data-testid=bulk-add]").screenshot({ path: `${process.argv[2] ?? "/tmp"}/first-link-bulk.png` });
await owner.click("[data-testid=bulk-add] >> button:has-text('Add 3 clients')");
await owner.waitForSelector("text=Added 3 clients");
const ws = (await prisma.membership.findFirst({ where: { user: { email: `fl-owner${stamp}@example.com` } } })).workspaceId;
const added = await prisma.client.findMany({ where: { workspaceId: ws }, orderBy: { name: "asc" } });
ok("all three added, names worked out", added.map((c) => `${c.name}:${c.email ?? ""}`).join("|") === `Ann Lee${stamp}:${annEmail}|Mo Diaz:|Zoe Park:${zoeEmail}`, added.map((c) => `${c.name}:${c.email}`).join("|"));
ok("each has their own key", added.every((c) => c.teamKeyWrap && c.teamKeyWrap.length > 40));
const [ann, mo, zoe] = added;
// The Free plan's three seats are now full: a list can't go over.
const over = await owner.evaluate(async () => (await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clients: [{ name: "X", teamKeyWrap: "x".repeat(60) }], keyFingerprint: "x".repeat(20) }) })).status);
ok("no seats left: list refused", over >= 400, String(over));

async function record() {
  await owner.goto(BASE + "/record");
  await owner.click("text=Camera only");
  await owner.click("text=Start recording");
  await owner.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
  await owner.waitForTimeout(2500);
  await owner.click("button:has-text('Stop')");
  await owner.waitForURL("**/v/**", { timeout: 30000 });
  await owner.waitForSelector("[data-testid=client-picker]", { timeout: 20000 });
  return owner.url().split("/v/")[1].split("?")[0];
}
const choose = async (...names) => {
  await owner.click("[data-testid=client-picker]");
  for (const n of names) await owner.click(`[role=listbox] >> text=${n}`);
  if (await owner.isVisible("[role=listbox]")) await owner.click("[data-testid=send-panel] >> button:has-text('Done')");
};

// First video: private until sent. Copy link puts Zoe's personal link on the clipboard and emails nobody.
const first = await record();
ok("unsent: only the team can watch", await owner.isVisible("[data-testid=send-private]"));
await choose("Zoe Park");
ok("dropdown shows who's chosen", (await owner.textContent("[data-testid=client-picker]")).includes("Zoe Park"));
await owner.click("[data-testid=send-link]");
await owner.waitForSelector("text=/link is copied/");
const link = await clipboard();
ok("copied link opens this video with Zoe's key", link.includes(`v=${first}`) && link.includes("#k="), link);
const list = await owner.textContent("[data-testid=sent-list]");
ok("Zoe is listed as sent, link copied", list.includes("Zoe Park") && list.includes("Link copied"), list);
ok("the video is hers now", (await prisma.video.findUnique({ where: { id: first } })).clientId === zoe.id);
ok("copying the link is remembered", !!(await waitFor(async () => (await prisma.client.findUnique({ where: { id: zoe.id } })).linkSentAt, 5000)));
ok("Copy link emails nobody", mailTo(zoeEmail).length === 0);

// The team opened it, so the library has its still.
ok("library still saved, encrypted", !!(await waitFor(async () => prisma.videoThumb.findUnique({ where: { videoId: first } }), 15000)));
await owner.goto(BASE + "/library");
await owner.click("[data-testid=day-folder] summary");
ok("library shows the still", !!(await owner.waitForSelector(`a[href="/v/${first}"] [data-testid=library-thumb]`, { timeout: 15000 }).catch(() => null)));
ok("start step gone once there are clients", (await owner.locator("[data-testid=start-here]").count()) === 0);
await owner.screenshot({ path: `${process.argv[2] ?? "/tmp"}/first-link-library.png` });

// Second video to Zoe (has her link) and Ann (hasn't): Zoe is emailed, Ann needs her link from you.
const second = await record();
await choose("Zoe Park", `Ann Lee${stamp}`);
await owner.screenshot({ path: `${process.argv[2] ?? "/tmp"}/first-link-chosen.png` });
await owner.click("[data-testid=send-email]");
const note = await waitFor(async () => {
  const t = await owner.textContent("[data-testid=send-status]").catch(() => "");
  return /Emailed/.test(t) ? t : null;
}, 15000);
ok("says who was emailed and who wasn't", /Emailed 1 client/.test(note ?? "") && /Ann can.t be emailed yet/.test(note ?? ""), String(note));
ok("Zoe emailed about the second video", (await waitFor(() => mailTo(zoeEmail).some((m) => m.text.includes(second)))) === true);
await waitFor(async () => (await owner.locator("[data-testid=sent-row]").count()) === 2, 5000);
await owner.screenshot({ path: `${process.argv[2] ?? "/tmp"}/first-link-sent.png`, fullPage: true });
const annRow = owner.locator("[data-testid=sent-row]", { hasText: "Ann Lee" });
ok("Ann's row says to send her link this first time", (await annRow.locator("[data-testid=first-time]").count()) === 1);
const annCopy = await prisma.video.findFirst({ where: { sourceId: second, clientId: ann.id } });
ok("Ann got her own copy", !!annCopy);
await annRow.locator("[data-testid=copy-row-link]").click();
await owner.waitForTimeout(300);
const annLink = await clipboard();
ok("Ann's link opens her own conversation", annLink.includes(`v=${annCopy?.id}`) && annLink.includes("#k="), annLink);
ok("Ann wasn't emailed a link she can't open", mailTo(annEmail).length === 0);

// Undo takes it back from the first client while they haven't replied.
await owner.locator("[data-testid=sent-row]", { hasText: "Zoe Park" }).locator("button:has-text('Undo')").click();
ok("undo: Zoe no longer has it", !!(await waitFor(async () => (await prisma.video.findUnique({ where: { id: second } })).clientId === null, 5000)));

// Zoe opens her personal link: that's recorded.
const zoePage = await (await browser.newContext(perms)).newPage();
await zoePage.goto(link);
await zoePage.waitForSelector("main video", { timeout: 30000 });
ok("opening the link is recorded", !!(await waitFor(async () => (await prisma.client.findUnique({ where: { id: zoe.id } })).linkOpenedAt)));

// A business trying a client's link in its own signed-in browser still records the client's visit.
await owner.goto(BASE + "/clients");
await owner.click(`li:has-text('Mo Diaz') >> button:has-text('Copy personal link')`);
ok("copying from the clients page is remembered", !!(await waitFor(async () => (await prisma.client.findUnique({ where: { id: mo.id } })).linkSentAt, 5000)));
await owner.goto(await clipboard());
await owner.waitForURL("**/inbox**", { timeout: 15000 }).catch(() => {});
ok("same browser as the team: Mo's visit recorded", !!(await waitFor(async () => (await prisma.client.findUnique({ where: { id: mo.id } })).linkOpenedAt, 8000)));
ok("emails carry no key", mailTo(zoeEmail).every((m) => !m.text.includes("#k=")));

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
