// One recording sent to several clients (Josiah, 23 October 2026): the box beside the video lists every client's
// conversation, each opening in that same box with a Back arrow to the list. Each client still only sees their own.
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";
import { sendTo } from "./send.mjs";

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
const email = `cv-owner${stamp}@example.com`;
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"] });
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
const id = videoUrl.split("/v/")[1];
await owner.waitForSelector("[data-testid=send-no-clients]", { timeout: 20000 });
await owner.waitForSelector("text=I've saved it", { timeout: 3000 }).then((b) => b.click()).catch(() => {});

for (const name of ["Client A", "Client B", "Client C"]) {
  const open = owner.locator("[data-testid=quick-add-open]");
  if (await open.count()) await open.click();
  await owner.fill("[data-testid=quick-add] input[aria-label='Client name']", name);
  await owner.check("[data-testid=quick-add] [data-testid=route-link]");
  await owner.click("[data-testid=quick-add] button:has-text('Add client')");
  await owner.waitForSelector("[data-testid=quick-add]", { state: "detached", timeout: 15000 });
}
const byName = async (name) => prisma.client.findFirst({ where: { workspaceId: ws, name } });
for (const n of ["Client A", "Client B", "Client C"]) await prisma.client.update({ where: { id: (await byName(n)).id }, data: { linkOpenedAt: new Date() } });
await owner.goto(videoUrl);

const panel = "[data-testid=conversation]";
const title = async () => norm(await owner.textContent(`${panel} [data-testid=conversation-title]`));
ok("before sending: one conversation, no list", (await title()) === "Conversation" && (await owner.locator("[data-testid=conv-list]").count()) === 0);

// One client: the box is that one conversation, as before.
await sendTo(owner, "Client A");
await owner.waitForFunction(() => document.querySelector("[data-testid=conversation-title]")?.textContent?.includes("Client A"), null, { timeout: 15000 });
ok("one client: Conversation with Client A, no list or Back", (await title()) === "Conversation with Client A" && (await owner.locator("[data-testid=conv-back]").count()) === 0);

// A second and third client: the box turns into the list.
await sendTo(owner, "Client B", "Client C");
await owner.waitForSelector("[data-testid=conv-list]", { timeout: 15000 });
ok("several clients: headed Conversations (3)", (await title()) === "Conversations (3)", await title());
ok("says each client only sees their own", norm(await owner.textContent(panel)).includes("Each client only sees their own conversation."));
const names = async () => (await owner.locator("[data-testid=conv-name]").allTextContents()).map(norm);
ok("lists every client, in the order sent", JSON.stringify(await names()) === JSON.stringify(["Client A", "Client B", "Client C"]), JSON.stringify(await names()));
ok("no reply box under the list", !(await owner.isVisible(`${panel} textarea[aria-label="Reply"]`)));
await owner.screenshot({ path: `${shots}/conversations-list.png`, fullPage: true });

const item = (name) => owner.locator("[data-testid=conv-item]").filter({ has: owner.locator(`[data-testid=conv-name]:text-is("${name}")`) });
const copyB = await prisma.video.findFirst({ where: { sourceId: id, clientId: (await byName("Client B")).id } });
const copyC = await prisma.video.findFirst({ where: { sourceId: id, clientId: (await byName("Client C")).id } });

// Client B's conversation opens in the same box; a message goes to their copy only.
await item("Client B").click();
await owner.waitForFunction(() => document.querySelector("[data-testid=conversation-title]")?.textContent?.includes("Client B"));
ok("opens Conversation with Client B, with a Back arrow", (await title()) === "Conversation with Client B" && (await owner.isVisible("[data-testid=conv-back]")));
ok("still on the recording's own page", owner.url().split("?")[0] === videoUrl);
await owner.waitForSelector(`${panel} [data-testid=conversation-empty]`);
ok("B's empty conversation says only B and the team see it", norm(await owner.textContent(`${panel} [data-testid=conversation-empty]`)) === "Only Client B and your team can see this conversation.");
await owner.fill(`${panel} textarea[aria-label="Reply"]`, "Just for B.");
await owner.click(`${panel} button:has-text('Send reply')`);
await owner.waitForSelector(`${panel} ul >> text=Just for B.`);
ok("the message is saved on Client B's copy", (await prisma.reply.count({ where: { videoId: copyB.id } })) === 1 && (await prisma.reply.count({ where: { videoId: id } })) === 0);
await owner.screenshot({ path: `${shots}/conversations-open.png`, fullPage: true });

await owner.click("[data-testid=conv-back]");
await owner.waitForSelector("[data-testid=conv-list]");
ok("Back shows the list again, B now with 1 message", norm(await item("Client B").textContent()).includes("1 message"));

// Client A's conversation doesn't have B's message.
await item("Client A").click();
await owner.waitForFunction(() => document.querySelector("[data-testid=conversation-title]")?.textContent?.includes("Client A"));
await owner.waitForSelector(`${panel} [data-testid=conversation-empty]`);
ok("Client A's conversation is their own: B's message isn't there", !norm(await owner.textContent(panel)).includes("Just for B."));
await owner.click("[data-testid=conv-back]");

// Client C replies (as the client would): a new-reply dot on their row until it's read.
await prisma.reply.create({ data: { kind: "TEXT", body: "Hello from C", authorName: "Client C", videoId: copyC.id, byClient: true } });
await owner.reload();
await owner.waitForSelector("[data-testid=conv-list]", { timeout: 20000 });
ok("C's row: 1 message, 1 new, with a dot", /1 message · 1 new/.test(norm(await item("Client C").textContent())) && (await item("Client C").locator("[data-testid=conv-unread]").count()) === 1);
ok("B's row has no dot (only your own message)", (await item("Client B").locator("[data-testid=conv-unread]").count()) === 0);
await item("Client C").click();
await owner.waitForSelector(`${panel} ul >> text=Hello from C`, { timeout: 15000 });
await owner.click("[data-testid=conv-back]");
ok("read: C's dot goes", (await item("Client C").locator("[data-testid=conv-unread]").count()) === 0);

// A client's own copy page opens on that client's conversation, with Back to the list.
await owner.goto(`${BASE}/v/${copyB.id}`);
await owner.waitForSelector(`${panel} [data-testid=conversation-title]`, { timeout: 20000 });
await owner.waitForSelector(`${panel} ul >> text=Just for B.`, { timeout: 15000 });
ok("B's copy page: Conversation with Client B, Back to the list", (await title()) === "Conversation with Client B" && (await owner.isVisible("[data-testid=conv-back]")));
await owner.click("[data-testid=conv-back]");
ok("and its list has all three", (await names()).length === 3);

// Phones: the card under the video opens the list in the full-screen sheet.
for (const width of [390, 320]) {
  await owner.setViewportSize({ width, height: 780 });
  await owner.goto(videoUrl);
  await owner.waitForSelector("[data-testid=chat-inline]", { timeout: 20000 });
  ok(`${width}px: the card says Conversations (3)`, norm(await owner.textContent("[data-testid=chat-inline]")).startsWith("Conversations (3)"));
  ok(`${width}px: its button opens conversations`, norm(await owner.textContent("[data-testid=chat-open]")) === "Open conversations");
  await owner.click("[data-testid=chat-open]");
  await owner.waitForSelector(`${panel}[data-sheet] [data-testid=conv-list]`);
  ok(`${width}px: the list fits the screen`, await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await owner.screenshot({ path: `${shots}/conversations-phone-list-${width}.png` });
  await item("Client B").click();
  await owner.waitForSelector(`${panel}[data-sheet] ul >> text=Just for B.`, { timeout: 15000 });
  ok(`${width}px: B's conversation opens in the sheet, with Back`, (await title()) === "Conversation with Client B" && (await owner.isVisible("[data-testid=conv-back]")));
  ok(`${width}px: the conversation fits the screen`, await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await owner.screenshot({ path: `${shots}/conversations-phone-open-${width}.png` });
  await owner.click("[data-testid=conv-back]");
  await owner.waitForSelector(`${panel}[data-sheet] [data-testid=conv-list]`);
  await owner.click("[data-testid=chat-close]");
  await owner.waitForSelector(`${panel}[data-sheet]`, { state: "detached" });
}
await owner.setViewportSize({ width: 1280, height: 900 });

// Stopping sharing with two of them leaves one conversation: the box goes back to it.
await owner.goto(videoUrl);
for (const name of ["Client B", "Client C"]) {
  const row = owner.locator("[data-testid=sent-row]").filter({ has: owner.locator(`[data-testid=row-name]:text-is("${name}")`) });
  await row.locator("[data-testid=stop-sharing]").click();
  await owner.click(`[data-testid=stop-sharing-confirm] button:has-text('Stop sharing with ${name}')`);
  await row.waitFor({ state: "detached", timeout: 15000 });
}
await owner.waitForFunction(() => document.querySelector("[data-testid=conversation-title]")?.textContent === "Conversation with Client A", null, { timeout: 15000 });
ok("down to one client: back to Conversation with Client A, no list", (await owner.locator("[data-testid=conv-list]").count()) === 0 && (await owner.locator("[data-testid=conv-back]").count()) === 0);

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
