// The app shell for a new owner and their staff (fixes from the site test):
// - signing in: "Create your free account" from Start free, a line on when you're signed out, "Keep me
//   signed in on this device", the return path kept, and (email links) the address, Send again and
//   accurate rate-limit wording;
// - one welcome step for the name and business name, and one welcome email;
// - the first-steps checklist that ticks itself off, with the recovery key (download, find it later)
//   kept until "I've saved it";
// - one Settings menu (desktop) and section (phone), no team pages for one person, staff without
//   Billing or Branding, the phone menu right under the bar;
// - the help chat (Escape, clear buttons, small on phones), times in the viewer's own zone with no
//   hydration error, the readable data export;
// - staff joining in one step, a staff Team page, "Unassigned", removing staff with an in-page
//   confirmation listing clients, and being told plainly about it.
// Run it against a server with the dev login (most of it) and again with AUTH_EMAIL_LINKS=true (the email pages).
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const prisma = new PrismaClient();
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};
const waitFor = async (fn, ms = 20000) => {
  for (let t = 0; t < ms; t += 250) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return fn();
};
const path = (page) => new URL(page.url()).pathname;
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const outbox = () => (existsSync(".data/outbox") ? readdirSync(".data/outbox").map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8"))) : []);
const DAY = 86_400_000;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const stamp = Date.now();

// ---- The sign-in page --------------------------------------------------------------------------------
const visitor = await (await browser.newContext()).newPage();
await visitor.goto(`${BASE}/record`);
await visitor.waitForURL((u) => u.pathname === "/login");
ok("Start free (it opens /record): the page says an account is being made", (await visitor.textContent("[data-testid=login-heading]")).trim() === "Create your free account");
ok("one short line on when you're signed out", (await visitor.textContent("[data-testid=signout-default]")).includes("signed out when you close your browser or after 8 hours"));
ok("Keep me signed in starts unticked", !(await visitor.isChecked("[data-testid=keep-signed-in]")));
ok("no second agreement line on the sign-in page (the /agree page is the record)", !(await visitor.isVisible("text=By continuing you agree")));
await visitor.goto(`${BASE}/login`);
await visitor.waitForSelector("text=Entering your email creates your free account", { timeout: 10000 }).catch(() => null);
const plainHeading = (await visitor.textContent("[data-testid=login-heading]")).trim();
ok("plain sign-in says a free account is made for a new email", plainHeading === "Sign in" && (await visitor.isVisible("text=Entering your email creates your free account")), plainHeading);
const emailLinks = await visitor.isVisible("text=Email me a sign-in link");

if (emailLinks) {
  // ---- Email links: the check page, Send again and the rate-limit wording --------------------------------
  const addr = `fx-mail${stamp}@example.com`;
  await visitor.goto(`${BASE}/login?next=${encodeURIComponent("/pricing?plan=SOLO&interval=month")}`);
  ok("from a plan on the pricing page: create-account wording", (await visitor.textContent("[data-testid=login-heading]")).trim() === "Create your free account");
  await visitor.fill('input[name="email"]', addr);
  await visitor.click("text=Email me a sign-in link");
  await visitor.waitForURL((u) => u.pathname === "/login/check");
  ok("Check your email shows the address", (await visitor.textContent("[data-testid=sent-to]")).includes(addr));
  ok("Send again waits first", (await visitor.isDisabled("[data-testid=send-again]")) && /Send again in \d+s/.test(await visitor.textContent("[data-testid=send-again]")));
  const mail = await waitFor(() => outbox().find((m) => m.to === addr && /sign-in link/.test(m.subject)));
  ok("the sign-in email fits a phone (a viewport tag, not a zoomed-out page)", !!mail && mail.html.includes('name="viewport" content="width=device-width'));
  const link = mail?.text.match(/https?:\/\/\S+/)?.[0] ?? "";
  ok("the link carries the return path", decodeURIComponent(decodeURIComponent(decodeURIComponent(link))).includes("/pricing?plan=SOLO&interval=month"), link);
  await visitor.setViewportSize({ width: 320, height: 700 });
  ok("check page fits 320px", await noSideways(visitor));
  await visitor.screenshot({ path: `${shots}/fx-shell-check-email-320.png`, fullPage: true });
  await visitor.waitForTimeout(31_000);
  ok("Send again after the wait", await visitor.isEnabled("[data-testid=send-again]"));
  await visitor.click("[data-testid=send-again]");
  await visitor.waitForURL((u) => u.searchParams.get("again") === "1");
  ok("sent again, and says so", (await visitor.textContent("[data-testid=sent-to]")).startsWith("We sent another sign-in link"));
  await visitor.setViewportSize({ width: 1280, height: 900 });

  // The network's allowance used up (an office, a carrier): the message says it's the network.
  const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  await prisma.rateLimit.upsert({ where: { key_windowStart: { key: "signin-email:ip:local", windowStart: hour } }, update: { count: 30 }, create: { key: "signin-email:ip:local", windowStart: hour, count: 30 } }).catch(() => null);
  const ipKeys = await prisma.rateLimit.findMany({ where: { key: { startsWith: "signin-email:ip:" }, windowStart: hour } });
  for (const k of ipKeys) await prisma.rateLimit.update({ where: { key_windowStart: { key: k.key, windowStart: hour } }, data: { count: 30 } });
  await visitor.goto(`${BASE}/login`);
  await visitor.fill('input[name="email"]', `fx-other${stamp}@example.com`);
  await visitor.click("text=Email me a sign-in link");
  await visitor.waitForURL((u) => u.searchParams.get("error") === "rate-network");
  ok("network limit: says it's the network, not the address", (await visitor.textContent("main p[role=alert]")).includes("from your network"));
  for (const k of ipKeys) await prisma.rateLimit.update({ where: { key_windowStart: { key: k.key, windowStart: hour } }, data: { count: 0 } });
  await prisma.rateLimit.deleteMany({ where: { key: "signin-email:ip:local", windowStart: hour, count: 30 } });
  // One address asked for too many: says so, and to check the inbox.
  await prisma.rateLimit.upsert({ where: { key_windowStart: { key: `signin-email:to:${addr}`, windowStart: hour } }, update: { count: 5 }, create: { key: `signin-email:to:${addr}`, windowStart: hour, count: 5 } });
  await visitor.goto(`${BASE}/login`);
  await visitor.fill('input[name="email"]', addr);
  await visitor.click("text=Email me a sign-in link");
  await visitor.waitForURL((u) => u.searchParams.get("error") === "rate");
  ok("address limit: says it's this address, and to check the inbox", (await visitor.textContent("main p[role=alert]")).includes("to this address"));
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "signin-email" } } });
  await browser.close();
  await prisma.$disconnect();
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
}

// ---- A new owner: Keep me signed in, the welcome step, the welcome email -------------------------------
const ownerEmail = `fx-owner${stamp}@example.com`;
const ownerUser = await agreed(ownerEmail);
// A brand-new sign-up hasn't done the welcome step (the helper marks suite logins as done).
await prisma.user.update({ where: { id: ownerUser.id }, data: { onboardedAt: null, name: null } });
const ownerCtx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true, timezoneId: "Australia/Brisbane" });
const owner = await ownerCtx.newPage();
const consoleErrors = [];
owner.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
owner.on("pageerror", (e) => consoleErrors.push(String(e)));
await owner.goto(`${BASE}/login`);
await owner.check("[data-testid=keep-signed-in]");
await owner.fill('input[name="email"]', ownerEmail);
await owner.click("text=Continue");
await owner.waitForURL((u) => u.pathname === "/welcome", { timeout: 30000 });
await owner.waitForSelector("[data-testid=welcome-business]", { timeout: 30000 }).catch(() => null);
const cookies = await ownerCtx.cookies();
const keep = cookies.find((c) => c.name === "sf_keep");
const active = cookies.find((c) => c.name === "sf_active");
ok("kept signed in: for 30 days from this sign-in", !!keep && Math.abs(keep.expires * 1000 - (Date.now() + 30 * DAY)) < DAY, JSON.stringify(keep));
ok("and the activity cookie outlives the browser", !!active && active.expires > 0, JSON.stringify(active));
ok("new owner: one welcome step, with the business name and their name", (await owner.isVisible("[data-testid=welcome-business]")) && (await owner.isVisible("[data-testid=welcome-name]")));
await owner.setViewportSize({ width: 320, height: 700 });
ok("welcome step fits 320px", await noSideways(owner));
await owner.screenshot({ path: `${shots}/fx-shell-welcome-320.png`, fullPage: true });
await owner.setViewportSize({ width: 1280, height: 900 });
await owner.click("[data-testid=welcome-submit]");
ok("the business name is needed", (await owner.locator("[data-testid=welcome-business]:invalid").count()) === 1);
await owner.fill("[data-testid=welcome-business]", "Business A");
await owner.fill("[data-testid=welcome-name]", "Team member 1");
await owner.click("[data-testid=welcome-submit]");
await owner.waitForURL((u) => u.pathname === "/library", { timeout: 30000 });
const ws = await prisma.workspace.findFirst({ where: { members: { some: { userId: ownerUser.id, role: "OWNER" } } } });
ok("business name and name saved", ws.name === "Business A" && (await prisma.user.findUnique({ where: { id: ownerUser.id } })).name === "Team member 1");
const welcome = await waitFor(() => outbox().filter((m) => m.to === ownerEmail && m.subject === "Welcome to SureFrame"));
ok("one welcome email, with first steps and where to get help", welcome.length === 1 && welcome[0].text.includes("Save your recovery key") && welcome[0].text.includes("support@sureframe.app") && welcome[0].text.includes("Business A"));
await owner.goto(`${BASE}/welcome`);
await owner.waitForURL((u) => u.pathname === "/library");
ok("the welcome step doesn't come back", path(owner) === "/library");

// "Close the browser": only cookies with an expiry date come back. Kept, so still signed in.
const kept = (await ownerCtx.cookies()).filter((c) => c.expires !== -1);
const reopened = await browser.newContext({ timezoneId: "Australia/Brisbane" }); // the same computer, so the same zone
await reopened.addCookies(kept);
const again = await reopened.newPage();
await again.goto(`${BASE}/library`);
await again.waitForURL((u) => u.pathname === "/login", { timeout: 5000 }).catch(() => {});
ok("kept: a reopened browser is still signed in", path(again) === "/library", again.url());
await reopened.close();

// ---- First steps: one checklist, ticked from real data; the recovery key kept until saved -------------
await owner.goto(`${BASE}/library`);
await owner.waitForSelector("[data-testid=first-steps]");
ok("no separate name banner for the owner", (await owner.locator("[data-testid=name-prompt]").count()) === 0);
ok("business name step already ticked", (await owner.getAttribute("[data-testid=step-name]", "data-done")) === "yes");
ok("client and video steps still to do", (await owner.getAttribute("[data-testid=step-client]", "data-done")) === "no" && (await owner.getAttribute("[data-testid=step-video]", "data-done")) === "no");
const box = await owner.waitForSelector("[data-testid=first-steps] [data-recovery-key]", { timeout: 20000 }).catch(() => null);
ok("the recovery key is in the first steps", !!box);
const key = await box?.getAttribute("data-recovery-key");
ok("not shown twice on the library", (await owner.locator("[data-testid=recovery-key-reminder]").count()) === 0);
ok("shown in a font that tells 0 from O (slashed zero, numbers in colour)", (await owner.locator("[data-testid=first-steps] [data-recovery-key].slashed-zero").count()) === 1);
ok("says where to find it later", (await owner.textContent("[data-testid=first-steps]")).includes("Settings, Account, Show recovery key"));
const [download] = await Promise.all([owner.waitForEvent("download"), owner.click("[data-testid=first-steps] [data-testid=key-download]")]);
const keyFile = readFileSync(await download.path(), "utf8");
ok("Download (.txt) holds the key", download.suggestedFilename() === "sureframe-recovery-key.txt" && keyFile.replace(/\s/g, "").includes(key));
ok("Print is offered too", await owner.isVisible("[data-testid=first-steps] button:has-text('Print')"));
await owner.screenshot({ path: `${shots}/fx-shell-first-steps.png`, fullPage: true });
await owner.reload();
ok("still there after a reload", !!(await owner.waitForSelector("[data-testid=first-steps] [data-recovery-key]", { timeout: 15000 }).catch(() => null)));
// Elsewhere it's one line that opens the key, until "I've saved it".
await owner.goto(`${BASE}/settings/reminders`);
const line = await owner.waitForSelector("[data-testid=recovery-key-reminder] >> text=Show recovery key", { timeout: 15000 }).catch(() => null);
ok("on other pages: a one-line reminder", !!line);
await line?.click();
ok("which opens the key", (await owner.getAttribute("[data-testid=recovery-key-reminder] [data-recovery-key]", "data-recovery-key")) === key);
await owner.click("[data-testid=recovery-key-reminder] >> text=I've saved it");
await waitFor(async () => !!(await prisma.workspace.findUnique({ where: { id: ws.id } })).recoveryKeySavedAt);
ok("I've saved it is remembered", !!(await prisma.workspace.findUnique({ where: { id: ws.id } })).recoveryKeySavedAt);
await owner.goto(`${BASE}/library`);
await owner.waitForSelector("[data-testid=first-steps]");
ok("the key step ticks itself off", (await owner.getAttribute("[data-testid=step-key]", "data-done")) === "yes");
ok("and the reminder is gone", (await owner.locator("[data-testid=recovery-key-reminder]").count()) === 0);

// ---- Times in the viewer's own zone; workspace zone set from the owner's browser -----------------------
ok("the browser's time zone is kept for the server", (await ownerCtx.cookies()).some((c) => c.name === "sf_tz" && decodeURIComponent(c.value) === "Australia/Brisbane"));
ok("a business with no time zone gets the owner's", (await waitFor(async () => (await prisma.workspace.findUnique({ where: { id: ws.id } })).timezone === "Australia/Brisbane")));

// ---- Menus: one Settings item, no team pages for one person ----------------------------------------------
const navHrefs = await owner.locator("header nav a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
ok("desktop bar: Clients, Library and Settings only (no Overview or Team for one person)", navHrefs.join("|") === "/clients|/library", navHrefs.join("|"));
await owner.click("[data-testid=settings-menu-button]");
const settingsLinks = await owner.locator("[data-testid=settings-menu] a").evaluateAll((els) => els.map((e) => e.innerText.trim()));
ok("Settings menu: Reminders, Branding, Invite staff, Billing, Account", settingsLinks.join("|") === "Reminders|Branding|Invite staff|Billing|Account", settingsLinks.join("|"));
await owner.screenshot({ path: `${shots}/fx-shell-settings-menu.png` });
await owner.keyboard.press("Escape");
await owner.goto(`${BASE}/team`);
await owner.waitForURL((u) => u.pathname === "/settings/team");
ok("one person: /team goes to inviting staff", path(owner) === "/settings/team");
await owner.goto(`${BASE}/settings/reminders`);
ok("Reminders links to the business name in Branding", (await owner.getAttribute("[data-testid=reminders-business] a", "href")) === "/settings/branding");
await owner.goto(`${BASE}/settings/branding`);
ok("Free plan: the business name is set on Branding", (await owner.getByLabel("Business name").inputValue()) === "Business A");

// No hydration error (React #418) on the signed-in settings pages, with the browser in another zone.
consoleErrors.length = 0;
for (const p of ["/settings/reminders", "/settings/account", "/settings/branding", "/settings/team", "/settings/billing", "/library"]) {
  await owner.goto(BASE + p);
  await owner.waitForLoadState("networkidle").catch(() => {});
}
const hydration = consoleErrors.filter((e) => /418|hydrat/i.test(e));
ok("no hydration errors on the settings pages", hydration.length === 0, hydration.join(" / "));

// ---- Help chat -----------------------------------------------------------------------------------------
await owner.goto(`${BASE}/settings/account`);
await owner.click("[data-testid=help-button]");
await owner.waitForSelector("role=dialog[name='SureFrame help']");
const talk = await owner.$eval("[data-testid=talk-to-person]", (b) => getComputedStyle(b).borderTopWidth);
ok("Talk to a person is a clear button", talk !== "0px", talk);
await owner.keyboard.press("Escape");
ok("Escape closes the help chat", (await owner.locator("role=dialog[name='SureFrame help']").count()) === 0);

// ---- Readable data export --------------------------------------------------------------------------------
await owner.goto(`${BASE}/library`);
const todo = `Call Client A back ${stamp}`;
await owner.fill('textarea[aria-label="New to-do"]', todo);
await owner.click("form >> button:has-text('Add')");
await owner.waitForSelector(`text=${todo}`);
const stored = await waitFor(() => prisma.item.findFirst({ where: { workspaceId: ws.id }, orderBy: { createdAt: "desc" } }));
ok("the to-do is stored encrypted", !!stored && !stored.body.includes(todo));
await owner.goto(`${BASE}/settings/account`);
const [exp] = await Promise.all([owner.waitForEvent("download"), owner.click("[data-testid=readable-export]")]);
const readable = JSON.parse(readFileSync(await exp.path(), "utf8"));
const mine = readable.workspaces.find((w) => w.workspace.id === ws.id);
ok("readable export: to-dos opened in the browser", mine?.items?.some((i) => i.text === todo), JSON.stringify(mine?.items));
ok("and no wrapped keys left in the file", !JSON.stringify(readable).includes("teamKeyWrap"));
const plain = await (await owner.request.get(`${BASE}/api/account/export`)).text();
ok("the stored download still has no readable to-dos", !plain.includes(todo));

// ---- A team: staff join in one step, see their own page, and are told when removed --------------------
await prisma.workspace.update({ where: { id: ws.id }, data: { plan: "STUDIO" } });
await owner.goto(`${BASE}/clients`);
await owner.fill('input[aria-label="Client name"]', "Client A");
await owner.fill('input[aria-label="Client email"]', `client-a${stamp}@example.com`);
await owner.click("button:has-text('Add client')");
await owner.waitForSelector("main >> text=Client A");
await owner.fill('input[aria-label="Client name"]', "Client B");
await owner.click("button:has-text('Add client')");
await owner.waitForSelector("main >> text=Client B");
await owner.goto(`${BASE}/settings/team`);
await owner.fill('input[aria-label="Staff email"]', `fx-staff${stamp}@example.com`);
await owner.click("text=Create invite link");
const invite = await (await owner.waitForSelector("[data-testid=invite-link]")).textContent();

const staffCtx = await browser.newContext({ viewport: { width: 320, height: 700 } });
const staff = await staffCtx.newPage();
await staff.goto(invite);
await staff.click("text=Sign in to join");
await staff.waitForURL((u) => u.pathname === "/login");
ok("signing in to join says so", (await staff.textContent("[data-testid=login-heading]")).trim() === "Sign in to join your team");
await staff.fill('input[name="email"]', `fx-staff${stamp}@example.com`);
await staff.click("text=Continue");
await staff.waitForURL((u) => u.pathname.startsWith("/join/"));
await staff.waitForSelector("[data-testid=join-agree]");
ok("joining: agree and join are one step", (await staff.isDisabled("[data-testid=join-team]")) && (await staff.textContent("[data-testid=join-team]")).trim() === "Agree and join");
ok("join page fits 320px", await noSideways(staff));
await staff.check("[data-testid=join-agree]");
await staff.click("[data-testid=join-team]");
await staff.waitForURL((u) => u.pathname === "/library", { timeout: 30000 });
const staffUser = await prisma.user.findUnique({ where: { email: `fx-staff${stamp}@example.com` } });
ok("joined, and the agreement recorded", !!(await prisma.membership.findFirst({ where: { userId: staffUser.id, workspaceId: ws.id } })) && (await prisma.termsAcceptance.count({ where: { userId: staffUser.id } })) === 1);
ok("staff aren't sent to the welcome step", path(staff) === "/library");
await staff.click("[data-testid=menu-button]");
const staffMenu = await staff.locator("[data-testid=app-menu] a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
ok("staff menu: no Billing or Branding", !staffMenu.includes("/settings/billing") && !staffMenu.includes("/settings/branding") && staffMenu.includes("/settings/account"), staffMenu.join("|"));
ok("staff menu has a Settings section", await staff.isVisible("[data-testid=menu-settings]"));
// The menu drops from the bar itself, over the banner asking staff for their name.
const bar = await staff.locator("header > div").first().boundingBox();
const menuBox = await staff.locator("[data-testid=app-menu]").boundingBox();
ok("phone menu opens right under the bar, over any banner", !!bar && !!menuBox && Math.abs(menuBox.y - (bar.y + bar.height)) < 2, JSON.stringify({ bar, menuBox }));
await staff.screenshot({ path: `${shots}/fx-shell-staff-menu-320.png` });
await staff.keyboard.press("Escape");
await staff.goto(`${BASE}/team`);
ok("staff get a proper Team page", !!(await staff.waitForSelector("[data-testid=staff-team]", { timeout: 15000 }).catch(() => null)));
ok("staff Team page fits 320px", await noSideways(staff));
await staff.screenshot({ path: `${shots}/fx-shell-staff-team-320.png`, fullPage: true });
const help = await staff.locator("[data-testid=help-button]").boundingBox();
ok("phone: the Help button is small", !!help && help.width <= 48 && help.height <= 48, JSON.stringify(help));
ok("phone: the page has room under its last line for it", (await staff.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom))) >= 64);

await owner.goto(`${BASE}/team`);
await owner.waitForSelector("text=Reassign clients");
ok("owner Team page: clear wording for unassigned clients", (await owner.isVisible("option:text('Unassigned (owner and admins)')").catch(() => false)) || (await owner.locator("option", { hasText: "Unassigned (owner and admins)" }).count()) === 1);
ok("no 'Shared (nobody)'", (await owner.locator("text=Shared (nobody)").count()) === 0);
ok("Emails to you aren't on the Team page", (await owner.locator("h2:text('Emails to you')").count()) === 0);
await owner.goto(`${BASE}/settings/account`);
ok("they're with the owner's own settings", (await owner.locator("#emails input[name=replyNotify]").count()) === 4);
const teamNav = await owner.locator("header nav a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
ok("with staff, the bar has Team", teamNav.includes("/team"));

await owner.goto(`${BASE}/settings/team`);
await owner.click("[data-testid=remove-member]");
await owner.waitForSelector("[data-testid=team-dialog]");
ok("removing: an in-page confirmation", (await owner.textContent("[data-testid=team-dialog]")).includes(`Remove `));
ok("lists the client who gets the new link by email", (await owner.textContent("[data-testid=remove-emailed]")).includes("Client A"));
ok("and the one with no email", (await owner.textContent("[data-testid=remove-no-email]")).includes("Client B"));
await owner.screenshot({ path: `${shots}/fx-shell-remove-dialog.png` });
await owner.click("[data-testid=dialog-confirm]");
await owner.waitForSelector("[data-testid=key-reset]", { timeout: 30000 });
ok("their new link to copy, right there", (await owner.textContent("[data-testid=key-reset]")).includes("Client B") && (await owner.isVisible("[data-testid=key-reset] >> text=Copy new link")));

await staff.goto(`${BASE}/library`);
await staff.waitForURL((u) => u.pathname === "/welcome", { timeout: 15000 }).catch(() => {});
ok("removed staff are told plainly", !!(await staff.waitForSelector("[data-testid=removed-from-team]", { timeout: 15000 }).catch(() => null)) && (await staff.textContent("[data-testid=removed-from-team]")).includes("Business A"));
await staff.screenshot({ path: `${shots}/fx-shell-removed-320.png`, fullPage: true });

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
