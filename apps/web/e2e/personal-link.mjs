// A new client's first video does it all (components/FirstLinkSender.tsx, SendPanel.tsx):
// - a business that records before adding anyone adds the client right in the Send box, and is
//   shown the three steps and the ways to send that first video itself (Email from my email first,
//   Copy link, Copy link + message); there's no separate personal-link step to do first;
// - the Clients page marks the client "Not opened yet" (no warning banner) until they open it;
// - everything fits a 320px phone.
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
const norm = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const shots = process.argv[2] ?? "/tmp";
const waitFor = async (fn, ms = 15000) => {
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
const email = `pl-owner${stamp}@example.com`;
const ctx = await browser.newContext(perms);
const owner = await ctx.newPage();
const clip = () => owner.evaluate(() => navigator.clipboard.readText());

await owner.goto(`${BASE}/login`);
await agreed(email);
await owner.fill('input[name="email"]', email);
await owner.click("text=Continue");
await owner.waitForURL((u) => u.pathname === "/library");
const ws = (await prisma.membership.findFirst({ where: { user: { email } } })).workspaceId;
const business = `Business P ${stamp}`;
await prisma.workspace.update({ where: { id: ws }, data: { name: business } });
await owner.reload();
ok("library start: the first video goes from you, said up front", norm(await owner.textContent("[data-testid=first-steps]")).includes("Send their first video yourself") && !norm(await owner.textContent("[data-testid=first-steps]")).includes("personal link, once"));

// Record first, with no clients.
await owner.goto(BASE + "/record");
ok("record page: says a new client's first video goes from you", norm(await owner.textContent("[data-testid=no-clients-note]")).includes("A new client's first video goes from your own email or texts"));
await owner.click("text=Camera only");
await owner.click("text=Start recording");
await owner.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await owner.waitForTimeout(2000);
await owner.click("button:has-text('Stop')");
await owner.waitForURL("**/v/**", { timeout: 30000 });
const vid = owner.url().split("/v/")[1].split("?")[0];
await owner.waitForSelector("[data-testid=send-no-clients]", { timeout: 20000 });
await owner.waitForSelector("text=I've saved it", { timeout: 3000 }).then((b) => b.click()).catch(() => {});
ok("no clients: add one right here, nothing else in the way", (await owner.isVisible("[data-testid=quick-add]")) && (await owner.locator("[data-testid=send-no-clients] [data-testid=personal-link-steps]").count()) === 0);
await owner.fill("[data-testid=quick-add] input[aria-label='Client name']", "Client Q");
await owner.fill("[data-testid=quick-add] input[aria-label='Client email']", `client-q-${stamp}@example.com`);
await owner.click("[data-testid=quick-add] button:has-text('Add client')");
await owner.waitForSelector("[data-testid=first-links]", { timeout: 15000 });
const box = norm(await owner.textContent("[data-testid=first-links]"));
ok("added and chosen: this is Client Q's first video, sent from your own email or texts", norm(await owner.textContent("[data-testid=first-time]")).includes("First video for Client Q: send it from your email or copy the link") && !norm(await owner.textContent("[data-testid=send-panel]")).includes("can't be connected") && (await owner.textContent("[data-testid=client-picker]")).includes("Client Q"));
ok("every way to send it is offered, their own email first", ["Copy link", "Copy link + message", "Email from my email"].every((t) => box.includes(t)) && (await owner.locator("[data-testid=first-links] [data-testid=first-link-sender] button").first().getAttribute("data-testid")) === "first-link-email", box);
const q = await prisma.client.findFirst({ where: { workspaceId: ws, name: "Client Q" } });
ok("Client Q has their own key", !!q?.teamKeyWrap);
await owner.screenshot({ path: `${shots}/personal-link-send.png`, fullPage: true });

// Email from my email: the business's own email app, filled in (caught before it leaves the page).
await owner.evaluate(() => {
  window.__mailto = null;
  document.addEventListener("click", (e) => {
    const href = e.target?.href;
    if (typeof href === "string" && href.startsWith("mailto:")) {
      window.__mailto = href;
      e.preventDefault();
    }
  }, true);
});
await owner.click("[data-testid=first-links] [data-testid=first-link-email]");
const mailto = await waitFor(() => owner.evaluate(() => window.__mailto));
const body = mailto ? decodeURIComponent(mailto.split("body=")[1] ?? "") : "";
ok("mailto: to Client Q, subject names the business, body has their video link with key", !!mailto && mailto.startsWith(`mailto:client-q-${stamp}%40example.com?subject=`) && decodeURIComponent(mailto).includes(`A video for you from ${business}`) && body.includes(`v=${vid}`) && body.includes("#k=") && body.includes("I've recorded a video for you") && body.trim().endsWith(business), mailto ?? "none");
ok("sending it gave Client Q this video", (await prisma.video.findUnique({ where: { id: vid } })).clientId === q.id);
const qRow = "[data-testid=sent-row]:has-text('Client Q')";
await owner.waitForSelector(`${qRow} [data-testid=first-link-copy]`);
ok("Client Q is under Sent to, with the same buttons to send it again", norm(await owner.textContent("[data-testid=sent-list]")).includes("Client Q") && (await owner.locator("[data-testid=waiting-list]").count()) === 0);
ok("their row: Not opened yet, no extra note", norm(await owner.textContent(qRow)).includes("Not opened yet") && (await owner.locator(`${qRow} [data-testid=row-first]`).count()) === 0);
ok("status says the email app should open", norm(await owner.textContent("[data-testid=send-status]")).includes("Your email app should open"));
ok("marked as sent", !!(await waitFor(async () => (await prisma.client.findUnique({ where: { id: q.id } })).linkSentAt)));
await owner.click(`${qRow} [data-testid=first-link-copy]`);
await owner.waitForTimeout(300);
const link = await clip();
ok("Copy link: their video link with key", link.includes(`v=${vid}`) && link.includes("#k="), link);

// Clients page: no warning banner, just a quiet mark until they open it.
await owner.goto(BASE + "/clients");
await owner.waitForSelector("[data-testid=clients-search]");
ok("Clients page: no warning banner", (await owner.locator("[data-testid=waiting-banner]").count()) === 0);
ok("Client Q: Not opened yet", (await owner.textContent("li:has-text('Client Q') [data-testid=needs-first-link]")) === "Not opened yet");
ok("Client Q's row: just Copy personal link, like everyone's", (await owner.locator("li:has-text('Client Q') [data-testid=first-link-sender]").count()) === 0 && (await owner.locator("li:has-text('Client Q') button:has-text('Copy personal link')").count()) === 1);

// 320px: the Send box, the Clients page and the client's page fit.
await owner.setViewportSize({ width: 320, height: 700 });
const fits = async () => owner.evaluate(() => document.documentElement.scrollWidth <= 320);
ok("320px: Clients page fits", await fits());
await owner.screenshot({ path: `${shots}/personal-link-clients-320.png`, fullPage: true });
await owner.goto(`${BASE}/clients/${q.id}`);
await owner.waitForSelector("[data-testid=needs-first-card]");
ok("320px: client page card fits", await fits());
await owner.screenshot({ path: `${shots}/personal-link-client-320.png`, fullPage: true });
await owner.goto(`${BASE}/v/${vid}`);
await owner.waitForSelector(qRow, { timeout: 20000 });
ok("320px: Send box fits", await fits());
await owner.screenshot({ path: `${shots}/personal-link-send-320.png`, fullPage: true });
await owner.setViewportSize({ width: 1280, height: 800 });

// Client Q opens it: the banner goes.
const qPage = await (await browser.newContext(perms)).newPage();
await qPage.addLocatorHandler(qPage.getByTestId("sureframe-promo"), async () => qPage.click("text=/^Watch now$/", { timeout: 15000 }));
await qPage.goto(link);
await qPage.waitForSelector("main video", { timeout: 30000 });
ok("opening it is recorded", !!(await waitFor(async () => (await prisma.client.findUnique({ where: { id: q.id } })).linkOpenedAt)));

// Client Q's "All my videos": laid out like the library, with stills, Tiles or List, and the way back.
await qPage.click("[data-testid=all-videos-link]");
await qPage.waitForURL("**/inbox?from=**");
await qPage.waitForSelector("[data-testid=client-videos]");
ok("client page: folders like the library, newest open, with the video's still", (await qPage.locator("[data-testid=day-folder]").count()) >= 1 && !!(await qPage.waitForSelector(`a[href="/v/${vid}"] [data-testid=client-thumb]`, { timeout: 15000 }).catch(() => null)));
ok("client page: Tiles and List", (await qPage.locator("[data-testid=layout-tiles]").count()) === 1 && (await qPage.locator("[data-testid=layout-list]").count()) === 1);
await qPage.screenshot({ path: `${shots}/personal-link-inbox-tiles.png`, fullPage: true });
await qPage.click("[data-testid=layout-list]");
await qPage.waitForSelector("[data-testid=video-list]");
ok("List: one line per video, remembered", (await qPage.locator(`[data-testid=video-list] a[href="/v/${vid}"]`).count()) === 1 && (await qPage.context().cookies()).some((c) => c.name === "sf_inbox_layout" && c.value === "list"));
await qPage.screenshot({ path: `${shots}/personal-link-inbox-list.png`, fullPage: true });
ok("Back to video, from All my videos", await qPage.isVisible("[data-testid=back-to-video]"));
await qPage.click("[data-testid=back-to-video]");
await qPage.waitForURL(`**/v/${vid}`);
ok("it goes back to the video", qPage.url().endsWith(`/v/${vid}`));
await qPage.setViewportSize({ width: 320, height: 700 });
await qPage.goto(`${BASE}/inbox?from=${vid}`);
await qPage.waitForSelector("[data-testid=client-videos]");
ok("320px: client's videos page fits, Back to video and Help in the bar", await qPage.evaluate(() => document.documentElement.scrollWidth <= 320) && (await qPage.isVisible("[data-testid=back-to-video]")));
await qPage.screenshot({ path: `${shots}/personal-link-inbox-320.png`, fullPage: true });
await qPage.goto(`${BASE}/inbox?from=notmine12345`);
ok("no way back offered to a video that isn't theirs", (await qPage.locator("[data-testid=back-to-video]").count()) === 0);
await owner.goto(BASE + "/clients");
await owner.waitForSelector("[data-testid=clients-search]");
ok("mark gone once they've opened it", (await owner.locator("li:has-text('Client Q') [data-testid=needs-first-link]").count()) === 0);

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
