// The support console (/support/lookup, /support/workspaces/[id], /support/users/[id], /support/log), driven as the
// support admin on a phone-sized screen: every power through its own form, checking the change, the email in the
// outbox and the support-log row, the typed confirmations, refusals (seats full, own login, support-closed accounts),
// that non-admins get a 404, and that the complimentary-plan forms on /support/accounts are logged too.
// Needs the app running with AUTH_DEV_LOGIN=true, SUPPORT_EMAIL=owner@test.dev (the support admin), local file
// storage, no RESEND_API_KEY (mail goes to .data/outbox), and STRIPE_API_BASE=http://localhost:12111 with
// STRIPE_SECRET_KEY=sk_test_fake (this suite starts the fake Stripe).
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { start, state, createSubscription } from "./fake-stripe.mjs";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ADMIN = "owner@test.dev";
const shots = process.argv[2] ?? "/tmp";
mkdirSync(shots, { recursive: true });
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
const server = await start();
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};
const D = 86_400_000;
const stamp = Date.now();
const outbox = () => (existsSync(".data/outbox") ? readdirSync(".data/outbox").sort().map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8"))) : []);
const mailTo = (to) => outbox().filter((m) => m.to === to);
async function waitMail(to, pred = () => true, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
    const m = mailTo(to).find(pred);
    if (m) return m;
  }
  return null;
}
const norm = (s) => (s ?? "").replace(/[\s  ]+/g, " ").trim();
const uploads = path.resolve(".data/uploads");
const putFile = (key) => {
  mkdirSync(path.dirname(path.join(uploads, key)), { recursive: true });
  writeFileSync(path.join(uploads, key), "encrypted bytes");
};
const has = (key) => existsSync(path.join(uploads, key));
const lastAction = (where) => prisma.adminAction.findFirst({ where, orderBy: { createdAt: "desc" } });
// The support pages and support's emails give dates in Queensland time, written one way: "18 Oct 2026" (lib/support/when.ts).
const qldDay = (d) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", year: "numeric" }).format(d);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
async function signIn(email, next = "/library", { phone = false, lands = next.split("?")[0] } = {}) {
  // Agreed to the current Terms and Privacy Policy, so signing in isn't stopped at /agree (e2e/agree.mjs).
  await agreed(email);
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname === lands, { timeout: 60000 });
  // The address bar can change before the server has rendered the page (and made a new account's workspace): wait for it.
  await page.waitForSelector("main", { timeout: 60000 });
  return page;
}

// The support admin, on a phone.
const admin = await signIn(ADMIN, "/support", { phone: true });
const adminUser = await prisma.user.findUnique({ where: { email: ADMIN }, include: { memberships: true } });
let wide = [];
/** Opens a console page and checks it fits a phone screen (no sideways scrolling). */
async function open(p) {
  const r = await admin.goto(BASE + p);
  await admin.waitForLoadState("networkidle").catch(() => {});
  const [sw, cw] = await admin.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  if (sw > cw + 1) wide.push(`${p} (${sw} > ${cw})`);
  return r;
}
// innerText: what's on screen (labels and values apart, closed forms left out).
const text = async (sel) => norm(await admin.innerText(sel).catch(() => ""));

/**
 * Opens a power's form (by its data-testid), fills it and sends it. Returns { done, message, actionId }:
 * done when the page reloaded with its "Done" banner, else the form's error message.
 */
async function power(testId, { category, reason, confirm, fields = {}, checks = {}, before } = {}) {
  const box = admin.locator(`[data-testid="${testId}"]`);
  if ((await box.count()) === 0) return { done: false, message: `no form ${testId}` };
  if (!(await box.evaluate((d) => d.open))) await box.locator("summary").click();
  if (before) await before(box);
  if (category) await box.locator('select[name="category"]').selectOption(category);
  for (const [name, value] of Object.entries(fields)) await box.locator(`[name="${name}"]`).fill(String(value));
  for (const [name, on] of Object.entries(checks)) await box.locator(`input[name="${name}"]`).setChecked(on);
  if (reason !== undefined) await box.locator('textarea[name="reason"]').fill(reason);
  if (confirm !== undefined) await box.locator('input[name="confirm"]').fill(confirm);
  const prev = new URL(admin.url()).searchParams.get("done");
  const [resp] = await Promise.all([
    admin.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"], { timeout: 120000 }),
    box.locator("button").click(),
  ]);
  if (resp.headers()["x-action-redirect"]) {
    await admin.waitForURL((u) => !!u.searchParams.get("done") && u.searchParams.get("done") !== prev, { timeout: 60000 });
    await admin.waitForSelector("[data-testid=done]", { timeout: 60000 });
    const [sw, cw] = await admin.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    if (sw > cw + 1) wide.push(`${new URL(admin.url()).pathname} after ${testId}`);
    return { done: true, message: await text("[data-testid=done]"), actionId: new URL(admin.url()).searchParams.get("done") };
  }
  // The form's answer is on screen once it's no longer busy.
  await box.locator("button:not([disabled])").waitFor({ timeout: 30000 });
  return { done: false, message: norm(await box.locator('[role="alert"]').textContent({ timeout: 5000 }).catch(() => "")) };
}

// The workspace is made as the first page renders, so it can arrive a moment after the page's address.
async function ownWorkspace(userId) {
  for (let i = 0; i < 40; i++) {
    const m = await prisma.membership.findFirst({ where: { userId, role: "OWNER" } });
    if (m) return m.workspaceId;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no workspace for ${userId}`);
}

// =====================================================================================================
// The businesses
// =====================================================================================================
// A: Solo, paying through Stripe, with a staff member and two clients.
const aEmail = `con-a${stamp}@example.com`;
const aOwner = await signIn(aEmail);
const aUser = await prisma.user.findUnique({ where: { email: aEmail } });
const wsA = await ownWorkspace(aUser.id);
const aName = `Console A ${stamp}`;
const aCustomer = `cus_cona${stamp}`;
const aSub = createSubscription(aCustomer, wsA, "sureframe_solo_monthly");
await prisma.workspace.update({
  where: { id: wsA },
  data: { name: aName, plan: "SOLO", stripeCustomerId: aCustomer, stripeSubscriptionId: aSub.id, subscriptionStatus: "active", billingInterval: "month", currentPeriodEnd: new Date(Date.now() + 30 * D) },
});
const samEmail = `con-sam${stamp}@example.com`;
const sam = await prisma.user.create({ data: { email: samEmail, name: "Sam Staff" } });
await prisma.membership.create({ data: { userId: sam.id, workspaceId: wsA, role: "MEMBER" } });
const samPage = await signIn(samEmail);
const mkClient = (workspaceId, name, email, data = {}) =>
  prisma.client.create({ data: { name, email, token: `cn-${stamp}-${Math.random().toString(36).slice(2)}-${"x".repeat(16)}`, workspaceId, ...data } });
const ana = await mkClient(wsA, `Ana ${stamp}`, `con-ana${stamp}@example.com`);
const aVideo = await prisma.video.create({ data: { id: `cna${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/con-a`, status: "UPLOADED", workspaceId: wsA, ownerId: aUser.id, clientId: ana.id } });
putFile(aVideo.storageKey);

// B: Free (3 client seats), three active clients (and, in section 9, one being deleted).
const bEmail = `con-b${stamp}@example.com`;
const bOwner = await signIn(bEmail);
const bUser = await prisma.user.findUnique({ where: { email: bEmail } });
const wsB = await ownWorkspace(bUser.id);
const bName = `Console B ${stamp}`;
await prisma.workspace.update({ where: { id: wsB }, data: { name: bName, videosRecorded: 7 } });
await mkClient(wsB, `Bea ${stamp}`, null, { createdAt: new Date(Date.now() - 8 * D) });
await mkClient(wsB, `Bob ${stamp}`, null, { createdAt: new Date(Date.now() - 7 * D) });
const b3 = await mkClient(wsB, `Bix ${stamp}`, null, { createdAt: new Date(Date.now() - 6 * D) });

// C closes their own account; D asks for theirs to be deleted now; E is closed by support (with a staff member, Fay).
const cEmail = `con-c${stamp}@example.com`;
const cPage = await signIn(cEmail);
const cUser = await prisma.user.findUnique({ where: { email: cEmail } });
const dEmail = `con-d${stamp}@example.com`;
await signIn(dEmail);
const dUser = await prisma.user.findUnique({ where: { email: dEmail } });
const wsD = await ownWorkspace(dUser.id);
const dCustomer = `cus_cond${stamp}`;
const dSub = createSubscription(dCustomer, wsD, "sureframe_solo_monthly");
await prisma.workspace.update({ where: { id: wsD }, data: { name: `Console D ${stamp}`, plan: "SOLO", stripeCustomerId: dCustomer, stripeSubscriptionId: dSub.id, subscriptionStatus: "active" } });
const dVideo = await prisma.video.create({ data: { id: `cnd${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/con-d`, status: "UPLOADED", workspaceId: wsD, ownerId: dUser.id } });
putFile(dVideo.storageKey);
const eEmail = `con-e${stamp}@example.com`;
await signIn(eEmail);
const eUser = await prisma.user.findUnique({ where: { email: eEmail } });
const wsE = await ownWorkspace(eUser.id);
const eCustomer = `cus_cone${stamp}`;
const eSub = createSubscription(eCustomer, wsE, "sureframe_studio_monthly");
const eName = `Console E ${stamp}`;
await prisma.workspace.update({ where: { id: wsE }, data: { name: eName, plan: "STUDIO", stripeCustomerId: eCustomer, stripeSubscriptionId: eSub.id, subscriptionStatus: "active" } });
const fayEmail = `con-fay${stamp}@example.com`;
const fay = await prisma.user.create({ data: { email: fayEmail, name: "Fay Staff" } });
await prisma.membership.create({ data: { userId: fay.id, workspaceId: wsE, role: "MEMBER" } });

// =====================================================================================================
// Who can open the console
// =====================================================================================================
// Someone signed in who doesn't answer support is sent to Help, never shown the console (V60).
const sentToHelp = async (page, p) => {
  await page.goto(BASE + p);
  const there = await page.waitForURL((u) => u.pathname === "/help", { timeout: 15000 }).then(() => true, () => false);
  return there && !(await page.isVisible("[data-testid=back-to-app]")) && !norm(await page.textContent("body")).includes("Support log");
};
for (const p of ["/support/lookup?q=example.com", `/support/workspaces/${wsA}`, `/support/users/${aUser.id}`, "/support/log"]) {
  ok(`not an agent: ${p.split("?")[0]} sends them to Help`, await sentToHelp(bOwner, p));
}
ok("not an admin: sees nothing of the console", !(await bOwner.isVisible("text=Support powers")) && !(await bOwner.isVisible(`text=${aEmail}`)));
const anon = await (await browser.newContext()).newPage();
await anon.goto(`${BASE}/support/workspaces/${wsA}`);
ok("signed out: sent to sign in", await anon.waitForURL((u) => u.pathname === "/login", { timeout: 30000 }).then(() => true, () => false));

await open("/settings");
ok("Settings marks Support as for SureFrame staff only (P2)", (await text("[data-testid=settings-index] a[href='/support'] [data-testid=settings-tag]")) === "SureFrame staff only");
await open("/support/inbox");
ok("/support/inbox goes to the inbox (P57)", new URL(admin.url()).pathname === "/support", admin.url());
await open("/support");
ok("inbox links to the console", (await admin.locator('a[href="/support/lookup"]').count()) === 1 && (await admin.locator('a[href="/support/log"]').count()) === 1);
ok("the free plans link is still there", (await admin.locator('a[href="/support/accounts"]').count()) >= 1);

// =====================================================================================================
// Look up
// =====================================================================================================
await open(`/support/lookup?q=${encodeURIComponent(aEmail)}`);
ok("lookup by email: the login", (await text("[data-testid=results-users]")).includes(aEmail));
ok("a login result names its workspace and plan (P38)", (await text("[data-testid=results-users] [data-testid=user-workspaces]")).includes(`${aName} (Solo, owner)`), await text("[data-testid=results-users]"));
await admin.screenshot({ path: `${shots}/lookup-phone.png`, fullPage: true });
await open(`/support/lookup?q=${encodeURIComponent(`console a ${stamp}`)}`);
ok("lookup by workspace name (any case): the workspace and its owner", (await text("[data-testid=results-workspaces]")).includes(aName) && (await text("[data-testid=results-workspaces]")).includes(aEmail));
await open(`/support/lookup?q=${encodeURIComponent(ana.email)}`);
ok("lookup by client email: the client and whose client", (await text("[data-testid=results-clients]")).includes(`Ana ${stamp}`) && (await text("[data-testid=results-clients]")).includes(`Client of ${aName}`));
await open(`/support/lookup?q=${aVideo.id}`);
ok("lookup by video id: its workspace", (await text("[data-testid=results-video]")).includes(aName));
await open(`/support/lookup?q=${aCustomer}`);
ok("lookup by Stripe customer id", (await text("[data-testid=results-workspaces]")).includes(aName));
await open("/support/lookup?q=");
ok("an empty search says what's needed (P38)", (await text("[data-testid=search-too-short]")) === "Type at least 2 characters.");
await open(`/support/lookup?q=nobody-${stamp}`);
ok("lookup: says when nothing matches", (await admin.locator("[data-testid=no-results]").count()) === 1);
await open(`/support/lookup?q=${encodeURIComponent(aEmail)}`);
await admin.click(`[data-testid=results-users] a`);
await admin.waitForURL((u) => u.pathname === `/support/users/${aUser.id}`);
ok("a result opens the login's page", (await text("h1")).includes(aEmail));

// =====================================================================================================
// The workspace page: status
// =====================================================================================================
await open(`/support/workspaces/${wsA}`);
let status = await text("[data-testid=ws-status]");
const aPeriodEnd = (await prisma.workspace.findUnique({ where: { id: wsA } })).currentPeriodEnd;
ok("status: owner, plan, subscription, renewal", status.includes(aEmail) && status.includes("Solo, billed every month") && status.includes("Subscription active") && status.includes(`Renews ${qldDay(aPeriodEnd)}`), status);
ok("status: Stripe Dashboard links for the customer and subscription", (await admin.locator(`a[href="https://dashboard.stripe.com/test/customers/${aCustomer}"]`).count()) === 1 && (await admin.locator(`a[href="https://dashboard.stripe.com/test/subscriptions/${aSub.id}"]`).count()) === 1);
ok("status: not suspended, closed or held", status.includes("Suspended No") && status.includes("Closed by support No") && status.includes("Legal hold Off") && status.includes("Deletion Not scheduled"), status);
ok("status: members and clients listed with link state", (await text("main")).includes(samEmail) && (await text(`[data-testid=client-${ana.id}]`)).includes("Link works"));
await admin.screenshot({ path: `${shots}/workspace-phone.png`, fullPage: true });

// =====================================================================================================
// 1. Warning
// =====================================================================================================
// The browser asks for a reason before sending; without that check the server refuses too.
let r = await power("power-warn", {
  category: "terms",
  before: (box) => box.evaluate((d) => d.querySelectorAll("[required]").forEach((e) => e.removeAttribute("required"))),
});
ok("no reason: refused with a clear message", !r.done && r.message.includes("Write the reason for this"), r.message);
r = await power("power-warn", { reason: "r".repeat(500) + "x".repeat(10), category: "terms", before: (box) => box.evaluate((d) => d.querySelector("textarea[name=reason]").removeAttribute("maxlength")) });
ok("a reason over 500 characters: refused", !r.done && r.message.includes("500 characters"), r.message);
ok("refusals changed nothing and logged nothing", !(await prisma.adminAction.findFirst({ where: { workspaceId: wsA } })));
r = await power("power-warn", { category: "terms", reason: "Two spam complaints this week", fields: { message: "Please only send videos to people who asked for them." } });
ok("warning: done banner", r.done && r.message.includes("Done: Warning sent") && r.message.includes(`Emailed ${aEmail}`), r.message);
let mail = await waitMail(aEmail, (m) => m.subject === "A warning about your SureFrame account");
ok("warning: emailed to the owner with the message and review route, replies to support", !!mail && norm(mail.text).includes("Please only send videos to people who asked for them.") && mail.text.includes("within 30 days") && mail.replyTo === ADMIN && !mail.text.includes("spam complaints"));
let row = await lastAction({ workspaceId: wsA, action: "account.warn" });
ok("warning: logged with the admin, reason and target", row?.actorEmail === ADMIN && row.reason === "Two spam complaints this week" && row.target === `${aName} (${aEmail})`);
ok("warning: shown in the workspace's support log", (await text("[data-testid=history]")).includes("Warning sent") && (await text("[data-testid=history]")).includes("Two spam complaints this week"));

// =====================================================================================================
// 2. Suspend and unsuspend the workspace (renewal stopped, then resumed)
// =====================================================================================================
r = await power("power-suspendWorkspace", { category: "fraud", reason: "Card testing pattern", fields: { note: "Please email us about recent payments." }, checks: { stopRenewal: true } });
ok("suspend: done, renewal stopped, owner emailed", r.done && r.message.includes("Workspace suspended") && r.message.includes("Renewal stopped") && r.message.includes(`Emailed ${aEmail}`), r.message);
let w = await prisma.workspace.findUnique({ where: { id: wsA } });
ok("suspend: suspended with the internal reason and the members' note", !!w.suspendedAt && w.suspendedReason === "Card testing pattern" && w.suspendedNote === "Please email us about recent payments.");
ok("suspend: Stripe set to end at the period's end", state.subs.find((s) => s.id === aSub.id)?.cancel_at_period_end === true);
ok("suspend: page shows it", (await text("[data-testid=ws-badges]")).includes("Suspended") && (await text("[data-testid=ws-status]")).includes("Reason: Card testing pattern"));
mail = await waitMail(aEmail, (m) => m.subject === "Your SureFrame account has been suspended");
ok("suspend: owner emailed (renewal ends), reason not included", !!mail && norm(mail.text).includes("won't renew") && !mail.text.includes("Card testing"));
await aOwner.goto(BASE + "/library");
// Pages stream (app/loading.tsx), so a redirect happens in the browser after the page loads.
const lands = (page, p, timeout = 30000) => page.waitForURL((u) => u.pathname === p, { timeout }).then(() => true, () => false);
await lands(aOwner, "/suspended");
ok("suspend: the owner sees the suspended page with the note", new URL(aOwner.url()).pathname === "/suspended" && (await aOwner.textContent("[data-testid=suspended-note]"))?.includes("Please email us about recent payments."));
ok("unsuspend offers Resume renewal, ticked", await admin.locator("[data-testid=power-unsuspendWorkspace] input[name=resumeRenewal]").isChecked());
r = await power("power-unsuspendWorkspace", { reason: "Owner explained the payments" });
ok("unsuspend: done, renewal resumed", r.done && r.message.includes("Workspace unsuspended") && r.message.includes("Renewal: resumed"), r.message);
ok("unsuspend: cleared and renewing again", !(await prisma.workspace.findUnique({ where: { id: wsA } })).suspendedAt && state.subs.find((s) => s.id === aSub.id)?.cancel_at_period_end === false);
ok("unsuspend: owner emailed", !!(await waitMail(aEmail, (m) => m.subject === "Your SureFrame account is no longer suspended")));
await aOwner.goto(BASE + "/library");
await aOwner.waitForLoadState("networkidle").catch(() => {});
ok("unsuspend: the owner is back in", !(await lands(aOwner, "/suspended", 3000)) && new URL(aOwner.url()).pathname === "/library");

// =====================================================================================================
// 5. Legal hold on and off (nobody is emailed)
// =====================================================================================================
const mailsBefore = mailTo(aEmail).length;
r = await power("power-legalHoldOn", { reason: "Preservation request from police, ref 123" });
ok("legal hold on: done", r.done && r.message.includes("Legal hold on"), r.message);
ok("legal hold on: set and shown", !!(await prisma.workspace.findUnique({ where: { id: wsA } })).legalHoldAt && (await text("[data-testid=ws-badges]")).includes("Legal hold"));
r = await power("power-legalHoldOff", { reason: "Request withdrawn" });
ok("legal hold off: cleared", r.done && !(await prisma.workspace.findUnique({ where: { id: wsA } })).legalHoldAt);
await new Promise((res) => setTimeout(res, 1000));
ok("legal hold: nobody emailed", mailTo(aEmail).length === mailsBefore);

// =====================================================================================================
// 6. A client's link off and on
// =====================================================================================================
r = await power(`power-linkOff-${ana.id}`, { category: "safety", reason: "Link was posted publicly" });
ok("link off: done", r.done && r.message.includes("Client's link turned off"), r.message);
ok("link off: set and shown", !!(await prisma.client.findUnique({ where: { id: ana.id } })).linkDisabledAt && (await text(`[data-testid=client-${ana.id}]`)).includes("Link off"));
ok("link off: owner emailed", !!(await waitMail(aEmail, (m) => m.subject === `Ana ${stamp}'s link has been turned off`)));
const anaPhone = await (await browser.newContext()).newPage();
await anaPhone.goto(`${BASE}/c/${ana.token}`);
ok("link off: the client's link says it's turned off", (await anaPhone.textContent("main")).includes("This link has been turned off"));
r = await power(`power-linkOn-${ana.id}`, { reason: "Owner confirmed it was their own post" });
ok("link on: cleared", r.done && !(await prisma.client.findUnique({ where: { id: ana.id } })).linkDisabledAt);
ok("link on: owner emailed", !!(await waitMail(aEmail, (m) => m.subject === `Ana ${stamp}'s link has been turned back on`)));

// =====================================================================================================
// 11. Re-sync billing from Stripe, after a missed webhook
// =====================================================================================================
await prisma.workspace.update({ where: { id: wsA }, data: { plan: "FREE", subscriptionStatus: null, billingInterval: null } });
await open(`/support/workspaces/${wsA}`);
r = await power("power-resyncBilling", { reason: "Webhook missed during an outage", checks: { notify: false } });
ok("re-sync: done, says what changed", r.done && r.message.includes("Billing re-synced from Stripe") && r.message.includes("Changed: plan, subscriptionStatus, billingInterval"), r.message);
w = await prisma.workspace.findUnique({ where: { id: wsA } });
ok("re-sync: plan and status back from Stripe", w.plan === "SOLO" && w.subscriptionStatus === "active" && w.billingInterval === "month", JSON.stringify(w));
row = await lastAction({ workspaceId: wsA, action: "billing.resync" });
ok("re-sync: logged with before and after", row?.details?.status === "done" && row.details.before.plan === "FREE" && row.details.after.plan === "SOLO" && row.details.notify === false);
// The subscription on file is wrong, but the customer's live one for this workspace is found and followed.
await prisma.workspace.update({ where: { id: wsA }, data: { stripeSubscriptionId: `sub_stale${stamp}` } });
await open(`/support/workspaces/${wsA}`);
r = await power("power-resyncBilling", { reason: "Subscription id looks wrong" });
ok("re-sync: follows the customer's live subscription", r.done && r.message.includes("Changed: stripeSubscriptionId") && (await prisma.workspace.findUnique({ where: { id: wsA } })).stripeSubscriptionId === aSub.id, r.message);

// =====================================================================================================
// 3 and 7. A login: suspend, unsuspend, sign out everywhere
// =====================================================================================================
await open(`/support/users/${sam.id}`);
r = await power("power-suspendUser", { category: "security", reason: "Login shared outside the business" });
ok("suspend login: done", r.done && r.message.includes("Login suspended") && r.message.includes(`Emailed ${samEmail}`), r.message);
ok("suspend login: set and shown", !!(await prisma.user.findUnique({ where: { id: sam.id } })).suspendedAt && (await text("[data-testid=user-badges]")).includes("Login suspended"));
await samPage.goto(BASE + "/library");
ok("suspend login: they see the suspended page", await lands(samPage, "/suspended"));
ok("suspend login: emailed", !!(await waitMail(samEmail, (m) => m.subject === "Your SureFrame login has been suspended")));
r = await power("power-unsuspendUser", { reason: "Owner reset the password manager" });
ok("unsuspend login: cleared and emailed", r.done && !(await prisma.user.findUnique({ where: { id: sam.id } })).suspendedAt && !!(await waitMail(samEmail, (m) => m.subject === "Your SureFrame login is no longer suspended")));
r = await power("power-signOutEverywhere", { reason: "Lost phone" });
ok("sign out everywhere: done", r.done && r.message.includes("Signed out everywhere"), r.message);
ok("sign out everywhere: recorded on the login and shown", !!(await prisma.user.findUnique({ where: { id: sam.id } })).sessionsValidAfter && !(await text("[data-testid=user-status]")).includes("Signed out everywhere Never"));
ok("sign out everywhere: says support did it (P50)", (await text("[data-testid=user-status]")).includes("(support pressed Sign out everywhere)"), await text("[data-testid=user-status]"));
await samPage.goto(BASE + "/library");
ok("sign out everywhere: their browser is signed out", await lands(samPage, "/login"));
ok("sign out everywhere: emailed", !!(await waitMail(samEmail, (m) => m.subject === "You've been signed out of SureFrame everywhere")));
await admin.screenshot({ path: `${shots}/user-phone.png`, fullPage: true });

// =====================================================================================================
// Not on your own login or workspace
// =====================================================================================================
await open(`/support/users/${adminUser.id}`);
ok("own login: no powers, and says why", (await text("main")).includes("This is your own login") && (await admin.locator("[data-testid^=power-]").count()) === 0);
if (adminUser.memberships[0]) {
  await open(`/support/workspaces/${adminUser.memberships[0].workspaceId}`);
  ok("own workspace: no powers, and says why", (await text("main")).includes("You belong to this workspace") && (await admin.locator("[data-testid^=power-]").count()) === 0);
}
// Even a form changed to point at the admin's own login is refused by the server.
await open(`/support/users/${bUser.id}`);
const adminSignedOut = (await prisma.user.findUnique({ where: { id: adminUser.id } })).sessionsValidAfter;
r = await power("power-signOutEverywhere", { reason: "test", before: (box) => box.evaluate((d, id) => (d.querySelector("input[name=userId]").value = id), adminUser.id) });
ok("own login: refused by the server too", !r.done && r.message.includes("You can't use this on your own login."), r.message);
ok("own login: nothing changed", (await prisma.user.findUnique({ where: { id: adminUser.id } })).sessionsValidAfter?.getTime() === adminSignedOut?.getTime());

// A subscription Stripe doesn't have, with nothing else on the customer, is forgotten (B was on Solo).
await prisma.workspace.update({ where: { id: wsB }, data: { plan: "SOLO", stripeCustomerId: `cus_conb${stamp}`, stripeSubscriptionId: `sub_goneb${stamp}`, subscriptionStatus: "active" } });
await open(`/support/workspaces/${wsB}`);
r = await power("power-resyncBilling", { reason: "Subscription deleted in the Dashboard" });
ok("re-sync: a subscription Stripe doesn't have is forgotten", r.done && r.message.includes("Stripe no longer has the subscription; it was forgotten"), r.message);
w = await prisma.workspace.findUnique({ where: { id: wsB } });
ok("re-sync: back on Free without it", w.plan === "FREE" && !w.stripeSubscriptionId && !w.subscriptionStatus, JSON.stringify(w));

// =====================================================================================================
// 10. Free videos used
// =====================================================================================================
await open(`/support/workspaces/${wsB}`);
ok("free videos used shown as x of 25", (await text("[data-testid=videos-used]")).includes("7 of 25"));
r = await power("power-setVideosRecorded", { reason: "test", fields: { value: -1 }, before: (box) => box.evaluate((d) => d.querySelector("input[name=value]").removeAttribute("min")) });
ok("free videos used: a negative number is refused", !r.done && r.message.includes("whole number"), r.message);
r = await power("power-setVideosRecorded", { reason: "Uploads failed during our outage on Oct 2", fields: { value: 4 } });
ok("free videos used: done, before and after", r.done && r.message.includes("Free videos used set") && r.message.includes("7 → 4"), r.message);
ok("free videos used: set and shown", (await prisma.workspace.findUnique({ where: { id: wsB } })).videosRecorded === 4 && (await text("[data-testid=videos-used]")).includes("4 of 25"));
mail = await waitMail(bEmail, (m) => m.subject === "We've corrected your count of videos");
ok("free videos used: owner emailed how many are left", !!mail && norm(mail.text).includes("It's now 4.") && norm(mail.text).includes("That's 4 of the Free plan's 25 videos used, so you have 21 left."), mail?.text);
ok("free videos used: the email's button opens that workspace", !!mail && mail.text.includes(`/library?ws=${wsB}`), mail?.text);
// With a recording still uploading, the email says why the two numbers differ.
const uploadingB = await prisma.video.create({ data: { id: `conup${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/con-up`, status: "RECORDING", workspaceId: wsB, ownerId: bUser.id } });
r = await power("power-setVideosRecorded", { reason: "Second correction", fields: { value: 5 } });
mail = await waitMail(bEmail, (m) => m.subject === "We've corrected your count of videos" && norm(m.text).includes("It's now 5."));
ok("free videos used: counts a recording still uploading, and says so", r.done && !!mail && norm(mail.text).includes("It's now 5.") && norm(mail.text).includes("That's 6 of the Free plan's 25 videos used, including 1 recording still uploading, so you have 19 left."), mail?.text);
await prisma.video.delete({ where: { id: uploadingB.id } });
await prisma.workspace.update({ where: { id: wsB }, data: { videosRecorded: 4 } });

// =====================================================================================================
// 9. A client being deleted (the business deleted them; the clean-up job hasn't finished): Finish deleting now
// =====================================================================================================
// Made just before, as any job run (another suite's included) finishes a deleted client (lib/clientRemoval.ts).
const eve = await mkClient(wsB, `Eve ${stamp}`, `con-eve${stamp}@example.com`, { removedAt: new Date(Date.now() - 60000), purgeAt: new Date(Date.now() - 60000) });
const eveVideo = await prisma.video.create({ data: { id: `cne${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/con-eve`, status: "UPLOADED", workspaceId: wsB, ownerId: bUser.id, clientId: eve.id } });
putFile(eveVideo.storageKey);
await open(`/support/workspaces/${wsB}`);
ok("clients being deleted are listed, with no restore or keep", (await text(`[data-testid=removed-${eve.id}]`)).includes("Deleted by the business") && !(await admin.locator("[data-testid^=power-restoreClient-], [data-testid^=power-keepClient-]").count()));
r = await power(`power-deleteClientNow-${eve.id}`, { reason: "Client asked the business to erase their data", confirm: "DELETE eve" });
ok("delete client now: the wrong confirmation is refused", !r.done && r.message.includes(`Type DELETE ${eve.email} to confirm.`) && !!(await prisma.client.findUnique({ where: { id: eve.id } })), r.message);
r = await power(`power-deleteClientNow-${eve.id}`, { reason: "Client asked the business to erase their data", confirm: `DELETE ${eve.email}` });
ok("delete client now: done", r.done && r.message.includes("Removed client deleted now"), r.message);
ok("delete client now: the client, their video and its file are gone", !(await prisma.client.findUnique({ where: { id: eve.id } })) && !(await prisma.video.findUnique({ where: { id: eveVideo.id } })) && !has(eveVideo.storageKey));
ok("delete client now: owner emailed", !!(await waitMail(bEmail, (m) => m.subject === `Eve ${stamp} has been deleted`)));
row = await lastAction({ clientId: eve.id, action: "client.delete_now" });
ok("delete client now: logged as done, survives the client", row?.details?.status === "done" && row.target.includes(eve.email));

// =====================================================================================================
// 11. Seat check
// =====================================================================================================
// Drift: a fourth client got in without a pause (say a bug), so four clients can use a 3-seat plan.
await mkClient(wsB, `Cy ${stamp}`, null, { createdAt: new Date(Date.now() - 9 * D) });
const pauseMails = mailTo(bEmail).filter((m) => m.subject === "Some of your clients or staff are paused").length;
await open(`/support/workspaces/${wsB}`);
r = await power("power-seatCheck", { reason: "Four clients active on Free" });
ok("seat check: done, says what changed", r.done && r.message.includes("Seat check re-run") && r.message.includes("Paused clients 0 → 1"), r.message);
ok("seat check: the newest over the plan is paused again", !!(await prisma.client.findUnique({ where: { id: b3.id } })).pausedAt);
ok("seat check: owner emailed about the pause", !!(await waitMail(bEmail, (m) => m.subject === "Some of your clients or staff are paused" && mailTo(bEmail).filter((x) => x.subject === m.subject).length > pauseMails)));

// =====================================================================================================
// 4. Close permanently (block + legal hold), then reopen after a review
// =====================================================================================================
await open(`/support/users/${eUser.id}`);
r = await power("power-closeAccount", { category: "unlawful", reason: "Used to send threats", confirm: `CLOSE someone@example.com`, checks: { blockEmail: true, legalHold: true } });
await admin.locator("[data-testid=power-closeAccount]").screenshot({ path: `${shots}/close-form-phone.png` });
ok("close: the wrong confirmation is refused", !r.done && r.message.includes(`Type CLOSE ${eEmail} to confirm.`) && !(await prisma.user.findUnique({ where: { id: eUser.id } })).closedAt, r.message);
r = await power("power-closeAccount", { category: "unlawful", reason: "Used to send threats", confirm: `CLOSE ${eEmail}`, checks: { blockEmail: true, legalHold: true } });
ok("close: done", r.done && r.message.includes("Account closed permanently") && r.message.includes("Address blocked") && r.message.includes("Legal hold set"), r.message);
const eRow = await prisma.user.findUnique({ where: { id: eUser.id } });
w = await prisma.workspace.findUnique({ where: { id: wsE } });
ok("close: login and workspace closed, deletion in 44 days (the review time plus two weeks), legal hold on", !!eRow.closedAt && !!w.closedAt && !!w.legalHoldAt && Math.abs(eRow.deleteAt.getTime() - Date.now() - 44 * D) < 120_000);
ok("close: subscription cancelled now", state.subs.find((s) => s.id === eSub.id)?.status === "canceled");
ok("close: staff taken off the team", !(await prisma.membership.findFirst({ where: { userId: fay.id, workspaceId: wsE } })));
ok("close: address blocked", !!(await prisma.blockedEmail.findUnique({ where: { emailHash: createHash("sha256").update(eEmail).digest("hex") } })));
ok("close: emailed", !!(await waitMail(eEmail, (m) => m.subject === "Your SureFrame account has been closed")) && !!(await waitMail(fayEmail, (m) => m.subject === `You're no longer on ${eName}'s team`)));
const eBadges = await text("[data-testid=user-badges]");
ok("close: page shows closed, deletion date, blocked, legal hold", eBadges.includes("Closed by support") && eBadges.includes(`Deletion ${qldDay(eRow.deleteAt)}`) && eBadges.includes("Email blocked") && eBadges.includes("Legal hold"), eBadges);
ok("close: no Cancel deletion for a support-closed account; Reopen instead", (await admin.locator("[data-testid=power-cancelDeletion]").count()) === 0 && (await admin.locator("[data-testid=power-reopenAccount]").count()) === 1);
ok("close: Delete now not offered under legal hold", (await text("main")).includes("Delete now isn’t available while legal hold is on"));
// The closed account can't sign in for its data, so support downloads it for them (DPA section 10).
ok("close: 'Download their data' offered", (await admin.locator("[data-testid=export-user] form[action='/api/support/export']").count()) === 1);
let exp = await admin.request.post(BASE + "/api/support/export", { form: { userId: eUser.id, reason: "" } });
ok("download their data: a reason is needed", exp.status() === 400);
exp = await admin.request.post(BASE + "/api/support/export", { form: { userId: eUser.id, reason: "Closed account asked for a copy within 30 days" } });
const expData = exp.ok() ? await exp.json() : null;
ok("download their data: the account's export, as a file", exp.ok() && /attachment/.test(exp.headers()["content-disposition"] ?? "") && expData?.user?.email === eEmail, String(exp.status()));
ok("download their data: logged", (await lastAction({ userId: eUser.id, action: "account.export" }))?.reason === "Closed account asked for a copy within 30 days");
ok("download their data: not for anyone but a support admin", (await bOwner.request.post(BASE + "/api/support/export", { form: { userId: eUser.id, reason: "x" } })).status() === 404);
ok("download their data: not from another site", (await admin.request.post(BASE + "/api/support/export", { form: { userId: eUser.id, reason: "x" }, headers: { "sec-fetch-site": "cross-site" } })).status() === 404);
await open(`/support/workspaces/${wsE}`);
status = await text("[data-testid=ws-status]");
ok("close: the workspace page shows closed, held, the deletion date and the blocked owner", status.includes("Owner's email blocked Yes") && /Closed by support \d{1,2} [A-Z][a-z]{2,3} 20\d\d, \d{1,2}:\d\d [ap]m AEST/.test(status) && status.includes("Legal hold On since") && status.includes(`Scheduled for ${qldDay(eRow.deleteAt)} (closed by support)`), status);

// =====================================================================================================
// 8. Cancel a scheduled deletion (their own closing), but never for a support-closed account
// =====================================================================================================
await cPage.goto(BASE + "/settings/account");
await cPage.fill('input[name="confirm"]', cEmail);
await cPage.click("text=Delete my account");
await cPage.click("[data-testid=delete-account-yes]");
await cPage.waitForURL((u) => u.pathname === "/login", { timeout: 60000 });
ok("C closed their own account", !!(await prisma.user.findUnique({ where: { id: cUser.id } })).deleteAt);
await open(`/support/users/${cUser.id}`);
ok("scheduled deletion shown", (await text("[data-testid=user-status]")).includes("Scheduled for"));
r = await power("power-cancelDeletion", { reason: "test", before: (box) => box.evaluate((d, id) => (d.querySelector("input[name=userId]").value = id), eUser.id) });
ok("cancel deletion: refused for a support-closed account", !r.done && r.message.includes("Support closed this account, so its deletion can't be cancelled"), r.message);
ok("cancel deletion: the closed account is untouched", !!(await prisma.user.findUnique({ where: { id: eUser.id } })).closedAt);
await admin.reload();
r = await power("power-cancelDeletion", { reason: "Customer emailed from their own address asking to keep it" });
ok("cancel deletion: done", r.done && r.message.includes("Scheduled deletion cancelled") && r.message.includes(`Emailed ${cEmail}`), r.message);
ok("cancel deletion: the account is kept", !(await prisma.user.findUnique({ where: { id: cUser.id } })).deleteAt);
ok("cancel deletion: emailed", !!(await waitMail(cEmail, (m) => m.subject === "Your SureFrame account won't be deleted")));

// =====================================================================================================
// 12. Unblock (from the lookup), reopen, and blocking an address on its own
// =====================================================================================================
await open(`/support/lookup?q=${encodeURIComponent(eEmail)}`);
ok("lookup by email: says it's blocked", (await text("[data-testid=blocked-state]")).includes("Blocked"));
r = await power("power-unblockEmail", { reason: "Review: the threats came from someone else" });
ok("unblock: done, lands on the login's page", r.done && r.message.includes("Email address unblocked") && new URL(admin.url()).pathname === `/support/users/${eUser.id}`, r.message);
ok("unblock: no longer blocked", !(await prisma.blockedEmail.findUnique({ where: { emailHash: createHash("sha256").update(eEmail).digest("hex") } })));
mail = await waitMail(eEmail, (m) => m.subject === "This email address can be used with SureFrame again");
ok("unblock: emailed, and says the closed account is still deleted on its date", !!mail && norm(mail.text).includes("no longer blocked from signing up") && norm(mail.text).includes("still deleted on"), mail?.text);
r = await power("power-reopenAccount", { reason: "Review: the threats came from someone else" });
ok("reopen: done", r.done && r.message.includes("Account reopened"), r.message);
ok("reopen: open again, no deletion", !(await prisma.user.findUnique({ where: { id: eUser.id } })).closedAt && !(await prisma.user.findUnique({ where: { id: eUser.id } })).deleteAt && !(await prisma.workspace.findUnique({ where: { id: wsE } })).closedAt);
ok("reopen: emailed", !!(await waitMail(eEmail, (m) => m.subject === "Your SureFrame account is open again")));
await open(`/support/users/${eUser.id}`);
ok("reopened: the signed-out-everywhere time says it came from the closure (P50)", (await text("[data-testid=user-status]")).includes("(when support closed the account)"), await text("[data-testid=user-status]"));
await open(`/support/workspaces/${wsE}`);
r = await power("power-legalHoldOff", { reason: "Review finished" });
ok("legal hold off after the review", r.done && !(await prisma.workspace.findUnique({ where: { id: wsE } })).legalHoldAt);

const stranger = `con-block${stamp}@example.com`;
await open(`/support/lookup?q=${encodeURIComponent(stranger)}`);
ok("an address that isn't blocked says so", (await text("[data-testid=blocked-state]")).includes("isn’t blocked"));
r = await power("power-blockEmail", { reason: "Ban evasion after a closure" });
ok("block on its own: done and blocked", r.done && r.message.includes("Email address blocked") && !!(await prisma.blockedEmail.findUnique({ where: { emailHash: createHash("sha256").update(stranger).digest("hex") } })), r.message);
r = await power("power-unblockEmail", { reason: "Typo in the address", checks: { notify: false } });
ok("unblock without the email: done, nobody emailed", r.done && r.message.includes("Not emailed (unticked)") && mailTo(stranger).length === 0, r.message);

// =====================================================================================================
// 8. Delete an account now
// =====================================================================================================
await open(`/support/users/${dUser.id}`);
r = await power("power-deleteAccountNow", { reason: "Verified request from the account's own address", confirm: `DELETE ${aEmail}` });
ok("delete now: the wrong confirmation is refused", !r.done && r.message.includes(`Type DELETE ${dEmail} to confirm.`) && !!(await prisma.user.findUnique({ where: { id: dUser.id } })), r.message);
ok("delete now: the refusal logged nothing", !(await prisma.adminAction.findFirst({ where: { userId: dUser.id, action: "account.delete_now" } })));
r = await power("power-deleteAccountNow", { reason: "Verified request from the account's own address", confirm: `DELETE ${dEmail}` });
ok("delete now: done, shown on the support log", r.done && r.message.includes("Account deleted now") && new URL(admin.url()).pathname === "/support/log", r.message);
ok("delete now: login, workspace and files gone", !(await prisma.user.findUnique({ where: { id: dUser.id } })) && !(await prisma.workspace.findUnique({ where: { id: wsD } })) && !has(dVideo.storageKey));
ok("delete now: subscription cancelled and customer deleted", state.subs.find((s) => s.id === dSub.id)?.status === "canceled" && state.deletedCustomers.includes(dCustomer));
mail = await waitMail(dEmail, (m) => m.subject === "Your SureFrame account has been deleted");
ok("delete now: emailed, replies go to support", !!mail && mail.replyTo === ADMIN);
row = await lastAction({ userId: dUser.id, action: "account.delete_now" });
ok("delete now: logged as done, survives the account", row?.details?.status === "done" && row.details.deleted === true && row.details.emailedTo === dEmail && row.target === dEmail);
await open(`/support/users/${aUser.id}`);
// A owns a team (Sam is on it): delete now has to wait for the staff to leave.
ok("delete now: not offered to an owner with staff", (await text("main")).includes("Delete now isn’t available: this login owns a team with other staff"));

// =====================================================================================================
// /support/accounts: the complimentary-plan forms are logged too
// =====================================================================================================
await open("/support/accounts");
ok("free plans: no plan chosen until one is picked", (await admin.inputValue("[data-testid=comp-form] select")) === "");
await admin.fill('input[name="email"]', bEmail);
await admin.selectOption("select", "STUDIO");
await admin.click("text=Save");
// Said in the page (not the browser's own pop-up), keeping what was typed.
const needReason = await admin.waitForSelector("[data-testid=comp-form] [role=alert]", { timeout: 30000 }).then((e) => e.textContent()).catch(() => "");
ok("complimentary plan: a reason is needed, said in the page", needReason.includes("Write the reason for this") && (await admin.inputValue('[data-testid=comp-form] input[name="email"]')) === bEmail && !(await prisma.workspace.findUnique({ where: { id: wsB } })).complimentaryPlan, needReason);
await admin.fill('textarea[name="reason"]', "Partner trial agreed by email");
await admin.click("text=Save");
await admin.waitForSelector("text=free of charge");
row = await lastAction({ workspaceId: wsB, action: "plan.complimentary" });
ok("complimentary plan: logged with before and after, and the reason", row?.actorEmail === ADMIN && row.reason === "Partner trial agreed by email" && row.details.before.plan === "FREE" && row.details.after.plan === "STUDIO" && row.details.after.complimentaryPlan === "STUDIO" && row.target === `${bName} (${bEmail})`);
mail = await waitMail(bEmail, (m) => m.subject === "You have the Studio plan free of charge");
ok("complimentary plan: the owner is told", !!mail && norm(mail.text).includes(`SureFrame has given ${bName} the Studio plan free of charge. It was on Free before.`) && row.details.emailedTo === bEmail, mail?.text);
await admin.fill('[data-testid=comp-ai] input[name="email"]', bEmail);
await admin.fill('[data-testid=comp-ai] textarea[name="reason"]', "Partner trial agreed by email");
await admin.click("button:text-is('Save AI')");
await admin.waitForSelector("text=AI summaries free of charge");
row = await lastAction({ workspaceId: wsB, action: "plan.complimentary_ai" });
ok("complimentary AI summaries: logged", row?.details?.before?.aiAssist === false && row.details.after.aiAssist === true);
await admin.fill('input[name="email"]', bEmail);
await admin.selectOption("select", "FREE");
await admin.fill('textarea[name="reason"]', "Partner trial ended");
await admin.click("text=Save");
await admin.waitForSelector("text=back on the Free plan");
mail = await waitMail(bEmail, (m) => m.subject === "Your free SureFrame plan has ended");
// One email for both: the free AI summaries ended with the plan, and it says so (P23).
ok("ending a complimentary plan: the owner is told, with the Free videos left and the AI summaries", !!mail && norm(mail.text).includes(`The Studio plan SureFrame gave ${bName} free of charge has ended, and so have the free AI transcripts and summaries that came with it, so it's now on the Free plan.`) && norm(mail.text).includes("The Free plan includes 25 videos in total. You've used 4, so you have 21 left."), mail?.text);
row = await lastAction({ workspaceId: wsB, action: "plan.complimentary" });
ok("back to Free: logged", row?.details?.before?.plan === "STUDIO" && row.details.after.plan === "FREE" && row.details.after.aiAssist === false);
// Nothing left to end: refused, not logged, nobody emailed (P18, P23).
const rowsBefore = await prisma.adminAction.count({ where: { workspaceId: wsB } });
const bMailsBefore = mailTo(bEmail).length;
await admin.fill('[data-testid=comp-form] textarea[name="reason"]', "Again by mistake");
await admin.click("[data-testid=comp-form] button:text-is('Save')");
const noComp = await admin.waitForSelector("[data-testid=comp-form] [role=alert]", { timeout: 30000 }).then((e) => e.textContent()).catch(() => "");
ok("back to Free on a Free business: refused in plain words", noComp.includes(`${bName} isn't on a complimentary plan`), noComp);
await admin.fill('[data-testid=comp-ai] input[name="email"]', bEmail);
await admin.selectOption("[data-testid=comp-ai] select", "off");
await admin.fill('[data-testid=comp-ai] textarea[name="reason"]', "Tidying up");
await admin.click("button:text-is('Save AI')");
const noAi = await admin.waitForSelector("[data-testid=comp-ai] [role=alert]", { timeout: 30000 }).then((e) => e.textContent()).catch(() => "");
ok("AI off when it's already off: refused", noAi.includes("already off"), noAi);
await new Promise((r) => setTimeout(r, 1000));
ok("no-op changes: nothing logged and nobody emailed", (await prisma.adminAction.count({ where: { workspaceId: wsB } })) === rowsBefore && mailTo(bEmail).length === bMailsBefore);
// Support's own business: asked first, with a box to go ahead (P19); then "End" says what it fills in (P22).
await open("/support/accounts");
await admin.fill('[data-testid=comp-form] input[name="email"]', ADMIN);
await admin.selectOption("[data-testid=comp-form] select", "SOLO");
await admin.fill('[data-testid=comp-form] textarea[name="reason"]', "Trying it on our own business");
await admin.click("[data-testid=comp-form] button:text-is('Save')");
const ownMsg = await admin.waitForSelector("[data-testid=comp-form] [role=alert]", { timeout: 30000 }).then((e) => e.textContent()).catch(() => "");
const ownWs = (await prisma.membership.findFirst({ where: { role: "OWNER", user: { email: ADMIN } }, orderBy: { workspace: { createdAt: "asc" } } }))?.workspaceId;
ok("own business: asked first, nothing changed", ownMsg.includes("is your own business") && (await admin.isVisible("[data-testid=comp-own]")) && !(await prisma.workspace.findUnique({ where: { id: ownWs } })).complimentaryPlan, ownMsg);
await admin.check("[data-testid=comp-own] input");
await admin.click("[data-testid=comp-form] button:text-is('Save')");
await admin.waitForSelector("text=Solo free of charge");
ok("own business: given once the box is ticked", (await prisma.workspace.findUnique({ where: { id: ownWs } })).complimentaryPlan === "SOLO");
await open("/support/accounts");
await admin.click(`li:has-text("${ADMIN}") [data-testid=end-comp]`);
const ending = await admin.waitForSelector("[data-testid=comp-ending]", { timeout: 15000 }).then((e) => e.textContent()).catch(() => "");
ok("End: says whose plan it ends and what's left to do", /^Ending .+'s Solo: add a reason and press Save\.$/.test(ending.trim()) && (await admin.inputValue("[data-testid=comp-form] select")) === "FREE", ending);
ok("End: the reason box has the cursor", await admin.evaluate(() => document.activeElement?.getAttribute("name") === "reason"));
await admin.fill('[data-testid=comp-form] textarea[name="reason"]', "Done trying it");
await admin.click("[data-testid=comp-form] button:text-is('Save')");
await admin.waitForSelector("text=back on the Free plan");
ok("own business: ended again", !(await prisma.workspace.findUnique({ where: { id: ownWs } })).complimentaryPlan);

// =====================================================================================================
// The support log
// =====================================================================================================
await open("/support/log");
const log = await text("[data-testid=history]");
ok("log: newest first, with every kind of action", log.indexOf("Complimentary plan changed") < log.indexOf("Account deleted now") && ["Warning sent", "Workspace suspended", "Legal hold on", "Client's link turned off", "Signed out everywhere", "Free videos used set", "Removed client deleted now", "Seat check re-run", "Account closed permanently", "Scheduled deletion cancelled", "Email address unblocked", "Billing re-synced from Stripe"].every((l) => log.includes(l)), log.slice(0, 400));
ok("log: reasons and who did it", log.includes("Reason: Used to send threats") && log.includes(`By ${ADMIN}`));
ok("log: no link to a deleted account", (await admin.locator(`a[href="/support/users/${dUser.id}"]`).count()) === 0 && (await admin.locator(`a[href="/support/users/${eUser.id}"]`).count()) > 0);
await admin.screenshot({ path: `${shots}/log-phone.png` });
await open(`/support/log?q=${encodeURIComponent("Partner trial")}`);
const found = await text("[data-testid=history]");
ok("log: search finds actions by their reason", found.includes("Partner trial agreed by email") && !found.includes("Used to send threats"), found.slice(0, 200));
await open("/support/log?action=account.close");
const closes = await text("[data-testid=history]");
ok("log: and filters by kind", closes.includes("Account closed permanently") && !closes.includes("Warning sent"), closes.slice(0, 200));

ok("every console page fits a phone screen (no sideways scrolling)", wide.length === 0, wide.join(", "));

// A support agent who isn't an admin is cut off once their login is suspended. Needs the server started with
// SUPPORT_AGENTS=owner@test.dev,agent@test.dev; skipped otherwise.
const AGENT = "agent@test.dev";
const agentPage = await signIn(AGENT, "/library");
await agentPage.goto(BASE + "/support");
const isAgent = !!(await agentPage.waitForSelector("h1:text-is('Support inbox')", { timeout: 15000 }).catch(() => null));
if (isAgent) {
  const agentUser = await prisma.user.findUnique({ where: { email: AGENT } });
  await prisma.user.update({ where: { id: agentUser.id }, data: { suspendedAt: new Date() } });
  await agentPage.goto(BASE + "/support");
  await agentPage.waitForURL((u) => u.pathname === "/suspended", { timeout: 15000 }).catch(() => null);
  ok("a suspended agent: sent away from the support inbox", new URL(agentPage.url()).pathname === "/suspended", agentPage.url());
  await agentPage.goto(BASE + "/support/accounts");
  await agentPage.waitForURL((u) => u.pathname === "/suspended", { timeout: 15000 }).catch(() => null);
  ok("a suspended agent: and from the free plans page", new URL(agentPage.url()).pathname === "/suspended", agentPage.url());
  ok("a suspended agent: the support API refuses them", (await agentPage.request.post(BASE + "/api/support/speech-model", { data: { step: "plan" } })).status() === 404);
  await prisma.user.update({ where: { id: agentUser.id }, data: { suspendedAt: null } });
} else console.log("SKIP suspended support agent: start the server with SUPPORT_AGENTS=owner@test.dev,agent@test.dev");

// Decision 22: a support admin emails every business owner about a new sub-processor, at least 30 days ahead, after
// confirming how many it goes to; logged, sent once, and tested against the local outbox only (no RESEND_API_KEY here).
{
  const fresh = `notice-owner${stamp}@example.com`;
  await (await signIn(fresh, "/library")).close();
  const owners = new Set(
    (await prisma.user.findMany({ where: { closedAt: null, deleteAt: null, memberships: { some: { role: { in: ["OWNER", "ADMIN"] }, workspace: { closedAt: null, deleteAt: null } } } }, select: { email: true } })).map((u) => u.email.toLowerCase()),
  );
  await open("/support/notices");
  ok("notices: the page fits a phone", await admin.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  ok("notices: in the support links for admins", (await admin.locator("[data-testid=support-nav] a[href='/support/notices']").count()) === 1);
  const earliest = await admin.getAttribute("[data-testid=notice-start]", "min");
  const qldToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date());
  ok("notices: the earliest start date is 30 days away", earliest === new Date(Date.parse(`${qldToday}T00:00:00Z`) + 30 * D).toISOString().slice(0, 10), earliest);
  await admin.fill("[data-testid=notice-name]", `Provider A ${stamp}`);
  await admin.fill("[data-testid=notice-purpose]", "Sending our emails");
  await admin.fill("[data-testid=notice-location]", "United States");
  // Too soon: the date box stops it, and the server refuses it too (the box's limit taken off here to try).
  await admin.evaluate(() => document.querySelector("[data-testid=notice-start]").removeAttribute("min"));
  const tooSoon = new Date(Date.parse(`${earliest}T00:00:00Z`) - D).toISOString().slice(0, 10);
  await admin.fill("[data-testid=notice-start]", tooSoon);
  const before = outbox().length;
  await admin.click("[data-testid=notice-send]");
  await admin.waitForSelector("[data-testid=notice-confirm]");
  ok("notices: asks first, with how many owners it emails", norm(await admin.textContent("[data-testid=notice-confirm] h2")) === `Email ${owners.size === 1 ? "1 business owner or admin" : `${owners.size} business owners and admins`}?`, await admin.textContent("[data-testid=notice-confirm] h2"));
  await admin.click("[data-testid=notice-confirm-yes]");
  ok("notices: a start date under 30 days away is refused by the server", !!(await admin.waitForSelector("[data-testid=notice-confirm] [role=alert]:has-text('at least 30 days away')", { timeout: 15000 }).catch(() => null)) && outbox().length === before);
  await admin.click("[data-testid=notice-confirm] button:has-text('Cancel')");
  await admin.fill("[data-testid=notice-start]", earliest);
  await admin.click("[data-testid=notice-send]");
  await admin.waitForSelector("[data-testid=notice-confirm]");
  await admin.click("[data-testid=notice-confirm-yes]");
  const done = await admin.waitForSelector("[data-testid=notice-done]", { timeout: 60000 }).catch(() => null);
  ok("notices: sent to every owner, and says so", !!done && norm(await done.textContent()).startsWith(`Sent to ${owners.size} of ${owners.size} business owner`), done ? await done.textContent() : "no confirmation");
  const sent = outbox().slice(before).filter((m) => m.subject === `New SureFrame sub-processor: Provider A ${stamp}`);
  ok("notices: one email per owner, none to anyone else", sent.length === owners.size && sent.every((m) => owners.has(m.to)) && new Set(sent.map((m) => m.to)).size === sent.length && sent.some((m) => m.to === fresh), `${sent.length} of ${owners.size}`);
  const n = sent.find((m) => m.to === fresh);
  ok("notices: the email says who, what, where and when, and how to object", !!n && n.text.includes(`Who: Provider A ${stamp}`) && n.text.includes("What it does for us: Sending our emails") && n.text.includes("Where it processes information: United States") && n.text.includes("Starts: ") && n.text.includes("email support@sureframe.app before") && n.text.includes("Sent with SureFrame") && n.from.startsWith("SureFrame <"));
  const logged = await lastAction({ action: "subprocessor.notice" });
  ok("notices: logged in the support log", logged?.actorEmail === ADMIN && logged.target === `Provider A ${stamp} from ${earliest}` && logged.details?.sent === owners.size && logged.details?.status === "sent", JSON.stringify(logged));
  await admin.goto(BASE + "/support/log?action=subprocessor.notice");
  ok("notices: shown in the support log under its own kind", !!(await admin.waitForSelector(`main :text("Provider A ${stamp} from ${earliest}")`, { timeout: 15000 }).catch(() => null)) && norm(await admin.textContent("main")).includes("New sub-processor notice emailed"));
  // The same notice again: refused, nothing sent.
  await open("/support/notices");
  await admin.fill("[data-testid=notice-name]", `Provider A ${stamp}`);
  await admin.fill("[data-testid=notice-purpose]", "Sending our emails");
  await admin.fill("[data-testid=notice-location]", "United States");
  await admin.fill("[data-testid=notice-start]", earliest);
  const again = outbox().length;
  await admin.click("[data-testid=notice-send]");
  await admin.click("[data-testid=notice-confirm-yes]");
  ok("notices: the same notice can't go twice", !!(await admin.waitForSelector("[data-testid=notice-confirm] [role=alert]:has-text('already been sent')", { timeout: 15000 }).catch(() => null)) && outbox().length === again);
  await admin.click("[data-testid=notice-confirm] button:has-text('Cancel')");
  ok("notices: the earlier notice is listed", norm(await admin.textContent("[data-testid=notice-history]")).includes(`Provider A ${stamp}`));
  // Not for anyone else: a business owner who isn't support is sent to Help.
  const plain = await signIn(fresh, "/library");
  await plain.goto(BASE + "/support/notices");
  await plain.waitForURL((u) => u.pathname !== "/support/notices", { timeout: 15000 }).catch(() => {});
  ok("notices: not for a business owner who isn't support", new URL(plain.url()).pathname === "/help", plain.url());
  await plain.close();
}

await browser.close();
server.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
