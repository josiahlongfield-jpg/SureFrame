// Several clients at once (Josiah, 23 October 2026: the email, copy and first-link parts together were overwhelming).
// One "Send to N clients" button gives everyone the video and emails all it can; then only the clients whose link has
// to come from the business are listed, one Copy (or Send from your email) each, and each leaves the list once done.
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";
import { chooseClients } from "./send.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const prisma = new PrismaClient();
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};
const norm = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const shots = process.argv[2] ?? "/tmp";

const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args });
const stamp = Date.now();
const email = `sg-owner${stamp}@example.com`;
const ctx = await browser.newContext({ permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"] });
const owner = await ctx.newPage();

await owner.goto(`${BASE}/login`);
await agreed(email);
await owner.fill('input[name="email"]', email);
await owner.click("text=Continue");
await owner.waitForURL((u) => u.pathname === "/library");
const ws = (await prisma.membership.findFirst({ where: { user: { email } } })).workspaceId;

await owner.goto(BASE + "/record");
await owner.click("text=Camera only");
await owner.click("text=Start recording");
await owner.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await owner.waitForTimeout(2000);
await owner.click("button:has-text('Stop')");
await owner.waitForURL("**/v/**", { timeout: 30000 });
const videoUrl = owner.url().split("?")[0];
await owner.waitForSelector("[data-testid=send-no-clients]", { timeout: 20000 });
await owner.waitForSelector("text=I've saved it", { timeout: 3000 }).then((b) => b.click()).catch(() => {});

// Three kinds of client: one we can email, one who's opened a link but has no email saved, and one brand new.
const add = async (name, mail) => {
  const open = owner.locator("[data-testid=quick-add-open]");
  if (await open.count()) await open.click();
  await owner.fill("[data-testid=quick-add] input[aria-label='Client name']", name);
  if (mail) await owner.fill("[data-testid=quick-add] input[type=email]", mail);
  await owner.click("[data-testid=quick-add] button:has-text('Add client')");
  await owner.waitForSelector("[data-testid=quick-add]", { state: "detached", timeout: 15000 });
};
await add("Client A", `sg-a-${stamp}@example.com`);
await add("Client N");
await add("Client F", `sg-f-${stamp}@example.com`);
const byName = async (name) => prisma.client.findFirst({ where: { workspaceId: ws, name } });
await prisma.client.update({ where: { id: (await byName("Client A")).id }, data: { linkOpenedAt: new Date() } });
await prisma.client.update({ where: { id: (await byName("Client N")).id }, data: { linkOpenedAt: new Date() } });
await owner.goto(videoUrl);

await chooseClients(owner, "Client A", "Client N", "Client F");
const panel = norm(await owner.textContent("[data-testid=send-panel]"));
ok("one Send button for all three", norm(await owner.textContent("[data-testid=send-all]")) === "Send to 3 clients");
ok("nothing else to take in before sending: no email, copy, first-link or no-email parts", (await owner.locator("[data-testid=send-email], [data-testid=send-link], [data-testid=first-time], [data-testid=no-email]").count()) === 0, panel);
ok("one short line on what happens", norm(await owner.textContent("[data-testid=send-group-note]")) === "We email everyone we can, then show you who needs their link from you.");
await owner.screenshot({ path: `${shots}/send-group-chosen.png`, fullPage: true });

await owner.click("[data-testid=send-all]");
await owner.waitForSelector("[data-testid=send-todo]", { timeout: 15000 });
ok("says it went to all three, one emailed", norm(await owner.textContent("[data-testid=todo-summary]")) === "Sent to 3 clients. We emailed 1.", norm(await owner.textContent("[data-testid=todo-summary]")));
ok("everyone got the video", (await prisma.video.count({ where: { OR: [{ id: videoUrl.split("/v/")[1] }, { sourceId: videoUrl.split("/v/")[1] }], clientId: { not: null } } })) === 3);
const why = Object.fromEntries(await Promise.all(["Client N", "Client F"].map(async (n) => [n, norm(await owner.textContent(`[data-testid=todo-row]:has-text('${n}') [data-testid=todo-why]`))])));
ok("only the two who need a link from you are listed, each with why", (await owner.locator("[data-testid=todo-row]").count()) === 2 && why["Client N"] === "No email saved" && why["Client F"] === "New client", JSON.stringify(why));
ok("Client N: Copy link and Add email", (await owner.locator("[data-testid=todo-row]:has-text('Client N') [data-testid=todo-copy]").count()) === 1 && (await owner.locator("[data-testid=todo-row]:has-text('Client N') [data-testid=add-email]").count()) === 1);
ok("Client F: Send from your email and Copy link", (await owner.locator("[data-testid=todo-row]:has-text('Client F') [data-testid=first-link-email]").count()) === 1 && (await owner.locator("[data-testid=todo-row]:has-text('Client F') [data-testid=first-link-copy]").count()) === 1);
ok("Client A is under Shared, emailed", /Emailed/.test(norm(await owner.textContent("[data-testid=sent-row]:has-text('Client A')"))) && (await owner.locator("[data-testid=sent-row]").count()) === 1);
await owner.screenshot({ path: `${shots}/send-group-todo.png`, fullPage: true });

for (const width of [390, 320]) {
  await owner.setViewportSize({ width, height: 844 });
  await owner.waitForTimeout(200);
  ok(`${width}px: the list fits the screen`, await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await owner.screenshot({ path: `${shots}/send-group-todo-${width}.png`, fullPage: true });
}
await owner.setViewportSize({ width: 1280, height: 900 });

await owner.click("[data-testid=todo-row]:has-text('Client N') [data-testid=todo-copy]");
await owner.waitForSelector("[data-testid=sent-row]:has-text('Client N')");
const copiedN = await owner.evaluate(() => navigator.clipboard.readText());
ok("Client N's own link copied, with their key", copiedN.includes("v=") && copiedN.includes("#k="), copiedN);
ok("Client N leaves the list", (await owner.locator("[data-testid=todo-row]").count()) === 1);
await owner.click("[data-testid=todo-row]:has-text('Client F') [data-testid=first-link-copy]");
await owner.waitForSelector("[data-testid=todo-done]");
ok("all done once every link has gone", norm(await owner.textContent("[data-testid=todo-done]")) === "All done: everyone has their link." && (await owner.locator("[data-testid=sent-row]").count()) === 3);
ok("Client F wasn't emailed a link they can't open", !(await prisma.client.findUnique({ where: { id: (await byName("Client F")).id } })).linkOpenedAt);

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
