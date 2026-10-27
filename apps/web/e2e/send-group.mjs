// How each client gets their videos (Josiah, 23 October 2026): chosen once, when they're added (Email, or Copy link to
// send however you choose), then one Send button for one client or several. After it, up to three sections: "Emailed
// to", "Copy link to" and "First time client - Personal link required".
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";
import { chooseClients, sentRow } from "./send.mjs";

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
// Five clients: more than the free plan's three seats.
await prisma.workspace.update({ where: { id: ws }, data: { plan: "SOLO" } });

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

// Five clients: Email (reached), Copy link (reached), Email but they turned emails off (reached), and two new ones.
const add = async (name, mail) => {
  const open = owner.locator("[data-testid=quick-add-open]");
  if (await open.count()) await open.click();
  await owner.fill("[data-testid=quick-add] input[aria-label='Client name']", name);
  ok(`${name}: Add client waits for how they'll receive videos`, await owner.isDisabled("[data-testid=quick-add] button:has-text('Add client')"));
  await owner.check(`[data-testid=quick-add] [data-testid=route-${mail ? "email" : "link"}]`);
  if (mail) {
    ok(`${name}: Email shows a box for their address, and Add waits for it`, (await owner.isVisible("[data-testid=quick-add] input[aria-label='Client email']")) && (await owner.isDisabled("[data-testid=quick-add] button:has-text('Add client')")));
    await owner.fill("[data-testid=quick-add] input[aria-label='Client email']", mail);
  } else {
    ok(`${name}: Copy link has no email box`, (await owner.locator("[data-testid=quick-add] input[aria-label='Client email']").count()) === 0);
  }
  await owner.click("[data-testid=quick-add] button:has-text('Add client')");
  await owner.waitForSelector("[data-testid=quick-add]", { state: "detached", timeout: 15000 }).catch(async (e) => {
    console.log("quick-add still open:", norm(await owner.textContent("[data-testid=send-panel]")));
    throw e;
  });
  return norm(await owner.textContent("[data-testid=send-status]"));
};
const lineA = await add("Client A", `sg-a-${stamp}@example.com`);
ok("adding by Email: a line confirms it, and where to change it", lineA === "Client A will receive their videos by email. You can change this in Clients at any time.", lineA);
await owner.screenshot({ path: `${shots}/send-route-added.png`, fullPage: true });
const lineL = await add("Client L");
ok("adding by Copy link: a line confirms it", lineL === "Client L will receive their videos by copy link, sent however you choose. You can change this in Clients at any time.", lineL);
await add("Client O", `sg-o-${stamp}@example.com`);
await add("Client F", `sg-f-${stamp}@example.com`);
await add("Client G");
const byName = async (name) => prisma.client.findFirst({ where: { workspaceId: ws, name } });
ok("Copy link clients are saved with no email", !(await byName("Client L")).email && (await byName("Client A")).email === `sg-a-${stamp}@example.com`);
for (const n of ["Client A", "Client L", "Client O"]) await prisma.client.update({ where: { id: (await byName(n)).id }, data: { linkOpenedAt: new Date() } });
await prisma.client.update({ where: { id: (await byName("Client O")).id }, data: { remindersOff: true } });
await owner.goto(videoUrl);

await chooseClients(owner, "Client A");
ok("one client: the button says Send to client", norm(await owner.textContent("[data-testid=send]")) === "Send to client");
// Client A stays chosen.
await chooseClients(owner, "Client L", "Client O", "Client F", "Client G");
ok("several: one button, Send to 5 clients", norm(await owner.textContent("[data-testid=send]")) === "Send to 5 clients");
ok("nothing else to take in before sending", (await owner.locator("[data-testid^=sec-], [data-testid=first-link-sender]").count()) === 0);
await owner.screenshot({ path: `${shots}/send-route-chosen.png`, fullPage: true });

await owner.click("[data-testid=send]");
await owner.waitForSelector("[data-testid=sec-first]", { timeout: 15000 });
const id = videoUrl.split("/v/")[1];
ok("everyone got the video", (await prisma.video.count({ where: { OR: [{ id }, { sourceId: id }], clientId: { not: null } } })) === 5);
const names = async (sec) => owner.$$eval(`[data-testid=sec-${sec}] [data-testid=sent-row]`, (rs) => rs.map((r) => r.querySelector("[data-testid=row-name]").textContent.trim()));
const [em, li, fi] = [await names("email"), await names("link"), await names("first")];
ok("Emailed to: only the Email client who can be emailed", JSON.stringify(em) === '["Client A"]', JSON.stringify(em));
ok("Copy link to: the Copy link client, and the one who turned emails off", JSON.stringify(li.sort()) === '["Client L","Client O"]', JSON.stringify(li));
ok("First time: both new clients, whatever their route", JSON.stringify(fi.sort()) === '["Client F","Client G"]', JSON.stringify(fi));
ok("section titles are Josiah's", norm(await owner.textContent("[data-testid=sec-email] h3")) === "Emailed to" && norm(await owner.textContent("[data-testid=sec-link] h3")) === "Copy link to" && norm(await owner.textContent("[data-testid=sec-first] h3")) === "First time client - Personal link required");
const row = (n) => sentRow(owner, n);
ok("Client A: Emailed, with Send again and Stop sharing, no Copy link", /Emailed/.test(norm(await row("Client A").textContent())) && (await row("Client A").locator("button:has-text('Send again')").count()) === 1 && (await row("Client A").locator("[data-testid=stop-sharing]").count()) === 1 && (await row("Client A").locator("text=Copy link").count()) === 0);
ok("Client A really was emailed (kept on the video)", !!(await prisma.video.findFirst({ where: { OR: [{ id }, { sourceId: id }], clientId: (await byName("Client A")).id } })).emailedAt);
ok("Copy link to: Josiah's line under the title", norm(await owner.textContent("[data-testid=sec-link-intro]")) === "Each link only works for its respective client, so send them one at a time. A client needs their personal link saved on their device to watch.");
ok("Client L: Copy link and Stop sharing only, nothing sent yet", (await row("Client L").locator("[data-testid=copy-row-link]").count()) === 1 && (await row("Client L").locator("[data-testid=email-row]").count()) === 0 && !/Link copied/.test(norm(await row("Client L").textContent())));
ok("Client O: marked Emails turned off by client", norm(await row("Client O").locator("[data-testid=emails-off]").textContent()) === "Emails turned off by client");
ok("nobody on Copy link was emailed", !(await prisma.video.findFirst({ where: { OR: [{ id }, { sourceId: id }], clientId: (await byName("Client L")).id } })).emailedAt);
ok("Client F (Email): only Send from your email", (await row("Client F").locator("[data-testid=first-link-email]").count()) === 1 && (await row("Client F").locator("[data-testid=first-link-copy]").count()) === 0);
ok("Client G (Copy link): only Copy link", (await row("Client G").locator("[data-testid=first-link-copy]").count()) === 1 && (await row("Client G").locator("[data-testid=first-link-email]").count()) === 0);
ok("First time: says why, that the video still goes, and the folded why", /still goes to each of them, along with their own personal link/.test(norm(await owner.textContent("[data-testid=sec-first-intro]"))) && (await owner.locator("[data-testid=sec-first-why] summary:has-text(\"Why can't SureFrame send these?\")").count()) === 1);
await owner.screenshot({ path: `${shots}/send-route-sections.png`, fullPage: true });

for (const width of [390, 320]) {
  await owner.setViewportSize({ width, height: 844 });
  await owner.waitForTimeout(200);
  ok(`${width}px: the sections fit the screen`, await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await owner.screenshot({ path: `${shots}/send-route-sections-${width}.png`, fullPage: true });
}
await owner.setViewportSize({ width: 1280, height: 900 });

await row("Client L").locator("[data-testid=copy-row-link]").click();
await row("Client L").locator("[data-testid=row-state]:has-text('Link copied')").waitFor();
const copiedL = await owner.evaluate(() => navigator.clipboard.readText());
ok("Client L: their own link copied, with their key", copiedL.includes("v=") && copiedL.includes("#k="), copiedL);
ok("Client L: Link copied beside their name, with no second line", (await row("Client L").locator("[data-testid=row-note]").count()) === 0);
await row("Client G").locator("[data-testid=first-link-copy]").click();
await row("Client G").locator("[data-testid=row-state]:has-text('Link copied')").waitFor();
ok("Client G: Link copied beside their name, no line on where to paste it", (await row("Client G").locator("[data-testid=row-note]").count()) === 0);
await row("Client F").locator("[data-testid=first-link-email]").click();
await row("Client F").locator("[data-testid=copy-instead]").waitFor();
ok("Client F: email app line, with Copy the link instead if nothing opens", /Your email app should open with Client F's video and personal link/.test(norm(await row("Client F").locator("[data-testid=row-note]").textContent())));
ok("Client F wasn't emailed a link they can't open", !(await byName("Client F")).linkOpenedAt && !(await prisma.video.findFirst({ where: { OR: [{ id }, { sourceId: id }], clientId: (await byName("Client F")).id } })).emailedAt);
await owner.screenshot({ path: `${shots}/send-route-done.png`, fullPage: true });

// After a reload the sections are the same, and Client A still reads Emailed.
await owner.goto(videoUrl);
await owner.waitForSelector("[data-testid=sec-email]", { timeout: 20000 });
ok("after a reload: Client A still says Emailed", /Emailed/.test(norm(await row("Client A").textContent())) && (await row("Client A").locator("button:has-text('Send again')").count()) === 1);

// Changing a client's route on their page.
await owner.goto(`${BASE}/clients/${(await byName("Client A")).id}`);
ok("client page: says how they receive videos", norm(await owner.textContent("[data-testid=client-route]")).startsWith(`Receives videos by email: sg-a-${stamp}@example.com`));
await owner.click("[data-testid=route-change]");
await owner.check("[data-testid=route-edit] [data-testid=route-link]");
ok("switching to Copy link says the email goes", /is removed, so we won't email Client A anything, reminders included/.test(norm(await owner.textContent("[data-testid=route-edit]"))));
await owner.click("[data-testid=route-edit] button:has-text('Save')");
await owner.waitForSelector("[data-testid=route-saved]");
ok("client page: a line confirms the change", norm(await owner.textContent("[data-testid=route-saved]")) === "Client A will receive their videos by copy link, sent however you choose. You can change this in Clients at any time.");
ok("Client A now has no email saved", !(await byName("Client A")).email);
await owner.screenshot({ path: `${shots}/send-route-client-page.png`, fullPage: true });
await owner.goto(videoUrl);
await owner.waitForSelector("[data-testid=sec-link]", { timeout: 20000 });
ok("back on the video: Client A is under Copy link to", (await owner.locator("[data-testid=sec-link] [data-testid=sent-row]").filter({ has: owner.locator('[data-testid=row-name]:text-is("Client A")') }).count()) === 1);

// A send that only partly works: whoever did get it shows as sent, and isn't left ticked to be sent again.
const first = await prisma.video.findUnique({ where: { id } });
const partId = `${id.slice(0, 10)}p${stamp.toString(36)}`;
await prisma.video.create({
  data: { id: partId, title: "Partly sent", status: "UPLOADED", mimeType: first.mimeType, storageKey: first.storageKey, encrypted: true, teamKeyWrap: first.teamKeyWrap, ownerId: first.ownerId, workspaceId: ws, durationMs: first.durationMs },
});
await owner.route("**/api/videos/*/send", (r) => r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Couldn't send it to the others." }) }));
await owner.goto(`${BASE}/v/${partId}`);
await chooseClients(owner, "Client L", "Client G");
await owner.click("[data-testid=send]");
await owner.waitForSelector("[data-testid=send-status]:has-text(\"Couldn't send it to the others.\")", { timeout: 15000 });
const gotIt = (await prisma.video.findUnique({ where: { id: partId } })).clientId;
const gotName = gotIt && (await prisma.client.findUnique({ where: { id: gotIt } })).name;
ok("partly sent: the one who got it is listed as sent", !!gotName && (await sentRow(owner, gotName).count()) === 1, gotName);
await owner.click("[data-testid=client-picker]");
const stillTicked = await owner.$$eval("[role=listbox] input:checked", (els) => els.map((e) => e.closest("label")?.textContent?.trim()));
ok("partly sent: only the one it didn't reach is still ticked", stillTicked.length === 1 && !stillTicked[0].includes(gotName), JSON.stringify(stillTicked));
await owner.keyboard.press("Escape");
await owner.unroute("**/api/videos/*/send");

// The Clients page's add form asks the same question.
await owner.goto(`${BASE}/clients`);
await owner.fill('input[aria-label="Client name"]', "Client Z");
ok("Clients page: Add client waits for how they'll receive videos", await owner.isDisabled("button:has-text('Add client')"));
await owner.check("[data-testid=route-email]");
await owner.screenshot({ path: `${shots}/send-route-clients-add.png` });
await owner.setViewportSize({ width: 320, height: 844 });
await owner.waitForTimeout(200);
ok("320px: the add form fits", await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await owner.screenshot({ path: `${shots}/send-route-clients-add-320.png` });

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
