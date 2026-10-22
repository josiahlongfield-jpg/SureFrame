// A chosen client with no email address (components/SendPanel.tsx): the Send box says so beside
// Copy link, and offers Add email right there, which saves it and brings back Send by email.
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
const email = `ne-owner${stamp}@example.com`;
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
await owner.waitForSelector("[data-testid=send-no-clients]", { timeout: 20000 });
await owner.waitForSelector("text=I've saved it", { timeout: 3000 }).then((b) => b.click()).catch(() => {});

// A new client with no email: said under the first-video buttons, with Add email.
await owner.fill("[data-testid=quick-add] input[aria-label='Client name']", "Client N");
await owner.click("[data-testid=quick-add] button:has-text('Add client')");
await owner.waitForSelector("[data-testid=first-links]", { timeout: 15000 });
const firstNote = norm(await owner.textContent("[data-testid=first-time] [data-testid=no-email]"));
ok("new client: no email address saved, with Add email", firstNote.includes("No email address saved for Client N") && firstNote.includes("Add email"), firstNote);
await owner.screenshot({ path: `${shots}/no-email-first.png`, fullPage: true });

// Why the first video comes from you: one line, with the longer why folded under the expander (O32, S13).
ok("first video: says why in one line", norm(await owner.textContent("[data-testid=first-why-line]")).includes("First video for Client N: send it yourself") && (await owner.locator("[data-testid=first-why-hide]").count()) === 0);
ok("the longer why is behind Why does the first video come from me?", await owner.isVisible("[data-testid=first-why-more]"));

// Once they've opened a video, only Copy link is left for them: the note sits above it.
const n = await prisma.client.findFirst({ where: { workspaceId: ws, name: "Client N" } });
await prisma.client.update({ where: { id: n.id }, data: { linkOpenedAt: new Date() } });
await owner.reload();
await chooseClients(owner, "Client N");
await owner.waitForSelector("[data-testid=no-email]", { timeout: 10000 });
const note = norm(await owner.textContent("[data-testid=no-email]"));
ok("only Copy link: says no email address is saved", note.includes("No email address saved for Client N, so copy the link and send it yourself"), note);
ok("Send by email isn't offered, Copy link is", !(await owner.isVisible("[data-testid=send-email]")) && (await owner.isVisible("[data-testid=send-link]")));
await owner.screenshot({ path: `${shots}/no-email-copy.png`, fullPage: true });
await owner.setViewportSize({ width: 320, height: 800 });
await owner.click("[data-testid=no-email] [data-testid=add-email]");
await owner.screenshot({ path: `${shots}/no-email-add-320.png`, fullPage: true });
const fits = await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
ok("320px: the Add email form fits", fits);
await owner.setViewportSize({ width: 1280, height: 900 });

// Add email: saved, and Send by email is back.
await owner.fill("[data-testid=add-email-form] input", "not an email");
await owner.click("[data-testid=add-email-form] button:has-text('Save')");
await owner.waitForTimeout(500);
ok("a bad address isn't saved", !(await prisma.client.findUnique({ where: { id: n.id } })).email);
await owner.fill("[data-testid=add-email-form] input", `client-n-${stamp}@example.com`);
await owner.click("[data-testid=add-email-form] button:has-text('Save')");
await owner.waitForSelector("[data-testid=send-email]:not([disabled])", { timeout: 10000 });
ok("email saved for the client", (await prisma.client.findUnique({ where: { id: n.id } })).email === `client-n-${stamp}@example.com`);
ok("note gone, Send by email back", (await owner.locator("[data-testid=no-email]").count()) === 0 && norm(await owner.textContent("[data-testid=send-panel]")).includes("Saved Client N's email"));
await owner.screenshot({ path: `${shots}/no-email-saved.png`, fullPage: true });

// Another new client later: the same one line and the buttons (nothing to hide any more).
await owner.click("[data-testid=quick-add-open]");
await owner.fill("[data-testid=quick-add] input[aria-label='Client name']", "Client M");
await owner.click("[data-testid=quick-add] button:has-text('Add client')");
await owner.waitForSelector("[data-testid=first-links]", { timeout: 15000 });
ok("next new client: the one line and the buttons", norm(await owner.textContent("[data-testid=first-why-line]")).includes("First video for Client M") && (await owner.isVisible("[data-testid=first-link-copy]")));

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
