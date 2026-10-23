// Round-4 leftovers from the 22 October 2026 sweep (worker r4-a): the smaller findings that never reached the brief.
// - Clients page: the name box comes before the seat-buying controls (S96, V97); a pasted line with no email is listed
//   before it's added as a name only (O18); the No email filter has a count (O25); a row's "More ways to send" (O22);
//   a client page names the client in full when there's no email (O36);
// - recovery key: Copy says it worked (O7); first steps' "Remind me later" (O8); the banner on Settings lines up with the
//   page (O8); an empty unlock box says what to enter (S6);
// - a video: the title says it saves itself (O29); Save to device names the file (O65); the Send box still offers a new
//   client when everyone has the video (O42);
// - public pages: the demo tabs in one row (V6), the home Send step links to its FAQ answer (V5), "See what your client
//   sees" (V11), the plan grid from lib/plans (V26), the sign-in page says what it opens (V59), /signup comes back to the
//   Library (V70), /help keeps the app's header when signed in (V78) and offers starting questions (V39), About on
//   continuity (V31), the Privacy Policy's short version and cookie names (V51, V50).
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { agreed } from "./agree.mjs";
import { sendByLink } from "./send.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const prisma = new PrismaClient();
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${String(detail).slice(0, 400)}`}`);
  if (!pass) failed++;
};
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const waitFor = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 250) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return fn();
};
const plans = readFileSync(new URL("../src/lib/plans.ts", import.meta.url), "utf8");

const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args });
const stamp = Date.now();

// ---------- Public pages ----------
const visitor = await browser.newPage({ viewport: { width: 1366, height: 900 } });
await visitor.goto(BASE + "/");
await visitor.waitForSelector(".ff-tab");
const rows = await visitor.$$eval(".ff-tab", (ts) => new Set(ts.map((t) => Math.round(t.getBoundingClientRect().top))).size);
ok("home demo at 1366px: the eight tabs sit in one row (V6)", rows === 1, rows);
await visitor.setViewportSize({ width: 1280, height: 900 });
ok("home demo at 1280px: one row too", (await visitor.$$eval(".ff-tab", (ts) => new Set(ts.map((t) => Math.round(t.getBoundingClientRect().top))).size)) === 1);
ok("home demo: the To-dos tab has a short label", norm(await visitor.textContent("#ff-tab-todos")) === "To-dos");
ok("home: the Send step links to why the first video comes from you (V5)", (await visitor.getAttribute("[data-testid=home-step-why]", "href")) === "/faq#first-email");
ok("home: See what your client sees (V11)", (await visitor.getAttribute("[data-testid=home-example]", "href")) === "/example");

await visitor.goto(BASE + "/example");
await visitor.waitForSelector("[data-testid=preview-video]");
ok("example: says it's an example with sample content", norm(await visitor.textContent("[data-testid=example-bar]")).includes("An example of what your client sees."));
await visitor.click("[data-testid=example-bar] >> text=All their videos");
ok("example: their list of videos", await visitor.waitForSelector("[data-testid=preview-inbox]", { timeout: 5000 }).then(() => true, () => false));
await visitor.click("[data-testid=example-bar] >> text=The email");
ok("example: the email they get", await visitor.waitForSelector("[data-testid=preview-email]", { timeout: 5000 }).then(() => true, () => false));

await visitor.goto(BASE + "/pricing");
await visitor.waitForSelector("[data-testid=plan-grid]");
const grid = await visitor.$$eval("[data-testid=plan-grid] tbody tr", (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.trim())));
const row = (label) => grid.find((r) => r[0] === label)?.slice(1).join("|");
const studioClients = plans.match(/STUDIO: \{\s*name:[\s\S]*?clientSeats: (\d+)/)[1];
const agencyStaff = plans.match(/AGENCY: \{\s*name:[\s\S]*?staffSeats: (\d+)/)[1];
ok("pricing grid: clients and staff from lib/plans (V26)", row("Clients included")?.split("|")[2] === studioClients && row("Staff logins")?.split("|")[3] === agencyStaff, JSON.stringify(grid.slice(0, 3)));
ok("pricing grid: Free has 25 videos in total, paid plans no limit", row("Videos") === "25 in total|No limit|No limit|No limit", row("Videos"));
ok("pricing grid: video length, backup and AI rows", row("Longest video") === "5 min|4 hours|4 hours|4 hours" && row("Cloud backup (US$ a month)") === "No|5|5|5" && row("AI add-on (US$ a month)") === "No|8|15|29", JSON.stringify(grid));
ok("pricing: the AI summary limit is per month on yearly billing too (V12, V21)", norm(await visitor.textContent("[data-testid=addon-ai]")).includes("Summary limits are per calendar month, on yearly billing too."));
const phone = await browser.newPage({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });
await phone.goto(BASE + "/pricing");
await phone.waitForSelector("[data-testid=plan-grid]");
const fit = await phone.evaluate(() => {
  const g = document.querySelector("[data-testid=plan-grid]").getBoundingClientRect();
  const t = document.querySelector("[data-testid=plan-grid] table").getBoundingClientRect();
  return document.documentElement.scrollWidth <= innerWidth && t.right <= g.right + 1;
});
ok("pricing grid fits a 320px phone", fit);
for (const path of ["/example", "/about", "/help"]) {
  await phone.goto(BASE + path);
  await phone.waitForLoadState("networkidle").catch(() => {});
  ok(`320px: ${path} fits`, await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}

await visitor.goto(BASE + "/about");
ok("about: what happens if we're away or close (V31)", norm(await visitor.textContent("#continuity")).includes("at least 30 days’ notice by email") && (await visitor.$$("#continuity a[href='/legal/terms#suspension']")).length === 1);
await visitor.goto(BASE + "/legal/privacy");
const privacy = norm(await visitor.textContent("main"));
ok("privacy: the short version says some records are kept after an account is deleted (V51)", privacy.includes("A few records are kept after an account is deleted"));
ok("privacy: explains the fc_ cookie names (V50)", privacy.includes("start with fc_, from the working name"));

await visitor.goto(BASE + "/help");
await visitor.waitForSelector("[data-testid=help-suggestions]");
const chips = await visitor.$$eval("[data-testid=help-suggestions] button", (bs) => bs.map((b) => b.textContent.trim()));
ok("help: starting questions in the empty chat (V39)", chips.length === 4 && chips.includes("How long are my videos kept?"), JSON.stringify(chips));

await visitor.goto(`${BASE}/login?next=${encodeURIComponent("/settings")}`);
await visitor.waitForSelector("[data-testid=login-heading]");
ok("sign-in from /settings says what it opens (V59)", norm(await visitor.textContent("main")).includes("Sign in to see your settings."));
await visitor.goto(`${BASE}/login`);
await visitor.waitForSelector("[data-testid=login-heading]");
ok("plain sign-in doesn't", !norm(await visitor.textContent("main")).includes("Sign in to see"));

// /signup comes back to the Library, where a new owner's first steps are (V70).
const newbie = `r4a-signup${stamp}@example.com`;
await agreed(newbie);
await visitor.goto(BASE + "/signup");
await visitor.fill('input[name="email"]', newbie);
await visitor.click("text=Continue");
await visitor.waitForURL((u) => u.pathname !== "/signup", { timeout: 20000 }).catch(() => {});
ok("/signup lands on the Library, not the recorder", new URL(visitor.url()).pathname === "/library", visitor.url());
await visitor.close();

// ---------- An owner: Clients ----------
const email = `r4a-owner${stamp}@example.com`;
await agreed(email);
const ctx = await browser.newContext({ permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"], viewport: { width: 1280, height: 900 } });
const owner = await ctx.newPage();
await owner.goto(`${BASE}/login`);
await owner.fill('input[name="email"]', email);
await owner.click("text=Continue");
await owner.waitForURL((u) => u.pathname === "/library");
const ws = (await waitFor(() => prisma.membership.findFirst({ where: { user: { email } } }))).workspaceId;

// Recovery key in the first steps: Copy says so, and Remind me later folds it (O7, O8).
await owner.waitForSelector("[data-testid=first-steps] [data-testid=key-copy]", { timeout: 20000 });
await owner.click("[data-testid=first-steps] [data-testid=key-copy]");
await owner.waitForSelector("[data-testid=first-steps] [data-testid=key-copied] >> text=Recovery key copied.", { timeout: 5000 }).catch(() => {});
ok("Copy: the button and a line say the key was copied (O7)", norm(await owner.textContent("[data-testid=first-steps] [data-testid=key-copy]")) === "✓ Copied" && norm(await owner.textContent("[data-testid=first-steps] [data-testid=key-copied]")).startsWith("Recovery key copied."));
await owner.click("[data-testid=first-steps] [data-testid=recovery-key-later]");
ok("first steps: Remind me later folds the key to one line (O8)", await owner.isVisible("[data-testid=recovery-key-folded]"));
await owner.click("[data-testid=recovery-key-folded] >> text=Show recovery key");
ok("and Show recovery key opens it again", await owner.isVisible("[data-testid=first-steps] [data-recovery-key]"));
// On Settings the banner lines up with the page's column (O8).
await owner.goto(BASE + "/settings/account");
await owner.waitForSelector("[data-testid=recovery-key-reminder] [data-recovery-key]", { timeout: 15000 });
const widths = await owner.evaluate(() => {
  const banner = document.querySelector("[data-testid=recovery-key-reminder]").getBoundingClientRect();
  const main = document.querySelector("main").getBoundingClientRect();
  return { banner: [Math.round(banner.left), Math.round(banner.right)], main: [Math.round(main.left), Math.round(main.right)] };
});
ok("settings: the key banner is as wide as the page under it", Math.abs(widths.banner[0] - widths.main[0]) <= 1 && Math.abs(widths.banner[1] - widths.main[1]) <= 1, JSON.stringify(widths));

await owner.goto(BASE + "/clients");
await owner.waitForSelector("input[aria-label='Client name']");
const order = await owner.evaluate(() => {
  const nameBox = document.querySelector("input[aria-label='Client name']");
  const seats = document.querySelector("#buy-seats");
  return !!seats && !!(nameBox.compareDocumentPosition(seats) & Node.DOCUMENT_POSITION_FOLLOWING);
});
ok("clients: the name box comes before the seats and any seat-buying controls (S96, V97)", order);
ok("clients: says what a client's page is for", norm(await owner.textContent("[data-testid=client-page-hint]")).includes("Open a client by their name"));
await owner.click("[data-testid=bulk-open]");
await owner.fill("#bulk-list", `Client R1, r4a-c1-${stamp}@example.com\nClient Bad line without comma\nClient R2`);
const noEmail = norm(await owner.textContent("[data-testid=bulk-no-email]"));
ok("pasted list: lines with no email are listed before adding (O18)", noEmail.includes("2 lines have no email") && noEmail.includes("Client Bad line without comma") && noEmail.includes("Client R2"), noEmail);
await owner.fill("#bulk-list", `Client R1, r4a-c1-${stamp}@example.com\nClient R2`);
await owner.click("[data-testid=bulk-add] >> button:has-text('Add 2 clients')");
await owner.waitForSelector("[data-testid=added-note]", { timeout: 15000 });
await owner.click("[data-testid=added-done]");
const filter = await owner.$$eval("[data-testid=clients-filter] option", (os) => os.map((o) => o.textContent));
ok("filter: Copy link shows its count (O25)", filter.includes("Copy link (1)"), JSON.stringify(filter));
ok("a new client's row: More ways to send opens their page (O22)", (await owner.locator("[data-testid=row-more-ways]").count()) === 2);
const r2 = await prisma.client.findFirst({ where: { workspaceId: ws, name: "Client R2" } });
await owner.goto(`${BASE}/clients/${r2.id}`);
await owner.waitForSelector("[data-testid=client-route]");
ok("client page: a Copy link client says so, with Change (O36)", norm(await owner.textContent("[data-testid=client-route]")).startsWith("Receives videos by copy link, sent however you choose.") && (await owner.locator("[data-testid=route-change]").count()) === 1);

// ---------- A video ----------
await owner.goto(BASE + "/record");
await owner.click("text=Camera only");
await owner.click("text=Start recording");
await owner.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await owner.waitForTimeout(2000);
await owner.click("button:has-text('Stop')");
await owner.waitForURL("**/v/**", { timeout: 30000 });
const videoId = owner.url().split("/v/")[1].split("?")[0];
await waitFor(async () => (await prisma.video.findUnique({ where: { id: videoId } })).status !== "RECORDING", 20000);
ok("title: says it saves itself (O29)", norm(await owner.textContent("[data-testid=title-autosave]")) === "The title is saved as you type.");
// Everyone has it: the Send box still offers a new client (O42).
await sendByLink(owner, "Client R1");
await owner.reload();
await sendByLink(owner, "Client R2");
await owner.reload();
await owner.waitForSelector("text=Every client you can send to has this video.", { timeout: 20000 });
ok("everyone has it: + Add a new client is still there (O42)", await owner.isVisible("[data-testid=send-panel] [data-testid=quick-add-open]"));
// Save to device names the file and says where it went (O65).
await owner.waitForSelector("[data-testid=save-to-device]", { timeout: 30000 });
const [download] = await Promise.all([owner.waitForEvent("download", { timeout: 15000 }).catch(() => null), owner.click("[data-testid=save-to-device]")]);
const saving = norm(await owner.textContent("[data-testid=saving-note]").catch(() => ""));
ok("Save to device: names the file and says where to look", !!download && saving.includes(download.suggestedFilename()) && saving.includes("downloads"), `${download?.suggestedFilename()} | ${saving}`);
await owner.waitForTimeout(7000);
ok("and the note is still there after 7 seconds", await owner.isVisible("[data-testid=saving-note]"));
await owner.screenshot({ path: `${shots}/leftovers-a-video.png`, fullPage: true });

// ---------- Signed in: /help keeps the app's menu (V78) ----------
await owner.goto(BASE + "/help");
await owner.waitForSelector("main textarea");
const navHrefs = await owner.locator("header nav a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
ok("help signed in: the app's own header (V78)", navHrefs.includes("/clients") && navHrefs.includes("/library"), navHrefs.join("|"));
ok("help signed in: no second, floating chat", (await owner.locator("[data-testid=help-button]").count()) === 0);

// ---------- A new browser: the unlock box with nothing typed (S6) ----------
const other = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const fresh = await other.newPage();
await fresh.goto(`${BASE}/login?next=%2Fclients`);
await fresh.fill('input[name="email"]', email);
await fresh.click("text=Continue");
await fresh.waitForURL((u) => u.pathname === "/clients");
await fresh.waitForSelector("text=Unlock your videos in this browser", { timeout: 20000 });
await fresh.click("button:has-text('Unlock')");
const said = norm(await fresh.textContent("[role=alert]").catch(() => ""));
ok("unlock with an empty box: says what to enter, not that the key is wrong (S6)", said.startsWith("Enter your recovery key") && !said.includes("isn't valid"), said);

// Decision 15: a new browser sees the client list; only what needs the team's key asks for it, and says why.
ok("new browser: the client list shows without the key (Decision 15)", (await fresh.locator("main a[href^='/clients/']:has-text('Client R1')").count()) === 1 && (await fresh.locator("main a[href^='/clients/']:has-text('Client R2')").count()) === 1);
ok("new browser: the unlock box says what's locked and why", norm(await fresh.textContent("[data-testid=unlock-why]")).includes("Adding a client and copying a client's personal link need the key in this browser") && norm(await fresh.textContent("[data-testid=unlock-what]")).includes("Your client list, settings and billing work without it."));
ok("new browser: Add client asks for the key instead of a form", (await fresh.isVisible("[data-testid=add-locked]")) && (await fresh.locator("input[aria-label='Client name']").count()) === 0 && (await fresh.locator("[data-testid=bulk-open]").count()) === 0);
ok("new browser: each Copy link is 'Unlock to copy link', up to the box", (await fresh.locator("[data-testid=row-unlock-link]").count()) === 2 && (await fresh.locator("button[aria-label^='Copy link for']").count()) === 0 && (await fresh.getAttribute("[data-testid=row-unlock-link] >> nth=0", "href")) === "#unlock");
ok("new browser: one unlock box on the Clients page", (await fresh.locator("[data-testid=unlock-box]").count()) === 1);
await fresh.setViewportSize({ width: 320, height: 720 });
ok("new browser: the locked Clients page fits 320px", await fresh.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await fresh.screenshot({ path: `${shots}/new-browser-clients-320.png`, fullPage: true });
await fresh.setViewportSize({ width: 1280, height: 900 });
// A client's own page: one unlock box (to-dos and notes), and the link card says why it's locked.
await fresh.goto(`${BASE}/clients/${r2.id}`);
await fresh.waitForSelector("[data-testid=unlock-box]", { timeout: 20000 });
ok("new browser: a client's page has one unlock box, and the link says why it needs the key", (await fresh.locator("[data-testid=unlock-box]").count()) === 1 && norm(await fresh.textContent("[data-testid=link-locked]")).includes("personal link carries their private key"));
// Recording can't be done without the key (a new video is locked with it), so Record asks first and says why.
await fresh.goto(`${BASE}/record`);
await fresh.waitForSelector("[data-testid=unlock-why]", { timeout: 20000 });
ok("new browser: Record asks for the key first and says why (Decision 15)", norm(await fresh.textContent("[data-testid=unlock-why]")).startsWith("To record here, enter your recovery key first.") && (await fresh.locator("text=Start recording").count()) === 0);
// With the key entered, everything opens: adding and copying come back on the Clients page.
const teamKey = await owner.evaluate((id) => localStorage.getItem(`framecast.key.team:${id}`), ws);
await fresh.fill("input[aria-label='Recovery key']", teamKey ?? "");
await fresh.click("button:has-text('Unlock')");
ok("new browser: after the key, Record opens", !!(await fresh.waitForSelector("[data-testid=unlock-box]", { state: "detached", timeout: 20000 }).then(() => true, () => false)) && (await fresh.locator("text=Unlocking…").count()) === 0);
await fresh.goto(`${BASE}/clients`);
ok("new browser: after the key, Add client and Copy link are back", !!(await fresh.waitForSelector("input[aria-label='Client name']", { timeout: 20000 }).catch(() => null)) && (await fresh.locator("button[aria-label^='Copy link for']").count()) === 2 && (await fresh.locator("[data-testid=unlock-box]").count()) === 0);
await other.close();

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
