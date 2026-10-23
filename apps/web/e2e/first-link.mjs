// Clients first, then sending (src/components/SendPanel.tsx):
// - a new business is shown "Start here: add your clients", and can paste a whole list;
// - a video is sent by choosing clients from one dropdown, then one Send button;
// - a new client is marked "New" and their first video goes from the business itself (its link holds
//   their key); copying it doesn't count, only their opening it, after which clients set to Email are emailed;
// - the library shows an encrypted still from each recording.
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";
import { sentRow } from "./send.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const prisma = new PrismaClient();
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};
const norm = (t) => (t ?? "").replace(/\s+/g, " ").trim();
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
ok("new business: start here step", !!(await owner.waitForSelector("[data-testid=start-here] >> text=Put in the clients you'll send videos to", { timeout: 10000 }).catch(() => null)));
ok("the client step's heading isn't repeated inside it", (await owner.locator("[data-testid=first-steps] >> text=Add your clients first").count()) === 0);
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
ok("pasted list: 3 ready, 1 repeat", /3 clients ready to add/.test(summary) && /1 already on your list/.test(summary), summary);
ok("the line to fix is listed, saying it won't be added", (await owner.textContent("[data-testid=bulk-bad]")).includes("This line won't be added") && (await owner.textContent("[data-testid=bulk-bad] li")) === "not an email@");
await owner.locator("[data-testid=bulk-add]").screenshot({ path: `${process.argv[2] ?? "/tmp"}/first-link-bulk.png` });
await owner.click("[data-testid=bulk-add] >> button:has-text('Add 3 clients')");
await owner.waitForSelector("text=Added 3 clients");
ok("the line to fix stays in the box, and the note says so", (await owner.inputValue("#bulk-list")) === "not an email@" && (await owner.textContent("[data-testid=bulk-unread]")).includes("1 line wasn't added"));
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
  // The box always starts with nobody chosen.
  await owner.click("[data-testid=client-picker]");
  for (const n of names) await owner.click(`[role=listbox] >> text=${n}`);
  if (await owner.isVisible("[role=listbox]")) await owner.click("[data-testid=send-panel] >> button:has-text('Done')");
};

// First video: private until sent. Send goes to the First time section; nothing is emailed, the link goes from you.
const first = await record();
ok("nothing chosen yet: no greyed Send button under the picker (O35)", (await owner.locator("[data-testid=send]").count()) === 0);
ok("first recording: nobody chosen for you", (await owner.textContent("[data-testid=client-picker]")).includes("Choose"));
ok("unsent: no extra notes in the Send box", (await owner.locator("[data-testid=send-private]").count()) === 0);
await owner.click("[data-testid=client-picker]");
ok("new clients are marked in the picker", (await owner.locator("[role=listbox] li:has-text('Zoe Park') [data-testid=needs-first-link]").count()) === 1);
await owner.keyboard.press("Escape");
await choose("Zoe Park");
ok("choosing Zoe: one Send to client button, nothing else yet", (await owner.textContent("[data-testid=send]")).trim() === "Send to client" && (await owner.locator("[data-testid^=sec-]").count()) === 0);
ok("dropdown shows who's chosen", (await owner.textContent("[data-testid=client-picker]")).includes("Zoe Park"));
await owner.click("[data-testid=send]");
await owner.waitForSelector("[data-testid=sec-first]", { timeout: 15000 });
const zoeRow = sentRow(owner, "Zoe Park");
// Josiah's approved wording (Decision 18), with its second sentence for clients set to Email or Copy link.
const WHY = "A new client's first link has to come from you, because it carries their private key, which we never see. Once they've opened it, clients set to Email get every video after that from us.";
ok("Zoe is under First time client - Personal link required, the why folded away", (await owner.locator("[data-testid=sec-first]").locator("[data-testid=sent-row]").count()) === 1 && !(await owner.isVisible("text=/first link has to come from you/")) && norm(await owner.textContent("[data-testid=sec-first-why]")).includes(WHY));
await owner.click("[data-testid=sec-first-why] summary");
ok("opening it shows Josiah's explanation (Decision 18)", await owner.isVisible("text=/first link has to come from you, because it carries their private key/"));
ok("Zoe is set to Email: Send from your email, no Send by email from us", (await zoeRow.locator("[data-testid=first-link-email]").count()) === 1 && (await zoeRow.locator("[data-testid=email-row]").count()) === 0);
ok("the video is hers now", (await prisma.video.findUnique({ where: { id: first } })).clientId === zoe.id);
ok("and she wasn't emailed", mailTo(zoeEmail).length === 0);
// Send from your email opens the business's email app; caught here so the page stays.
await owner.evaluate(() => document.addEventListener("click", (e) => e.target?.href?.startsWith?.("mailto:") && e.preventDefault(), true));
await zoeRow.locator("[data-testid=first-link-email]").click();
await zoeRow.locator("[data-testid=copy-instead]").click();
await zoeRow.locator("[data-testid=row-note]:has-text('Copied')").waitFor();
// The confirmation sits under Zoe's own row (S14).
ok("Copy the link instead: said under Zoe's row", norm(await zoeRow.locator("[data-testid=row-note]").textContent()).startsWith("Copied Zoe Park's video and personal link."));
ok("copying isn't called opening: Not opened yet", norm(await zoeRow.locator("[data-testid=row-opened]").textContent()).includes("Not opened yet"));
const link = await clipboard();
ok("copied link opens this video with Zoe's key", link.includes(`v=${first}`) && link.includes("#k="), link);
ok("copying the link is remembered", !!(await waitFor(async () => (await prisma.client.findUnique({ where: { id: zoe.id } })).linkSentAt, 5000)));
ok("but copying doesn't count as reaching her", !(await prisma.client.findUnique({ where: { id: zoe.id } })).linkOpenedAt);
ok("and she can't be emailed until she opens it", (await owner.evaluate(async (id) => (await fetch(`/api/videos/${id}/notify`, { method: "POST" })).status, first)) === 409);
ok("nothing emailed", mailTo(zoeEmail).length === 0);

// The team opened it, so the library has its still.
ok("library still saved, encrypted", !!(await waitFor(async () => prisma.videoThumb.findUnique({ where: { videoId: first } }), 15000)));
await owner.goto(BASE + "/library");
// The newest day starts open.
ok("library shows the still", !!(await owner.waitForSelector(`a[href="/v/${first}"] [data-testid=library-thumb]`, { timeout: 15000 }).catch(() => null)));
ok("start step gone once there are clients", (await owner.locator("[data-testid=start-here]").count()) === 0);
await owner.screenshot({ path: `${process.argv[2] ?? "/tmp"}/first-link-library.png` });

// Zoe opens her personal link: that's recorded.
const zoePage = await (await browser.newContext(perms)).newPage();
await zoePage.goto(link);
await zoePage.waitForSelector("main video", { timeout: 30000 });
ok("opening the link is recorded", !!(await waitFor(async () => (await prisma.client.findUnique({ where: { id: zoe.id } })).linkOpenedAt)));

// Second video to Zoe (has opened a link) and Ann (new): Zoe is emailed, Ann's first video goes from you.
const second = await record();
// Josiah, 23 October 2026: the box never remembers who the last video went to; it always starts on "Choose a client".
ok("after Stop: nobody is chosen, though the last video went to Zoe", (await owner.textContent("[data-testid=client-picker]")).includes("Choose") && !(await owner.textContent("[data-testid=client-picker]")).includes("Zoe Park"));
await choose("Zoe Park", `Ann Lee${stamp}`);
await owner.screenshot({ path: `${process.argv[2] ?? "/tmp"}/first-link-chosen.png` });
ok("two chosen: one Send button for both", (await owner.textContent("[data-testid=send]")).trim() === "Send to 2 clients");
await owner.click("[data-testid=send]");
await owner.waitForSelector("[data-testid=sec-email]", { timeout: 15000 });
ok("Zoe is under Emailed to, marked Emailed", (await owner.locator("[data-testid=sec-email] [data-testid=sent-row]").count()) === 1 && /Emailed/.test(norm(await sentRow(owner, "Zoe Park").textContent())));
ok("Zoe emailed about the second video", (await waitFor(() => mailTo(zoeEmail).some((m) => m.text.includes(second)))) === true);
const annRow = sentRow(owner, `Ann Lee${stamp}`);
ok("Ann is under First time, with Send from your email", (await owner.locator("[data-testid=sec-first] [data-testid=sent-row]").count()) === 1 && (await annRow.locator("[data-testid=first-link-email]").count()) === 1);
await annRow.locator("[data-testid=first-link-email]").click();
await annRow.locator("[data-testid=copy-instead]").click();
await annRow.locator("[data-testid=row-note]:has-text('Copied')").waitFor();
await owner.screenshot({ path: `${process.argv[2] ?? "/tmp"}/first-link-sent.png`, fullPage: true });
const annCopy = await prisma.video.findFirst({ where: { sourceId: second, clientId: ann.id } });
ok("Ann got her own copy", !!annCopy);
const annLink = await clipboard();
ok("Ann's link opens her own conversation", annLink.includes(`v=${annCopy?.id}`) && annLink.includes("#k="), annLink);
ok("Ann wasn't emailed a link she can't open", mailTo(annEmail).length === 0);

// Stop sharing takes it back from the first client, after an in-page confirm.
await sentRow(owner, "Zoe Park").locator("[data-testid=stop-sharing]").click();
ok("stop sharing asks first", await owner.isVisible("[data-testid=stop-sharing-confirm]"));
await owner.click("[data-testid=stop-sharing-confirm] >> button:has-text('Stop sharing with Zoe Park')");
ok("stop sharing: Zoe no longer has it", !!(await waitFor(async () => (await prisma.video.findUnique({ where: { id: second } })).clientId === null, 5000)));
ok("and it's no longer marked emailed", !(await prisma.video.findUnique({ where: { id: second } })).emailedAt);


// A business trying a client's link in its own signed-in browser still records the client's visit.
await owner.goto(BASE + "/clients");
await owner.click(`li:has-text('Mo Diaz') >> button:text-is('Copy link')`);
ok("copying from the clients page is remembered", !!(await waitFor(async () => (await prisma.client.findUnique({ where: { id: mo.id } })).linkSentAt, 5000)));
await owner.goto(await clipboard());
await owner.waitForURL("**/inbox**", { timeout: 15000 }).catch(() => {});
ok("same browser as the team: Mo's visit recorded", !!(await waitFor(async () => (await prisma.client.findUnique({ where: { id: mo.id } })).linkOpenedAt, 8000)));
ok("emails carry no key", mailTo(zoeEmail).every((m) => !m.text.includes("#k=")));

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
