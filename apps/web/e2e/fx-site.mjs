// The public site, pricing, billing dialogs and the recorder after the October 2026 testers' findings:
// - plan cards say how long videos are kept, and the Free plan's limits are listed in full;
// - pricing knows who's looking: the current plan is marked, the header doesn't say "Start free" to someone signed in,
//   a plan's button never offers the plan you're on, and choosing a paid plan signed out goes through sign-in to checkout;
// - moving to a bigger plan takes off extra client seats it now includes, and shows that before you pay;
// - plan-change errors, add-ons and seats use in-page dialogs, never the browser's confirm();
// - Cancel plan and Keep my plan on Settings > Billing;
// - FAQ and About pages, the help page's FAQ and email, the 404 page, and legal pages' contents;
// - the home demo's tabs all show, and phones keep the feature lines;
// - the recorder: one-option quality is a note, Discard asks first and gives the free video back, phones start on Camera only;
// - round 2 (18 October): Yearly prices extras by the year, Free has no period and its intro isn't ticked, the total with backup,
//   "Good to know" (billing, cancelling, smaller plans, codes), what the AI add-on does with long videos; "Start free" opens
//   sign-up on every screen; plain 404s with a real status (a missing video gets its own quiet page); /settings and /legal;
//   one version line on the legal pages; Help links into the FAQ rather than repeating it; plain data-location wording.
// Start the app with the fake Stripe settings in e2e/billing.mjs.
import { chromium } from "@playwright/test";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { start, state, createSubscription } from "./fake-stripe.mjs";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const prisma = new PrismaClient();
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${String(detail).slice(0, 400)}`}`);
  if (!pass) failed++;
};
const waitFor = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 250) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return fn();
};
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();

await prisma.rateLimit.deleteMany({ where: { OR: [{ key: { startsWith: "signin" } }, { key: { startsWith: "billing" } }] } });
const server = await start();
const sig = new Stripe("sk_test_fake");
const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args });
const stamp = Date.now();

// The browser's own confirm()/alert() boxes are never used on these pages.
const nativeDialogs = [];
const watch = (page) => page.on("dialog", (d) => { nativeDialogs.push(d.message()); d.dismiss().catch(() => {}); });
/** Visible once the page has finished streaming in (app/loading.tsx shows first). */
const seen = (page, sel, timeout = 10000) => page.waitForSelector(sel, { state: "visible", timeout }).then(() => true, () => false);
// Measured once the streamed page has replaced the loading spinner (app/loading.tsx).
const fits = async (page) => {
  await page.waitForSelector("[role=status][aria-label=Loading]", { state: "detached", timeout: 15000 }).catch(() => {});
  await page.waitForSelector("footer, main h1, main", { state: "visible", timeout: 15000 }).catch(() => {});
  return page.evaluate(() => document.documentElement.scrollWidth);
};

async function signIn(page, email, next) {
  await agreed(email);
  await page.goto(`${BASE}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
}
async function webhook(page, type, sub) {
  const payload = JSON.stringify({ id: `evt_${Date.now()}${Math.random()}`, object: "event", type, data: { object: sub } });
  const header = sig.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
  return page.request.post(BASE + "/api/webhooks/stripe", { headers: { "stripe-signature": header, "content-type": "application/json" }, data: payload });
}

// ---------- 1. Signed out: pricing, home, FAQ, About, help, 404, legal ----------
const visitor = await browser.newPage({ viewport: { width: 1280, height: 900 } });
watch(visitor);
await visitor.goto(BASE + "/pricing");
await seen(visitor, "[data-testid=free-in-full]");
const cards = await visitor.$$eval("[data-testid=video-storage]", (els) => els.map((e) => e.textContent));
ok("every plan card has a Video storage line", cards.length === 4 && cards.every((t) => t.startsWith("Video storage") && t.includes("30 days")), JSON.stringify(cards));
ok("Free's says cloud backup isn't on Free; paid ones say unless Cloud backup is on", cards[0].includes("isn't available on Free") && cards.slice(1).every((t) => t.includes("unless Cloud backup is on")));
const fullFree = norm(await visitor.textContent("[data-testid=free-in-full]"));
for (const bit of ["3 clients", "25 videos in total", "5 minutes per video", "720p", "SureFrame intro", "30 days after they're recorded", "12 months"]) {
  ok(`Free plan in full lists: ${bit}`, fullFree.includes(bit), fullFree);
}
const prices = await visitor.$$eval("[data-testid^=plan-] p.mt-4", (els) => els.map((e) => e.textContent.replace(/\s+/g, "")));
ok("every price is in US$, Free included", prices.length === 4 && prices.every((p) => p.startsWith("US$")), JSON.stringify(prices));
ok("signed out, the header says Start free, and it opens sign-up", (await visitor.textContent("header")).includes("Start free") && (await visitor.getAttribute("header a:has-text('Start free')", "href")) === "/signup");
ok("Free's card: Start free opens sign-up", (await visitor.getAttribute("[data-testid=plan-FREE] a:has-text('Start free')", "href")) === "/signup");
const freeCard = norm(await visitor.textContent("[data-testid=plan-FREE]"));
ok("Free's intro is a note, not a ticked feature", norm(await visitor.textContent("[data-testid=plan-FREE] [data-testid=plan-notes]")).includes("SureFrame intro") && !(await visitor.$$eval("[data-testid=plan-FREE] li:has(svg)", (els) => els.some((e) => e.textContent.includes("intro")))));
ok("paid cards: the total with cloud backup", norm(await visitor.textContent("[data-testid=plan-SOLO] [data-testid=with-backup]")) === "With cloud backup: US$20 a month");
const good = norm(await visitor.textContent("[data-testid=good-to-know]"));
for (const bit of ["billed with your plan", "Australian Consumer Law", "first remove the clients and staff", "paused", "referral code", "founding prices", "section 5"]) {
  ok(`pricing, Good to know: ${bit}`, good.includes(bit), good);
}
ok("AI add-on says what happens to longer videos", norm(await visitor.textContent("[data-testid=addon-ai]")).includes("longer videos don't get a transcript or summary"));
await visitor.click("[role=radio]:has-text('Yearly')");
const freeYear = norm(await visitor.textContent("[data-testid=plan-FREE] p.mt-4"));
ok("Yearly: Free is US$0 with no period", freeYear === "US$0", freeYear);
ok("Yearly: extras and backup are quoted by the year", norm(await visitor.textContent("[data-testid=plan-SOLO]")).includes("Extra clients US$15/year each") && norm(await visitor.textContent("[data-testid=plan-STUDIO]")).includes("Extra staff US$80/year each") && norm(await visitor.textContent("[data-testid=plan-SOLO] [data-testid=video-storage]")).includes("US$50 a year") && norm(await visitor.textContent("[data-testid=plan-SOLO] [data-testid=with-backup]")) === "With cloud backup: US$200 a year");
await visitor.keyboard.press("ArrowLeft");
ok("the billing period switch works with arrow keys", (await visitor.getAttribute("[role=radio]:has-text('Monthly')", "aria-checked")) === "true" && (await visitor.evaluate(() => document.activeElement?.textContent)) === "Monthly");
void freeCard;
const soloHref = await visitor.getAttribute("[data-testid=plan-SOLO] a:has-text('Get Solo')", "href");
ok("signed out, Get Solo signs in and comes back to Solo's checkout", soloHref === `/login?next=${encodeURIComponent("/pricing?plan=SOLO&interval=month")}`, soloHref);
await visitor.screenshot({ path: `${shots}/fx-pricing-signedout.png`, fullPage: true });

await visitor.goto(BASE + "/");
await seen(visitor, ".ff-tab");
ok("home: one sentence on how long videos are kept, up by How it works", norm(await visitor.textContent("[data-testid=home-storage]")).includes("kept on our servers for 30 days") && (await visitor.$eval("[data-testid=home-storage]", (e) => e.getBoundingClientRect().top + scrollY)) < 2000);
ok("home: Record your first video opens sign-up", (await visitor.getAttribute("a:has-text('Record your first video, free')", "href")) === "/signup");
const points = norm(await visitor.textContent("[data-testid=hero-points]"));
ok("home: the add-ons point says they're paid, and phones are camera only", points.includes("Paid add-ons: AI and backup") && points.includes("camera only on phones"), points);
const trust = norm(await visitor.textContent("[data-testid=home-trust]"));
ok("home: who runs it and where data is kept, without naming anyone", trust.includes("run from Queensland, Australia (ABN 38 364 192 034)") && trust.includes("Oceania region (Australia, New Zealand and the Pacific)") && !/josiah|longfield/i.test(trust), trust);
ok("home demo: the recording limit says it's per video, by plan", norm(await visitor.textContent("#ff-panel-record")).includes("4 hours per video on paid plans, 5 minutes on Free"));
const strip = await visitor.$eval(".ff-tabs", (s) => {
  const box = s.getBoundingClientRect();
  return [...s.querySelectorAll(".ff-tab")].map((t) => { const r = t.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1 && r.width > 20; });
});
ok("home demo: all 8 tabs show in full on a computer", strip.length === 8 && strip.every(Boolean), JSON.stringify(strip));
// No tab alone on a row of its own (V3): at a laptop's 1366px the eight sit four and four.
for (const width of [1280, 1366, 1600, 1920]) {
  await visitor.setViewportSize({ width, height: 900 });
  const rows = await visitor.$$eval(".ff-tab", (ts) => Object.values(ts.reduce((a, t) => ({ ...a, [Math.round(t.getBoundingClientRect().top)]: (a[Math.round(t.getBoundingClientRect().top)] ?? 0) + 1 }), {})));
  ok(`home demo at ${width}px: no tab alone on a row`, rows.every((n) => n > 1), JSON.stringify(rows));
}
await visitor.setViewportSize({ width: 1280, height: 900 });
await visitor.click("#ff-tab-record");
ok("home demo: no Pop out camera bubble button while recording (the bubble opens by itself)", !(await visitor.isVisible("#ff-panel-record >> text=Pop out camera bubble")));
await visitor.click("#ff-tab-send");
const sendFrame = norm(await visitor.textContent("#ff-panel-send"));
ok("home demo: a first-time client's link is sent by the business, not emailed", sendFrame.includes("First time: copy Client B's link and send it yourself"), sendFrame);

await visitor.goto(BASE + "/faq");
const faq = norm(await visitor.textContent("main"));
for (const q of ["How long are my videos kept?", "what if I lose it?", "When my free videos run out", "Can I record on my phone?", "Who sees my replies?", "How do I cancel", "How long do I stay signed in?", "Where is my data stored?"]) {
  ok(`FAQ answers: ${q}`, faq.includes(q));
}
await visitor.click("text=How long are my videos kept?");
ok("FAQ answers open in place", norm(await visitor.textContent("#storage")).includes("Save to device"));
ok("FAQ: where data is kept, in plain words", faq.includes("Oceania region (Australia, New Zealand and the Pacific)") && faq.includes("mainly in the United States"));
ok("FAQ: what happens on a smaller plan", faq.includes("What happens if I move to a smaller plan?"));
await visitor.goto(BASE + "/faq#cancel");
ok("a link to one answer opens it", await visitor.waitForFunction(() => document.getElementById("cancel")?.open === true, null, { timeout: 5000 }).then(() => true, () => false));
await visitor.goto(BASE + "/about");
const about = norm(await visitor.textContent("main"));
ok("About: who runs it, as a business name with its ABN", about.includes("SureFrame is a registered business name of a sole trader based in Queensland, Australia. ABN 38 364 192 034"), about.slice(0, 300));
ok("About: support email, data locations, encryption, recovery key", about.includes("support@sureframe.app") && about.includes("Cloudflare R2") && about.includes("Video titles") && about.includes("recovery key"));
ok("About: recordings' location in plain words, the same as the FAQ", about.includes("Encrypted video and voice recordings are stored in the Oceania region (Australia, New Zealand and the Pacific)"));
ok("About and FAQ never name the owner", !/josiah|longfield/i.test(about + faq));
const footer = await visitor.$$eval("footer a", (as) => as.map((a) => a.getAttribute("href")));
ok("footer links FAQ and About", footer.includes("/faq") && footer.includes("/about"));
const footerText = norm(await visitor.textContent("footer nav"));
ok("footer: Help and FAQ are named apart", footerText.includes("Help & contact") && footerText.includes("FAQ"), footerText);
const sitemap = await (await visitor.request.get(BASE + "/sitemap.xml")).text();
ok("sitemap lists FAQ and About", sitemap.includes("/faq</loc>") && sitemap.includes("/about</loc>"));
await visitor.goto(BASE + "/help");
ok("help page shows the support email and common questions", (await seen(visitor, "[data-testid=help-email] >> text=support@sureframe.app")) && (await visitor.$$("[data-testid=help-faq] a[href^='/faq#']")).length >= 6);
ok("help page links into the FAQ rather than repeating it", (await visitor.$$("[data-testid=help-faq] [data-testid=faq-item]")).length === 0);

const missing = await visitor.goto(BASE + "/no-such-page-" + stamp);
ok("404: status 404 with its own tab title", missing.status() === 404 && (await visitor.title()).startsWith("Page not found"), await visitor.title());
ok("404: has the site header and footer", (await seen(visitor, "header >> text=Pricing")) && (await seen(visitor, "footer >> text=Privacy")));
ok("404: plain words, nothing about a video", norm(await visitor.textContent("[data-testid=not-found-text]")).includes("We couldn’t find that page") && !norm(await visitor.textContent("main")).includes("video"));
for (const path of ["/settings-nope", "/legal/nope", "/v"]) {
  const r = await visitor.goto(BASE + path);
  ok(`404 status and plain page: ${path}`, r.status() === 404 && (await seen(visitor, "[data-testid=not-found-text]")), r.status());
}
const noVideo = await visitor.goto(BASE + "/v/nonsense");
ok("a missing video: 404 status and tab title", noVideo.status() === 404 && (await visitor.title()).startsWith("Page not found"), `${noVideo.status()} ${await visitor.title()}`);
ok("a missing video: says so, on the quiet client page", (await seen(visitor, "[data-testid=video-not-found]")) && norm(await visitor.textContent("main")).includes("couldn’t find this video") && !(await visitor.isVisible("header >> text=Pricing")));
await visitor.screenshot({ path: `${shots}/fx-404-video.png` });
const legalIndex = await visitor.goto(BASE + "/legal");
ok("/legal lists the legal documents", legalIndex.status() === 200 && (await visitor.$$("[data-testid=legal-index] a")).length === 4);

await visitor.goto(BASE + "/legal/privacy");
ok("privacy: a table of contents linking to the For clients section", await seen(visitor, "[data-testid=legal-toc] a[href='#for-clients']"));
// The page's own "last updated" date (lib/legal.ts), which moves when wording that needs no new agreement changes.
const legalTs = readFileSync(new URL("../src/lib/legal.ts", import.meta.url), "utf8");
const updatedOf = (key) => legalTs.match(new RegExp(`${key}: "([^"]+)"`))?.[1];
ok("privacy: version, when it took effect, last updated, all versions", norm(await visitor.textContent("[data-testid=legal-version]")) === `Version 2026-10-11 (in effect from 11 October 2026) · Last updated ${updatedOf("privacyUpdated")} · All versions`, await visitor.textContent("[data-testid=legal-version]"));
const privacy = norm(await visitor.textContent("main"));
for (const bit of ["Keep me signed in", "the short SureFrame intro is shown once per device for each business; your browser remembers this", "Clients can delete their own replies", "The business can see"]) {
  ok(`privacy says: ${bit}`, privacy.includes(bit));
}
ok("privacy: no Continue with Google (only email sign-in exists)", !privacy.includes("Google, if you") && !privacy.includes("Continue with Google"));
ok("privacy: recordings' location in plain words", privacy.includes("Oceania region (Australia, New Zealand and the Pacific)"));
await visitor.click("[data-testid=legal-toc] a[href='#for-clients']");
ok("contents links jump to the section", await visitor.evaluate(() => location.hash === "#for-clients" && document.getElementById("for-clients").getBoundingClientRect().top < 200));
await visitor.goto(BASE + "/legal/terms");
ok("terms: contents, and the cancel link goes to Billing", (await seen(visitor, "[data-testid=legal-toc]")) && (await visitor.$$("main a[href='/settings/billing']")).length >= 1);
ok("terms: the same version line", norm(await visitor.textContent("[data-testid=legal-version]")) === `Version 2026-10-11 (in effect from 11 October 2026) · Last updated ${updatedOf("termsUpdated")} · All versions`);
await visitor.goto(BASE + "/legal/dpa");
ok("DPA: the same version line", norm(await visitor.textContent("[data-testid=legal-version]")) === `Version 1.0 (in effect from 11 October 2026) · Last updated ${updatedOf("dpaUpdated")} · All versions`, await visitor.textContent("[data-testid=legal-version]"));
ok("DPA: no Google sign-in", !norm(await visitor.textContent("main")).includes("Google (verified"));

// Sign-in pages: the keep-me-signed-in tick comes before the button that signs in; links out to pricing and legal.
await visitor.goto(BASE + "/signup");
ok("/signup: worded for a new account", norm(await visitor.textContent("[data-testid=login-heading]")) === "Create your free account");
const order = await visitor.evaluate(() => {
  const keep = document.querySelector("[data-testid=keep-signed-in]");
  const button = [...document.querySelectorAll("main button")].find((b) => /Email me a sign-in link|Continue/.test(b.textContent));
  return !!keep && !!button && !!(keep.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING);
});
ok("sign-in: Keep me signed in comes before the sign-in button", order);
ok("sign-in: links to pricing, FAQ and the legal pages", (await visitor.$$("main nav a[href='/pricing'], main nav a[href='/legal/terms'], main nav a[href='/legal/privacy'], main nav a[href='/faq']")).length === 4);

// Phones: nothing wider than the screen, and the home page keeps its lines.
const phone = await browser.newPage({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });
watch(phone);
for (const path of ["/", "/pricing", "/faq", "/about", "/help", "/legal", "/legal/privacy", "/no-such-page", "/v/nonsense", "/signup"]) {
  await phone.goto(BASE + path);
  ok(`320px: ${path} fits`, (await fits(phone)) <= 320, String(await fits(phone)));
}
await phone.goto(BASE + "/");
ok("phone home: Free for 3 clients shows", await seen(phone, "[data-testid=hero-free]"));
ok("phone header: Start free, as on a computer", norm(await phone.textContent("header a[href='/signup']")) === "Start free");
ok("phone home: each point keeps its line", (await phone.$$eval("[data-testid=hero-points] li > span:last-child", (els) => els.filter((e) => e.offsetHeight > 0).length)) === 6);
const phoneTabs = await phone.$eval(".ff-tabs", (s) => {
  const box = s.getBoundingClientRect();
  return [...s.querySelectorAll(".ff-tab")].map((t) => { const r = t.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1; });
});
ok("phone home: all 8 demo tabs show, none cut off", phoneTabs.length === 8 && phoneTabs.every(Boolean), JSON.stringify(phoneTabs));
await phone.screenshot({ path: `${shots}/fx-home-phone.png`, fullPage: true });
await phone.goto(BASE + "/pricing");
await seen(phone, "[data-testid=free-in-full]");
await phone.screenshot({ path: `${shots}/fx-pricing-phone.png`, fullPage: true });

// ---------- 2. Signed out → Get Solo → sign in → straight to Solo's checkout ----------
const buyerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const buyer = await buyerCtx.newPage();
watch(buyer);
await buyer.route("https://checkout.stripe.test/**", (r) => r.fulfill({ body: "checkout" }));
const buyerEmail = `fxbuy${stamp}@example.com`;
await agreed(buyerEmail);
await buyer.goto(BASE + "/pricing");
await buyer.click("[data-testid=plan-SOLO] a:has-text('Get Solo')");
await buyer.waitForURL((u) => u.pathname === "/login");
await buyer.fill('input[name="email"]', buyerEmail);
await buyer.click("text=Continue");
const sessionsBefore = state.sessions.length;
await buyer.waitForURL("https://checkout.stripe.test/**", { timeout: 30000 }).catch(() => {});
ok("after signing in, Solo's checkout opens without another click", buyer.url().startsWith("https://checkout.stripe.test/"), buyer.url());
const session = state.sessions.at(-1)?.params;
ok("and it's a Solo monthly checkout", state.sessions.length > sessionsBefore - 1 && state.prices.find((p) => p.id === session?.line_items?.[0]?.price)?.lookup_key === "sureframe_solo_monthly");

// ---------- 3. Signed in on Free: current plan marked, header, recorder ----------
const ownerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["camera", "microphone"] });
const owner = await ownerCtx.newPage();
watch(owner);
await owner.route("https://checkout.stripe.test/**", (r) => r.fulfill({ body: "checkout" }));
const ownerEmail = `fxsite${stamp}@example.com`;
await signIn(owner, ownerEmail, "/pricing");
await owner.waitForURL((u) => u.pathname === "/pricing");
const ws = (await waitFor(() => prisma.membership.findFirst({ where: { user: { email: ownerEmail } } }))).workspaceId;
await seen(owner, "[data-testid=current-plan]");
ok("signed in on Free: Free is marked as the current plan", norm(await owner.textContent("[data-testid=plan-FREE]")).includes("Your current plan") && norm(await owner.textContent("[data-testid=plan-FREE]")).includes("You’re on Free"));
ok("signed in: the header doesn't say Start free", !(await owner.textContent("header")).includes("Start free") && (await owner.textContent("header")).includes("New recording"));
ok("on Free, paid plans say Get", await owner.isVisible("[data-testid=plan-STUDIO] button:has-text('Get Studio')"));
ok("signed in, pricing keeps the app's header (Settings menu and plan)", (await owner.isVisible("[data-testid=settings-menu-button]")) && norm(await owner.textContent("header")).includes("Free"));
await owner.goto(BASE + "/settings");
await seen(owner, "[data-testid=settings-index]");
const settingsIndex = norm(await owner.textContent("[data-testid=settings-index]"));
ok("/settings lists the settings pages", ["Reminders", "Branding", "Invite staff", "Billing", "Account"].every((x) => settingsIndex.includes(x)), settingsIndex);
const strange = await owner.goto(BASE + "/clients/nobody-" + stamp);
ok("signed in, a page that isn't there is plain and keeps the app's menu", (await seen(owner, "[data-testid=not-found-text]")) && (await owner.isVisible("[data-testid=settings-menu-button]")) && !norm(await owner.textContent("main")).includes("video"), strange.status());

// Recorder on Free: the one quality is a note, not a dropdown.
await owner.goto(BASE + "/record");
await owner.waitForSelector("text=I've saved it", { timeout: 8000 }).then((b) => b.click()).catch(() => {});
ok("Free recorder: no one-option Quality dropdown, a 720p note instead", (await owner.isVisible("[data-testid=quality-note] >> text=720p on Free")) && !(await owner.isVisible("text=Quality")));
const leftBefore = norm(await owner.textContent("[data-testid=free-videos-left]"));
await owner.click("text=Camera only");
await owner.click("text=Start recording");
await owner.waitForSelector("text=/Recording · \\d/", { timeout: 20000 });
await owner.waitForTimeout(2500);
await owner.click("text=Discard and start over");
await owner.waitForSelector("[data-testid=discard-confirm]");
ok("Discard asks first, and says it doesn't use a free video", norm(await owner.textContent("[data-testid=discard-confirm]")).includes("doesn't count towards your free videos") && (await owner.isVisible("text=Paused")));
await owner.click("[data-testid=discard-confirm] >> text=Keep recording");
ok("Keep recording carries on", !!(await owner.waitForSelector("text=/Recording · \\d/", { timeout: 5000 }).catch(() => null)));
await owner.click("text=Discard and start over");
await owner.click("[data-testid=discard-confirm-yes]");
await owner.waitForSelector("text=Start recording", { timeout: 15000 });
ok("after discarding, the count of free videos left is back where it was", norm(await owner.textContent("[data-testid=free-videos-left]")) === leftBefore, `${leftBefore} | ${await owner.textContent("[data-testid=free-videos-left]")}`);
await owner.waitForTimeout(3000);
await owner.reload();
await owner.waitForSelector("[data-testid=free-videos-left]", { timeout: 15000 });
const wsRow = await prisma.workspace.findUnique({ where: { id: ws } });
ok("and it stays there after a reload: nothing counted", norm(await owner.textContent("[data-testid=free-videos-left]")) === leftBefore && wsRow.videosRecorded === 0 && (await prisma.video.count({ where: { workspaceId: ws } })) === 0, `${await owner.textContent("[data-testid=free-videos-left]")} recorded=${wsRow.videosRecorded}`);

// Phones start on Camera only.
const phoneOpts = {
  viewport: { width: 320, height: 700 },
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
  permissions: ["camera", "microphone"],
};
// Signed in as the same owner, with this browser's keys (the phone's own sign-in is another suite's business).
const phoneRecState = await ownerCtx.storageState({ indexedDB: true });
const phoneRecCtx2 = await browser.newContext({ ...phoneOpts, storageState: phoneRecState });
const phoneRec = await phoneRecCtx2.newPage();
await phoneRec.goto(BASE + "/record");
if (!(await seen(phoneRec, "text=Start recording", 20000))) await phoneRec.screenshot({ path: `${shots}/fx-record-phone-fail.png`, fullPage: true });
await phoneRec.waitForTimeout(500);
ok("phone recorder starts on Camera only", await phoneRec.isChecked("input[name=mode] >> nth=-1"), await phoneRec.textContent("fieldset"));
ok("phone recorder fits 320px", (await fits(phoneRec)) <= 320);
await phoneRec.screenshot({ path: `${shots}/fx-record-phone.png`, fullPage: true });
await phoneRecCtx2.close();

// ---------- 4. Solo with 11 clients and an extra seat → Studio takes the seat off ----------
let res = await owner.request.post(BASE + "/api/billing/checkout", { data: { plan: "SOLO" } });
const customer = state.sessions.at(-1).params.customer;
const sub = createSubscription(customer, ws, "sureframe_solo_monthly");
await webhook(owner, "customer.subscription.created", sub);
res = await owner.request.post(BASE + "/api/billing/seats", { data: { extraSeats: 1 } });
ok("Solo buys 1 extra seat", res.ok(), await res.text());
await prisma.client.createMany({ data: Array.from({ length: 11 }, (_, i) => ({ name: `Client ${i + 1}`, token: `fx-${stamp}-${i}-${"x".repeat(20)}`, workspaceId: ws })) });
await webhook(owner, "customer.subscription.updated", sub);

await owner.goto(BASE + "/pricing");
await seen(owner, "[data-testid=current-plan]");
ok("on Solo: Solo is marked, with no button to get it again", norm(await owner.textContent("[data-testid=plan-SOLO]")).includes("Your current plan") && (await owner.$$("[data-testid=plan-SOLO] button")).length === 0 && (await owner.isVisible("[data-testid=plan-SOLO] >> text=You’re on Solo")));
ok("on Solo: other plans say Switch to", await owner.isVisible("[data-testid=plan-STUDIO] button:has-text('Switch to Studio')"));
ok("on Solo: Free points to cancelling in Billing", (await owner.getAttribute("[data-testid=plan-FREE] a", "href")) === "/settings/billing#cancel-plan");
await owner.click("[role=radio]:has-text('Yearly')");
ok("on Solo monthly, Solo yearly offers to switch", await owner.isVisible("[data-testid=plan-SOLO] button:has-text('Switch to yearly')"));
await owner.click("[role=radio]:has-text('Monthly')");

await owner.click("[data-testid=plan-STUDIO] button:has-text('Switch to Studio')");
await owner.waitForSelector("[data-testid=plan-confirm]");
const seatsNote = norm(await owner.textContent("[data-testid=seats-removed]").catch(() => ""));
ok("the switch shows the extra seat comes off", seatsNote.includes("Studio includes 40 clients, so your 1 extra client seat is removed"), seatsNote);
const heights = await owner.$$eval("[data-testid=plan-confirm] button", (bs) => bs.map((b) => [b.textContent, b.getBoundingClientRect().height]));
ok("dialog buttons don't wrap mid-word", heights.every(([, h]) => h < 48), JSON.stringify(heights));
await owner.screenshot({ path: `${shots}/fx-switch-dialog.png` });
await owner.click("[data-testid=plan-confirm] button:has-text('and switch')");
await owner.waitForURL((u) => u.pathname === "/settings/billing", { timeout: 20000 });
ok("after the switch Stripe bills no extra client seat", sub.items.data.some((i) => i.price.lookup_key === "sureframe_studio_monthly") && !sub.items.data.some((i) => i.price.lookup_key?.startsWith("sureframe_client_seat")), sub.items.data.map((i) => `${i.price.lookup_key}x${i.quantity}`).join());
ok("and the workspace has no extra seats", (await prisma.workspace.findUnique({ where: { id: ws } })).extraClientSeats === 0);
await webhook(owner, "customer.subscription.updated", sub);

// Moving down with more clients than the plan allows: a clear dialog with somewhere to go.
await prisma.client.createMany({ data: Array.from({ length: 2 }, (_, i) => ({ name: `Client ${i + 12}`, token: `fx2-${stamp}-${i}-${"x".repeat(20)}`, workspaceId: ws })) });
await owner.goto(BASE + "/pricing");
await owner.click("[data-testid=plan-SOLO] button:has-text('Switch to Solo')");
await owner.waitForSelector("[data-testid=plan-error]");
const errText = norm(await owner.textContent("[data-testid=plan-error]"));
ok("a refused switch says why, how many to remove and where", errText.includes("Solo includes 10 clients, and you have 13. Remove 3 on the Clients page") && (await owner.isVisible("[data-testid=plan-error] a[href='/clients']")), errText);
await owner.screenshot({ path: `${shots}/fx-switch-error.png` });
await owner.keyboard.press("Escape");
ok("Escape closes it", !(await owner.isVisible("[data-testid=plan-error]")));

// ---------- 5. Billing: add-ons and seats in page dialogs, Cancel plan and Keep my plan ----------
await owner.goto(BASE + "/settings/billing");
await owner.click("[role=switch][aria-label='Cloud backup']");
await owner.waitForSelector("[data-testid=backup-confirm]");
ok("adding cloud backup asks in the page, with its price", norm(await owner.textContent("[data-testid=backup-confirm]")).includes("US$5 a month"));
await owner.click("[data-testid=backup-confirm-yes]");
ok("then says it's done", !!(await owner.waitForSelector("[data-testid=backup-done]", { timeout: 15000 }).catch(() => null)) && sub.items.data.some((i) => i.price.lookup_key === "sureframe_cloud_backup_monthly"));
await webhook(owner, "customer.subscription.updated", sub);

res = await owner.request.post(BASE + "/api/billing/seats", { data: { extraSeats: 2 } });
await webhook(owner, "customer.subscription.updated", sub);
// 13 clients on Studio's 40: both extra seats are spare.
await owner.goto(BASE + "/clients");
await owner.waitForSelector("[data-testid=remove-extraSeats-open]", { timeout: 15000 });
ok("the remove button says what it removes", norm(await owner.textContent("[data-testid=remove-extraSeats-open]")) === "Remove 1 client seat");
await owner.click("[data-testid=remove-extraSeats-open]");
await owner.click("[data-testid=remove-extras-confirm-yes]");
ok("removing a seat confirms in the page, then says it's done", !!(await owner.waitForSelector("[data-testid=remove-extras-done] >> text=1 extra client seat removed", { timeout: 15000 }).catch(() => null)));
await owner.click("[data-testid=remove-extras-done] >> text=OK");

await owner.goto(BASE + "/settings/billing");
await owner.click("[data-testid=cancel-plan-open]");
await owner.waitForSelector("[data-testid=cancel-confirm]");
const cancelText = norm(await owner.textContent("[data-testid=cancel-confirm]"));
ok("Cancel plan explains what happens and when", cancelText.includes("You keep Studio until") && cancelText.includes("move to the Free plan"), cancelText);
await owner.screenshot({ path: `${shots}/fx-cancel-dialog.png` });
await owner.click("[data-testid=cancel-confirm-yes]");
await owner.waitForSelector("[data-testid=cancel-plan-done]", { timeout: 15000 });
ok("cancelling stops renewal at the end of the period in Stripe", sub.cancel_at_period_end === true);
ok("Billing shows the end date and Keep my plan", (await seen(owner, "[data-testid=cancels-on]", 20000)) && (await seen(owner, "[data-testid=keep-plan]")));
await owner.click("[data-testid=keep-plan]");
await owner.waitForSelector("[data-testid=cancel-plan-done] >> text=will keep renewing", { timeout: 15000 });
ok("Keep my plan turns renewal back on", sub.cancel_at_period_end === false && (await seen(owner, "[data-testid=cancel-plan-open]")), `${sub.cancel_at_period_end}`);
await owner.screenshot({ path: `${shots}/fx-billing.png`, fullPage: true });
await owner.setViewportSize({ width: 320, height: 700 });
for (const path of ["/settings/billing", "/pricing"]) {
  await owner.goto(BASE + path);
  ok(`320px signed in: ${path} fits`, (await fits(owner)) <= 320, String(await fits(owner)));
}
await owner.click("[data-testid=plan-AGENCY] button:has-text('Switch to Agency')");
await owner.waitForSelector("[data-testid=plan-confirm]");
ok("320px: the switch dialog fits", (await fits(owner)) <= 320);
await owner.screenshot({ path: `${shots}/fx-switch-phone.png` });

ok("no browser confirm() or alert() boxes anywhere", nativeDialogs.length === 0, JSON.stringify(nativeDialogs));

await browser.close();
server.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
