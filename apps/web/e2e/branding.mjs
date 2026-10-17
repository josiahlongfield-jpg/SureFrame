// Custom branding on paid plans. Run against a server using the fake Stripe
// (same env as billing.mjs).
import { chromium } from "@playwright/test";
import { deflateSync } from "node:zlib";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { start, state, createSubscription } from "./fake-stripe.mjs";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
const server = await start();
const sig = new Stripe("sk_test_fake");

// A solid-colour PNG as the "logo"; `pad` adds an ignored text chunk to make the file bigger.
function png(w, h, [r, g, b], pad = 0) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, b][i % 3])]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), ...(pad ? [chunk("tEXt", Buffer.concat([Buffer.from("Comment\0"), Buffer.alloc(pad, 97)]))] : []), chunk("IDAT", deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage();
await page.goto(BASE + "/login?next=/settings/branding");
const loginEmail = `brand${Date.now()}@example.com`;
await agreed(loginEmail);
await page.fill('input[name="email"]', loginEmail);
await page.click("text=Continue");
await page.waitForURL((u) => u.pathname === "/settings/branding");
// The page streams in after the URL changes (app/loading.tsx), so wait for it rather than checking at once.
const visible = (p, sel, timeout = 5000) => p.locator(sel).first().waitFor({ timeout }).then(() => true, () => false);
ok("Free plan sees an upgrade prompt", await visible(page, "text=Custom branding is part of every paid plan"));
ok("Free plan is told clients see standard SureFrame pages", await visible(page, "text=/on the Free plan, so your clients see standard SureFrame pages/"));
const denied = await page.request.post(BASE + "/api/workspace/branding", { multipart: { color: "#0f766e" } });
ok("Free plan can't save branding", denied.status() === 402);

// Upgrade to Solo through the fake Stripe.
const { url } = await (await page.request.post(BASE + "/api/billing/checkout", { data: { plan: "SOLO" } })).json();
const session = state.sessions.at(-1).params;
const sub = createSubscription(session.customer, session.subscription_data.metadata.workspaceId, "sureframe_solo_monthly");
const payload = JSON.stringify({ id: "evt_b", object: "event", type: "customer.subscription.created", data: { object: sub } });
await page.request.post(BASE + "/api/webhooks/stripe", { headers: { "stripe-signature": sig.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" }), "content-type": "application/json" }, data: payload });
ok("upgraded", !!url);

await page.goto(BASE + "/settings/branding");
const shots = process.argv[2] ?? "/tmp";
const preview = page.frameLocator("[data-testid=brand-preview]");
await page.waitForSelector("[data-testid=brand-preview][data-ready]", { timeout: 20000 });
ok("preview shows the client video page", await visible(preview, "text=Conversation") && await visible(preview, "text=Made with SureFrame"));
await page.fill('input[aria-label="Colour code"]', "#f1f5f9");
ok("too-light colour explained", await page.isVisible("text=too light for white button text"));
ok("and can't be saved", await page.isDisabled("text=Save branding"));
await page.click('button[aria-label="Use #0f766e"]');
await page.setInputFiles('input[type="file"]', { name: "logo.png", mimeType: "image/png", buffer: png(40, 20, [15, 118, 110]) });
// Before saving, the preview already wears the new logo and colour.
await page.waitForSelector("[data-testid=logo-thumb]");
const previewLogo = preview.locator("header img");
await previewLogo.waitFor({ timeout: 5000 }).catch(() => {});
ok("preview shows the picked logo before saving", /^data:image\/png/.test((await previewLogo.getAttribute("src").catch(() => "")) ?? ""));
ok("preview uses the picked colour", /--color-brand-600:\s*#0f766e/.test((await preview.locator("[data-testid=preview-video]").getAttribute("style")) ?? ""));
ok("preview keeps the SureFrame credit", await preview.locator("text=Made with SureFrame").isVisible());
ok("unsaved changes flagged", await page.isVisible("[data-testid=unsaved]"));
ok("byline reads '{name} from {business}'", await visible(preview, "text=/from .*workspace/"));
await page.screenshot({ path: `${shots}/brand-desktop.png`, fullPage: true });
await page.click('[aria-label="Screen size"] >> text=Phone');
await page.waitForTimeout(300);
ok("phone preview is phone width", (await page.locator("[data-testid=brand-preview]").evaluate((f) => f.clientWidth)) === 390);
ok("phone preview still shows the logo", !!(await previewLogo.getAttribute("src")));
await page.screenshot({ path: `${shots}/brand-phone.png`, fullPage: true });
await page.click('[aria-label="Page"] >> text=Inbox');
ok("inbox preview", await visible(preview, "[data-testid=preview-inbox] >> text=Your videos") && /^data:/.test((await previewLogo.getAttribute("src")) ?? ""));
await page.screenshot({ path: `${shots}/brand-phone-inbox.png`, fullPage: true });
await page.click('[aria-label="Page"] >> text=Email');
ok("email preview: '{business} sent you a video: {title}'", await visible(preview, "[data-testid=email-subject] >> text=/sent you a video: Your weekly check-in$/"));
ok("email preview carries the logo", /^data:image/.test((await preview.frameLocator('iframe[title="Email body"]').locator("img").getAttribute("src")) ?? ""));
await page.click('[aria-label="Screen size"] >> text=Desktop');
await page.screenshot({ path: `${shots}/brand-desktop-email.png`, fullPage: true });
await page.click('[aria-label="Page"] >> text=Video page');
await page.click("text=Open full preview");
await page.waitForSelector("[data-testid=full-preview-frame][data-ready]", { timeout: 20000 });
const fullFrame = page.frameLocator("[data-testid=full-preview-frame]");
ok("full preview shows the same page", /^data:/.test((await fullFrame.locator("header img").getAttribute("src")) ?? "") && await visible(fullFrame, "text=Made with SureFrame"));
await page.screenshot({ path: `${shots}/brand-full.png` });
await page.keyboard.press("Escape");
ok("full preview closes", !(await page.isVisible("[data-testid=full-preview]")));

// Big logos are resized in the browser instead of refused.
await page.setInputFiles('input[type="file"]', { name: "huge.png", mimeType: "image/png", buffer: png(3000, 1200, [15, 118, 110], 500 * 1024) });
ok("oversized logo picked is resized, not refused", await visible(page, "text=Resized to fit") && !(await page.isVisible("text=too big")));
const beforeSvg = await page.getAttribute("[data-testid=logo-thumb]", "src");
await page.setInputFiles('input[type="file"]', { name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="#0f766e"/></svg>') });
await page.waitForFunction((b) => document.querySelector("[data-testid=logo-thumb]")?.getAttribute("src") !== b, beforeSvg, { timeout: 5000 }).catch(() => {});
const svgThumb = await page.getAttribute("[data-testid=logo-thumb]", "src");
ok("SVG logo picked is converted to PNG", svgThumb !== beforeSvg && svgThumb?.startsWith("data:image/png"));
await page.setInputFiles('input[type="file"]', { name: "logo.png", mimeType: "image/png", buffer: png(40, 20, [15, 118, 110]) });

await page.click("text=Save branding");
await page.waitForSelector("text=Saved. Your clients see this now.");
ok("branding saved", true);
let savedSrc = "";
for (let i = 0; i < 30 && !/^\/api\/brand\//.test(savedSrc); i++) {
  savedSrc = (await previewLogo.getAttribute("src")) ?? "";
  if (!/^\/api\/brand\//.test(savedSrc)) await page.waitForTimeout(100);
}
ok("after saving, the preview shows the saved logo", /^\/api\/brand\//.test(savedSrc), savedSrc.slice(0, 40));
const big = await page.request.post(BASE + "/api/workspace/branding", { multipart: { logo: { name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(400 * 1024) } } });
ok("oversized logo refused", big.status() === 413);
const svg = await page.request.post(BASE + "/api/workspace/branding", { multipart: { logo: { name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") } } });
ok("SVG refused (can carry scripts)", svg.status() === 400);

// A client's view wears the branding.
const res = await page.request.post(BASE + "/api/clients", { data: { name: "Riley", teamKeyWrap: "x".repeat(44) } });
const { client } = await res.json();
const cpage = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await cpage.goto(client.link);
await cpage.waitForURL("**/inbox**");
const style = await cpage.getAttribute("div.min-h-screen", "style");
ok("client page uses the brand colour", /--color-brand-600:\s*#0f766e/.test(style ?? ""), style);
const logoSrc = await cpage.getAttribute("header img", "src");
ok("client page shows the logo", !!logoSrc);
const logo = await cpage.request.get(BASE + logoSrc);
ok("logo served as an image, cached", logo.headers()["content-type"] === "image/png" && /immutable/.test(logo.headers()["cache-control"] ?? ""));
ok("business name shown", /workspace/.test(await cpage.textContent("header")));
ok("inbox keeps the Made with SureFrame credit", await cpage.isVisible("text=Made with SureFrame"));
await cpage.screenshot({ path: `${process.argv[2] ?? "/tmp"}/branded-inbox.png` });

// A video sent to the client. Paid plans show it straight away.
const workspaceId = session.subscription_data.metadata.workspaceId;
const owner = await prisma.membership.findFirst({ where: { workspaceId } });
const videoId = `promo${Date.now()}`;
await prisma.video.create({ data: { id: videoId, title: "Check-in", status: "READY", mimeType: "video/webm", storageKey: `test/${videoId}`, ownerId: owner.userId, workspaceId, clientId: client.id } });
await cpage.goto(`${BASE}/v/${videoId}`);
ok("paid plan: no SureFrame intro before the video", !(await visible(cpage, "[data-testid=sureframe-promo]", 1500)));
ok("client video page shows the saved logo", (await cpage.getAttribute("header img", "src")) === logoSrc);
ok("client video page keeps the Made with SureFrame credit", await cpage.isVisible("text=Made with SureFrame"));

// Downgrading hides it again without losing it.
sub.status = "canceled";
const p2 = JSON.stringify({ id: "evt_c", object: "event", type: "customer.subscription.deleted", data: { object: sub } });
await page.request.post(BASE + "/api/webhooks/stripe", { headers: { "stripe-signature": sig.webhooks.generateTestHeaderString({ payload: p2, secret: "whsec_test" }), "content-type": "application/json" }, data: p2 });
await cpage.goto(`${BASE}/v/${videoId}`);
// This test video has no key for the client, so it can't open on this device: the Free plan's intro never
// covers a page that can't open (the intro itself is checked with a real video in fx-client.mjs).
ok("Free plan: page that can't open says why", !!(await cpage.waitForSelector("[data-testid=lost-key]", { timeout: 15000 }).catch(() => null)));
ok("Free plan: no intro over a page that can't open", !(await visible(cpage, "[data-testid=sureframe-promo]", 2000)));
ok("can't-open page offers to ask for the link again", await cpage.isVisible("text=Ask for my link again"));
await cpage.screenshot({ path: `${process.argv[2] ?? "/tmp"}/cant-open-free.png` });
await cpage.goto(BASE + "/inbox");
ok("on Free, clients see plain SureFrame again", !(await cpage.getAttribute("div.min-h-screen", "style"))?.includes("#0f766e") && !(await cpage.isVisible("header img")));

await browser.close();
server.close();
await prisma.$disconnect();
