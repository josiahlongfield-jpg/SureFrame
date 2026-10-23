// The bell in the top menu (Josiah, 23 October 2026): a red dot while anything is unread, shaking when something new
// arrives while the site is open and on the first page after signing in or reopening the browser. A client's reply
// opens their conversation. The Library's "With replies" filter is gone.
import { chromium, devices } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";
import { sendByLink } from "./send.mjs";

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
const email = `bell-owner${stamp}@example.com`;
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"] });
const owner = await ctx.newPage();

async function signIn(page) {
  await page.goto(`${BASE}/login`);
  await agreed(email);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname === "/library");
}
/** Whether the bell shakes within `ms` (it shakes for a few seconds, then stops). */
const shakes = (page, ms) => page.waitForSelector("[data-testid=bell][data-shaking]", { timeout: ms }).then(() => true, () => false);
const dot = (page) => page.locator("[data-testid=bell-dot]").count().then((n) => n > 0);
const items = (page) => page.locator("[data-testid=bell-item]");
async function openBell(page) {
  await page.click("[data-testid=bell]");
  await page.waitForSelector("[data-testid=bell-list] :is([data-testid=bell-item], [data-testid=bell-empty])", { timeout: 15000 });
}

await signIn(owner);
const user = await prisma.user.findUnique({ where: { email } });
const ws = (await prisma.membership.findFirst({ where: { userId: user.id } })).workspaceId;
ok("the first page after signing in, with nothing unread: no shake", !(await shakes(owner, 3000)));
ok("a bell in the top menu, no dot", (await owner.isVisible("[data-testid=bell]")) && !(await dot(owner)));
ok("its label says Notifications", (await owner.getAttribute("[data-testid=bell]", "aria-label")) === "Notifications");
await openBell(owner);
ok("empty: says what shows up there", norm(await owner.textContent("[data-testid=bell-empty]")).startsWith("Nothing yet. Client replies, reminders"));
ok("no Mark all as read with nothing unread", (await owner.locator("[data-testid=bell-read-all]").count()) === 0);
await owner.keyboard.press("Escape");
ok("Escape closes it", (await owner.locator("[data-testid=bell-list]").count()) === 0);
ok("the Library has no With replies filter", !norm(await owner.textContent("main")).includes("With replies"));

// A recording sent to Client A by link.
await owner.goto(BASE + "/record");
await owner.click("text=Camera only");
await owner.click("text=Start recording");
await owner.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await owner.waitForTimeout(2000);
await owner.click("button:has-text('Stop')");
await owner.waitForURL("**/v/**", { timeout: 30000 });
await owner.waitForSelector("[data-testid=send-no-clients]", { timeout: 20000 });
await owner.waitForSelector("text=I've saved it", { timeout: 3000 }).then((b) => b.click()).catch(() => {});
const open = owner.locator("[data-testid=quick-add-open]");
if (await open.count()) await open.click();
await owner.fill("[data-testid=quick-add] input[aria-label='Client name']", "Client A");
await owner.check("[data-testid=quick-add] [data-testid=route-link]");
await owner.click("[data-testid=quick-add] button:has-text('Add client')");
await owner.waitForSelector("[data-testid=quick-add]", { state: "detached", timeout: 15000 });
await sendByLink(owner, "Client A");
const personal = await owner.evaluate(() => navigator.clipboard.readText());
const sent = await prisma.video.findFirst({ where: { workspaceId: ws, client: { name: "Client A" }, replyToId: null } });

// The owner leaves the Library open; the client replies from their phone.
await owner.goto(BASE + "/library");
await owner.waitForSelector("[data-testid=bell]");
const clientCtx = await browser.newContext({ ...devices["Pixel 7"], permissions: ["camera", "microphone"] });
const client = await clientCtx.newPage();
client.addLocatorHandler(client.getByTestId("sureframe-promo"), async () => {
  await client.click("text=/^Watch now$/", { timeout: 15000 });
});
await client.goto(personal);
await client.waitForSelector("main video", { timeout: 30000 });
async function clientReplies(text) {
  if (!(await client.isVisible("[data-testid=conversation][data-sheet]"))) {
    await client.click("[data-testid=chat-open]");
    await client.waitForSelector("[data-testid=conversation][data-sheet]");
  }
  await client.fill('textarea[aria-label="Reply"]', text);
  await client.click("button:has-text('Send reply')");
  await client.waitForSelector(`[data-testid=conversation] ul >> text=${text}`, { timeout: 15000 });
}
await clientReplies("Looks great, thanks!");
const row = async () => prisma.notification.findFirst({ where: { userId: user.id, kind: "REPLY" } });
for (let i = 0; i < 20 && !(await row()); i++) await new Promise((r) => setTimeout(r, 500));
const n1 = await row();
ok("the reply is added to the owner's bell", !!n1 && n1.href === `/v/${sent.id}?conv=1#reply` && n1.videoId === sent.id && n1.clientId === sent.clientId, JSON.stringify(n1));

// The open Library finds it by itself: the dot comes on and the bell shakes.
const live = await shakes(owner, 45000);
ok("arriving while the site is open: the bell shakes", live);
ok("and the red dot is on", await dot(owner));
ok("its label counts it", (await owner.getAttribute("[data-testid=bell]", "aria-label")) === "Notifications, 1 unread");
await owner.screenshot({ path: `${shots}/bell-dot.png`, clip: { x: 640, y: 0, width: 640, height: 80 } });

// Another page in the same visit: dot, no shake.
await owner.reload();
await owner.waitForSelector("[data-testid=bell-dot]");
ok("another page in the same visit: no shake", !(await shakes(owner, 3000)));

// Reopening the browser (its visit cookie gone, the sign-in kept): shakes again while anything is unread.
await ctx.clearCookies({ name: "sf_bell" });
await owner.reload();
ok("reopening the browser with something unread: it shakes", await shakes(owner, 5000));

// A second reply while the first is unread adds up on the same line.
await clientReplies("One more thing.");
for (let i = 0; i < 20 && (await row())?.count !== 2; i++) await new Promise((r) => setTimeout(r, 500));
await owner.evaluate(() => window.dispatchEvent(new Event("sf:notifications")));
await openBell(owner);
const texts = (await owner.locator("[data-testid=bell-text]").allTextContents()).map(norm);
ok("two replies make one line: Client A sent 2 replies to …", texts.length === 1 && /^Client A sent 2 replies to .+/.test(texts[0]), JSON.stringify(texts));
ok("shown unread", (await items(owner).first().getAttribute("data-read")) === null);
await owner.screenshot({ path: `${shots}/bell-open.png` });

// Tapping it opens the recording on Client A's conversation, and it's read.
await items(owner).first().click();
await owner.waitForURL((u) => u.pathname === `/v/${sent.id}`, { timeout: 20000 });
await owner.waitForSelector("[data-testid=conversation] ul >> text=One more thing.", { timeout: 20000 });
ok("opens on Client A's conversation with both replies", norm(await owner.textContent("[data-testid=conversation]")).includes("Looks great, thanks!"));
await owner.waitForSelector("[data-testid=bell-dot]", { state: "detached", timeout: 15000 }).catch(() => {});
ok("the dot goes", !(await dot(owner)));
ok("read on the account", !!(await row()).readAt);

// A reply arriving while that conversation is open is read straight away (it's on screen).
await clientReplies("Seen it?");
for (let i = 0; i < 30 && !(await prisma.notification.findFirst({ where: { userId: user.id, kind: "REPLY", readAt: null } })); i++) await new Promise((r) => setTimeout(r, 500));
await owner.waitForSelector("[data-testid=conversation] ul >> text=Seen it?", { timeout: 45000 });
for (let i = 0; i < 20 && (await prisma.notification.count({ where: { userId: user.id, readAt: null } })); i++) await new Promise((r) => setTimeout(r, 500));
ok("a reply that shows up in the open conversation is marked read", (await prisma.notification.count({ where: { userId: user.id, readAt: null } })) === 0);

// Other kinds: to-do reminders. Mark all as read clears them.
const todo = (text) => ({ userId: user.id, workspaceId: ws, kind: "TODO", text, href: "/todos" });
await prisma.notification.createMany({ data: [todo("Reminder: Call Client A back"), todo("Reminder: Send the plan")] });
await owner.goto(BASE + "/library");
await owner.waitForSelector("[data-testid=bell-dot]");
await openBell(owner);
ok("the list has the to-dos, newest first, then the read reply", (await items(owner).count()) === 3 && (await items(owner).last().getAttribute("data-read")) === "true");
await owner.click("[data-testid=bell-read-all]");
await owner.waitForSelector("[data-testid=bell-dot]", { state: "detached", timeout: 10000 });
ok("Mark all as read: every line read, dot gone, button gone", (await owner.locator("[data-testid=bell-item]:not([data-read])").count()) === 0 && (await owner.locator("[data-testid=bell-read-all]").count()) === 0);
ok("and on the account", (await prisma.notification.count({ where: { userId: user.id, readAt: null } })) === 0);
await owner.keyboard.press("Escape");

// Signing out and in again with something unread: it shakes on the first page.
await prisma.notification.create({ data: todo("Reminder: Book the next session") });
await owner.click("button:has-text('Sign out')");
await owner.waitForURL((u) => !u.pathname.startsWith("/library"), { timeout: 15000 });
await signIn(owner);
ok("signing in again with something unread: it shakes", await shakes(owner, 5000));

// Someone else's notifications can't be marked read.
const other = await prisma.notification.create({ data: { ...todo("Not yours"), userId: (await agreed(`bell-other${stamp}@example.com`)).id } });
const res = await owner.evaluate(async (nid) => (await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: nid }) })).json(), other.id);
ok("another person's notification isn't touched", !(await prisma.notification.findUnique({ where: { id: other.id } })).readAt && res.read === 0, JSON.stringify(res));
const signedOut = await (await browser.newContext()).request.get(`${BASE}/api/notifications`);
ok("signed out: no notifications", signedOut.status() === 401 || signedOut.status() === 403, String(signedOut.status()));

// Phones: the list fills the width under the bar.
for (const width of [390, 320]) {
  await owner.setViewportSize({ width, height: 780 });
  await owner.goto(BASE + "/library");
  await owner.waitForSelector("[data-testid=bell]");
  ok(`${width}px: the bell is in the top bar`, await owner.isVisible("[data-testid=bell]"));
  await openBell(owner);
  const box = await owner.locator("[data-testid=bell-list]").boundingBox();
  ok(`${width}px: the list fits the screen`, box.x >= 0 && box.x + box.width <= width + 0.5 && (await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)), JSON.stringify(box));
  await owner.screenshot({ path: `${shots}/bell-phone-${width}.png` });
  await owner.click("[data-testid=bell]");
}

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
