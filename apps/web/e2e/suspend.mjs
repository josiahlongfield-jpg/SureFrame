// Support powers (lib/support/admin.ts) through /api/support/admin: who may use them, warning, suspending and
// unsuspending a workspace and a single login, signing a login out everywhere, closing an account for good (Stripe
// cancelled now, staff taken off the team, address blocked, can't be kept), legal hold (no automatic deletion while
// on), reopening after a review, blocking addresses on every way in, and pruning the support log after 7 years.
// Needs the app running with AUTH_DEV_LOGIN=true, SUPPORT_EMAIL=owner@test.dev (the support admin), local file
// storage, no RESEND_API_KEY (mail goes to .data/outbox), CRON_SECRET, and STRIPE_API_BASE=http://localhost:12111
// with STRIPE_SECRET_KEY=sk_test_fake (this suite starts the fake Stripe).
import { chromium } from "@playwright/test";
import crypto, { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { start, state, createSubscription } from "./fake-stripe.mjs";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret";
const ADMIN = "owner@test.dev";
const shots = process.argv[2] ?? "/tmp";
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
const cron = async (p = "reminders") => {
  const r = await fetch(`${BASE}/api/cron/${p}`, { headers: { Authorization: `Bearer ${CRON}` } });
  return r.status === 200 ? r.json() : { status: r.status };
};
const norm = (s) => (s ?? "").replace(/[\s  ]+/g, " ").trim();
const sha = (t) => createHash("sha256").update(t).digest("hex");
const uploads = path.resolve(".data/uploads");
const putFile = (key) => {
  mkdirSync(path.dirname(path.join(uploads, key)), { recursive: true });
  writeFileSync(path.join(uploads, key), "encrypted bytes");
};
const has = (key) => existsSync(path.join(uploads, key));
const lastAction = (where) => prisma.adminAction.findFirst({ where, orderBy: { createdAt: "desc" } });
const sig = new Stripe("sk_test_fake");
async function webhook(page, type, sub) {
  const payload = JSON.stringify({ id: `evt_${Date.now()}`, object: "event", type, data: { object: sub } });
  const header = sig.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
  return page.request.post(BASE + "/api/webhooks/stripe", { headers: { "stripe-signature": header, "content-type": "application/json" }, data: payload });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
async function signIn(email, next = "/library", lands = next.split("?")[0]) {
  // Agreed to the current Terms and Privacy Policy, so signing in isn't stopped at /agree (e2e/agree.mjs).
  await agreed(email);
  // This suite signs in more often than the dev login's 20 per 15 minutes allows.
  await prisma.rateLimit.deleteMany({ where: { key: { contains: "dev-login" } } });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  // In development a page compiling for the first time can refresh every open tab and cut a redirect short: reload once.
  await page.waitForURL((u) => u.pathname === lands, { timeout: 30000 }).catch(async () => {
    await page.reload();
    await page.waitForURL((u) => u.pathname === lands, { timeout: 60000 });
  });
  // The address bar can change before the server has rendered the page (and made a new account's workspace): wait for it.
  await page.waitForSelector("main", { timeout: 60000 });
  return page;
}
const admin = await signIn(ADMIN, "/library");
const act = async (data, page = admin) => {
  const r = await page.request.post(BASE + "/api/support/admin", { data });
  let body = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status(), body };
};
const apiStatus = async (page, p = "/api/clients") => {
  const r = await page.request.get(BASE + p);
  let body = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status(), body };
};

// ---- The business: an owner on Solo with a Stripe subscription, a staff member, two clients and a video ----
const ownerEmail = `susp-owner${stamp}@example.com`;
const owner = await signIn(ownerEmail, "/library");
const ownerUser = await prisma.user.findUnique({ where: { email: ownerEmail } });
const ws = (await prisma.membership.findFirst({ where: { userId: ownerUser.id, role: "OWNER" } })).workspaceId;
const business = `Susp ${stamp}`;
const customer = `cus_susp${stamp}`;
const sub = createSubscription(customer, ws, "sureframe_solo_monthly");
await prisma.workspace.update({
  where: { id: ws },
  data: { name: business, plan: "SOLO", stripeCustomerId: customer, stripeSubscriptionId: sub.id, subscriptionStatus: "active", currentPeriodEnd: new Date(Date.now() + 30 * D) },
});
const staffEmail = `susp-staff${stamp}@example.com`;
const staffUser = await prisma.user.create({ data: { email: staffEmail, name: "Sam Staff" } });
await prisma.membership.create({ data: { userId: staffUser.id, workspaceId: ws, role: "MEMBER", seeAllClients: true } });
const staff = await signIn(staffEmail, "/library");
const mk = (name, email, i) => prisma.client.create({ data: { name, email, token: `su-${stamp}-${i}-${"x".repeat(20)}`, workspaceId: ws } });
const ana = await mk(`Ana ${stamp}`, `ana-su${stamp}@example.com`, 0);
const fileKey = `test/${stamp}/susp-ana`;
putFile(fileKey);
const anaVideo = await prisma.video.create({ data: { id: `sua${stamp.toString(36)}`, mimeType: "video/webm", storageKey: fileKey, status: "UPLOADED", workspaceId: ws, ownerId: ownerUser.id, clientId: ana.id } });
const anaPhone = await (await browser.newContext()).newPage();
await anaPhone.goto(`${BASE}/c/${ana.token}`);
ok("before: Ana's link opens her inbox", new URL(anaPhone.url()).pathname === "/inbox" && (await anaPhone.locator(`a[href*="/v/${anaVideo.id}"]`).count()) > 0);

// =====================================================================================================
// Who can use the powers
// =====================================================================================================
const reason = "Chargeback pattern reported by Stripe (internal)";
ok("not an admin: 404", (await act({ action: "suspendWorkspace", workspaceId: ws, reason, category: "terms" }, owner)).status === 404);
const anon = await (await browser.newContext()).newPage();
ok("signed out: 404", (await act({ action: "suspendWorkspace", workspaceId: ws, reason, category: "terms" }, anon)).status === 404);
ok("a reason is required", (await act({ action: "suspendWorkspace", workspaceId: ws, reason: "  ", category: "terms" })).status === 400);
ok("reasons over 500 characters refused", (await act({ action: "suspendWorkspace", workspaceId: ws, reason: "r".repeat(501), category: "terms" })).status === 400);
// Blocking the address of an owner whose plan still renews would leave them paying with no way to sign in and cancel.
const renewGuard = await act({ action: "blockEmail", email: ownerEmail, reason: "Checking the renewal guard", category: "terms" });
ok("block: refused while the owner's plan still renews", renewGuard.status === 409 && String(renewGuard.body?.error).includes("still renews") && !(await prisma.blockedEmail.findUnique({ where: { emailHash: sha(ownerEmail) } })), JSON.stringify(renewGuard));
const adminUser = await prisma.user.findUnique({ where: { email: ADMIN } });
ok("can't use it on your own login", (await act({ action: "suspendUser", userId: adminUser.id, reason, category: "terms" })).status === 403);
const adminWs = await prisma.membership.findFirst({ where: { userId: adminUser.id } });
if (adminWs) ok("can't use it on your own workspace", (await act({ action: "suspendWorkspace", workspaceId: adminWs.workspaceId, reason, category: "terms" })).status === 403);
const crossSite = await admin.request.post(BASE + "/api/support/admin", { data: { action: "suspendWorkspace", workspaceId: ws, reason, category: "terms" }, headers: { "sec-fetch-site": "cross-site" } });
ok("a cross-site request is refused", crossSite.status() === 403);
ok("nothing was changed or logged by the refused attempts", !(await prisma.workspace.findUnique({ where: { id: ws } })).suspendedAt && !(await prisma.adminAction.findFirst({ where: { workspaceId: ws } })));

// =====================================================================================================
// A warning: an email only
// =====================================================================================================
let r = await act({ action: "warn", workspaceId: ws, reason: "Spam complaints from two recipients", category: "terms", message: "Please only send videos to people who asked for them." });
ok("warn: done and emailed", r.status === 200 && r.body.emailed === true, JSON.stringify(r));
const warnMail = await waitMail(ownerEmail, (m) => m.subject === "A warning about your SureFrame account");
const wt = norm(warnMail?.text);
ok("warning email: why in plain words, the note, the review route", wt.includes(`We're writing about ${business} on SureFrame because of a breach of our Terms of Service.`) && wt.includes("Please only send videos to people who asked for them.") && wt.includes("within 30 days"), wt);
ok("warning email: plain SureFrame email, replies go to support, internal reason not included", warnMail?.from.startsWith("SureFrame") && warnMail?.replyTo === ADMIN && !wt.includes("Spam complaints"), JSON.stringify(warnMail?.replyTo));
let row = await lastAction({ workspaceId: ws, action: "account.warn" });
ok("warning logged: admin, reason, target, emailed to", row?.actorEmail === ADMIN && row.reason === "Spam complaints from two recipients" && row.target === `${business} (${ownerEmail})` && row.details?.emailedTo === ownerEmail, JSON.stringify(row));
ok("warning changed nothing", !(await prisma.workspace.findUnique({ where: { id: ws } })).suspendedAt && (await apiStatus(owner)).status === 200);

// =====================================================================================================
// Suspending the workspace (renewal stopped at period end)
// =====================================================================================================
// A client reminder due while suspended stays unsent.
const item = await prisma.item.create({ data: { kind: "TASK", body: "t".repeat(40), dueAt: new Date(Date.now() + 30 * 60000), authorName: "Owner", workspaceId: ws, clientId: ana.id, shared: true, remindClient: true } });
const note = "We need to talk about the complaints we received. Please email us.";
r = await act({ action: "suspendWorkspace", workspaceId: ws, reason, category: "fraud", note, stopRenewal: true });
ok("suspend: done, emailed, renewal stopped", r.status === 200 && r.body.emailed === true && r.body.billing?.renewal === "stopped", JSON.stringify(r));
let w = await prisma.workspace.findUnique({ where: { id: ws } });
ok("suspend: workspace marked with the internal reason and the members' note", !!w.suspendedAt && w.suspendedReason === reason && w.suspendedNote === note && !w.closedAt);
ok("suspend: Stripe renewal off at period end, Billing knows", state.subs.find((s) => s.id === sub.id)?.cancel_at_period_end === true && !!w.cancelsAt);
row = await lastAction({ workspaceId: ws, action: "workspace.suspend" });
ok("suspend logged in the same go: before/after, billing, emailed", row?.reason === reason && row.details?.after?.suspendedAt && row.details?.before?.suspendedAt === null && row.details?.billing?.renewal === "stopped" && row.details?.emailedTo === ownerEmail && row.userId === ownerUser.id, JSON.stringify(row));
ok("suspend twice: 409", (await act({ action: "suspendWorkspace", workspaceId: ws, reason, category: "fraud" })).status === 409);
const suspMail = await waitMail(ownerEmail, (m) => m.subject === "Your SureFrame account has been suspended");
const st = norm(suspMail?.text);
ok("suspension email: why, what it means, nothing deleted", st.includes(`We've suspended ${business} on SureFrame because of suspected fraud, including payment fraud or false information.`) && st.includes("Nothing has been deleted.") && st.includes("your clients see that your videos are unavailable right now"), st);
ok("suspension email: renewal stopped, the note, how to ask for a review", st.includes("Your subscription won't renew, so it ends on") && st.includes(note) && st.includes("If you think this is a mistake, reply to this email or email support@sureframe.app within 30 days and we'll review it."), st);
ok("suspension email: no internal reason", !st.includes("Chargeback"), st);
ok("suspension email: deletion schedules line is always the same (gives nothing away about a legal hold)", st.includes("The usual deletion schedules in our Terms carry on: recordings without cloud backup still leave our servers, and removed clients are deleted when their 30 days end."), st);

// The team's side.
await owner.goto(BASE + "/library");
await owner.waitForURL((u) => u.pathname === "/suspended", { timeout: 15000 }).catch(() => null);
ok("owner: pages lead to the suspended page", new URL(owner.url()).pathname === "/suspended");
ok("suspended page: says so, nothing deleted, contact support", norm(await owner.textContent("[data-testid=suspended-message]").catch(() => "")) === `${business} has been suspended. Nothing has been deleted. Contact support@sureframe.app.`);
ok("suspended page: shows support's note to members", norm(await owner.textContent("[data-testid=suspended-note]").catch(() => "")) === note);
ok("suspended page: owner can still manage billing; data download offered", (await owner.locator("text=You can still manage or cancel your subscription.").count()) === 1 && (await owner.locator("[data-testid=suspended-export]").count()) === 1);
ok("suspended page: never shows the internal reason", !(await owner.textContent("body")).includes("Chargeback"));
ok("suspended page: deletion schedule line points to the Terms", norm(await owner.textContent("body")).includes("Recordings without cloud backup still follow the usual deletion schedule in our Terms."));
await owner.screenshot({ path: `${shots}/suspend-page.png`, fullPage: true });
let res = await apiStatus(owner);
ok("owner: API answers 403 ACCOUNT_SUSPENDED", res.status === 403 && res.body?.code === "ACCOUNT_SUSPENDED" && res.body?.error === "This account is suspended. Nothing has been deleted. Contact support@sureframe.app.", JSON.stringify(res));
ok("owner: can still download their data", (await apiStatus(owner, "/api/account/export")).status === 200);
ok("owner: can still open the billing portal", (await owner.request.post(BASE + "/api/billing/portal")).status() === 200);
res = await apiStatus(staff);
ok("staff: API 403 too", res.status === 403 && res.body?.code === "ACCOUNT_SUSPENDED");
await staff.goto(`${BASE}/v/${anaVideo.id}`);
await staff.waitForURL((u) => u.pathname === "/suspended", { timeout: 15000 }).catch(() => null);
ok("staff: a video link leads to the suspended page", new URL(staff.url()).pathname === "/suspended", staff.url());
ok("staff: no billing controls", (await staff.locator("text=You can still manage or cancel your subscription.").count()) === 0);
ok("help still opens", (await owner.request.get(BASE + "/help")).status() === 200);

// The clients' side: unavailable, never "suspended".
await anaPhone.goto(BASE + "/inbox");
const unavailable = norm(await anaPhone.textContent("[data-testid=client-unavailable]").catch(() => ""));
ok("Ana's inbox: unavailable right now, not suspended", unavailable === `Videos from ${business} are unavailable right now.` && !(await anaPhone.textContent("body")).toLowerCase().includes("suspend"), unavailable);
await anaPhone.goto(`${BASE}/v/${anaVideo.id}`);
ok("Ana's video: unavailable card", (await anaPhone.locator("[data-testid=video-unavailable]").count()) === 1 && !(await anaPhone.textContent("body")).toLowerCase().includes("suspend"));
const freshClient = await (await browser.newContext()).newPage();
await freshClient.goto(`${BASE}/c/${ana.token}`);
ok("Ana's link on a new device: unavailable notice, nothing remembered", new URL(freshClient.url()).searchParams.get("unavailable") === "1" && (await freshClient.locator("[data-testid=client-unavailable]").count()) === 1 && !(await freshClient.context().cookies()).some((c) => c.name.startsWith("fc_client_")));
await freshClient.screenshot({ path: `${shots}/suspend-client.png`, fullPage: true });

// A client's reply upload stops (403, so it stays on their device).
const replyToken = crypto.randomBytes(24).toString("base64url");
const replyMedia = await prisma.video.create({ data: { id: `sur${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/susp-reply`, status: "RECORDING", uploadId: "u1", workspaceId: ws, ownerId: ownerUser.id, replyToId: anaVideo.id, uploadTokenHash: sha(replyToken) } });
await prisma.reply.create({ data: { kind: "VIDEO", authorName: ana.name, videoId: anaVideo.id, mediaId: replyMedia.id } });
const part = await anon.request.put(`${BASE}/api/videos/${replyMedia.id}/parts/1`, { headers: { "x-upload-token": replyToken, "content-type": "application/octet-stream" }, data: Buffer.from("abc") });
ok("client reply upload: 403 unavailable", part.status() === 403 && (await part.json()).error === `Videos from ${business} are unavailable right now.`);

// Nothing goes out in the business's name: the reminder stays unsent.
const reminder = await prisma.reminder.create({ data: { itemId: item.id, sendAt: new Date(Date.now() - 60000), to: "CLIENT" } });
await cron("reminders");
ok("a due reminder stays unsent while suspended", !(await prisma.reminder.findUnique({ where: { id: reminder.id } })).sentAt);
ok("Ana got no reminder email", mailTo(ana.email).length === 0);

// Joining the suspended team is refused.
await prisma.invite.create({ data: { workspaceId: ws, tokenHash: sha(`su-invite-${stamp}`), teamKeyWrap: "w".repeat(60), expiresAt: new Date(Date.now() + 7 * D), invitedById: ownerUser.id } });
const joiner = await signIn(`susp-joiner${stamp}@example.com`, "/library");
await joiner.goto(`${BASE}/join/su-invite-${stamp}`);
ok("join page: team unavailable", (await joiner.textContent("h1")).includes("This team's SureFrame account is unavailable right now"));
const join = await joiner.request.post(BASE + "/api/team/join", { data: { token: `su-invite-${stamp}` } });
ok("join API: 403", join.status() === 403);

// =====================================================================================================
// Unsuspending (renewal back on); reminders that came due are skipped, not sent late
// =====================================================================================================
r = await act({ action: "unsuspendWorkspace", workspaceId: ws, reason: "Owner explained; resolved by email", resumeRenewal: true });
ok("unsuspend: done, emailed, renewal resumed", r.status === 200 && r.body.emailed && r.body.billing?.renewal === "resumed", JSON.stringify(r));
w = await prisma.workspace.findUnique({ where: { id: ws } });
ok("unsuspend: cleared, renewal on again", !w.suspendedAt && !w.suspendedReason && !w.suspendedNote && !w.cancelsAt && state.subs.find((s) => s.id === sub.id)?.cancel_at_period_end === false);
const rem = await prisma.reminder.findUnique({ where: { id: reminder.id } });
ok("the reminder due meanwhile is skipped, not sent late", !!rem.sentAt && rem.error === "suspended", JSON.stringify(rem));
await cron("reminders");
ok("still no reminder email to Ana", mailTo(ana.email).length === 0);
row = await lastAction({ workspaceId: ws, action: "workspace.unsuspend" });
ok("unsuspend logged with what was before", row?.details?.before?.suspendedReason === reason && row.details?.remindersSkipped === 1 && row.details?.billing?.renewal === "resumed", JSON.stringify(row));
const backMail = await waitMail(ownerEmail, (m) => m.subject === "Your SureFrame account is no longer suspended");
ok("unsuspend email: the button opens that workspace", !!backMail && backMail.text.includes(`/library?ws=${ws}`), backMail?.text);
ok("unsuspend email: back, reminders not sent, renews", norm(backMail?.text).includes("Reminders that came due while it was suspended weren't sent.") && norm(backMail?.text).includes("Your subscription renews as normal again."), backMail?.text);
ok("owner: API works again", (await apiStatus(owner)).status === 200);
await anaPhone.goto(BASE + "/inbox");
ok("Ana: inbox works again", (await anaPhone.locator("[data-testid=client-unavailable]").count()) === 0 && (await anaPhone.locator(`a[href*="/v/${anaVideo.id}"]`).count()) > 0);
ok("unsuspend twice: 409", (await act({ action: "unsuspendWorkspace", workspaceId: ws, reason: "again" })).status === 409);
// A payment disputed while it was suspended: Resume renewal leaves renewal off (a person turns it back on in Stripe).
await act({ action: "suspendWorkspace", workspaceId: ws, reason: "Dispute check", category: "terms", stopRenewal: true, notify: false });
const disputedCharge = `ch_su${stamp}`;
state.charges = { ...(state.charges ?? {}), [disputedCharge]: { id: disputedCharge, object: "charge", customer, disputed: true } };
r = await act({ action: "unsuspendWorkspace", workspaceId: ws, reason: "Dispute check done", resumeRenewal: true, notify: false });
ok("unsuspend after a dispute: renewal stays off", r.status === 200 && r.body.billing?.renewal === "disputed" && state.subs.find((s) => s.id === sub.id)?.cancel_at_period_end === true, JSON.stringify(r));
delete state.charges[disputedCharge];
state.subs.find((s) => s.id === sub.id).cancel_at_period_end = false;
await prisma.workspace.update({ where: { id: ws }, data: { cancelsAt: null } });

// =====================================================================================================
// Suspending one login
// =====================================================================================================
r = await act({ action: "suspendUser", userId: staffUser.id, reason: "Harassment report about this staff member", category: "safety" });
ok("suspend login: done and emailed", r.status === 200 && r.body.emailed, JSON.stringify(r));
res = await apiStatus(staff);
ok("suspended login: API 403 ACCOUNT_SUSPENDED", res.status === 403 && res.body?.code === "ACCOUNT_SUSPENDED");
ok("suspended staff login: no billing portal", (await staff.request.post(BASE + "/api/billing/portal")).status() === 403);
await staff.goto(BASE + "/library");
await staff.waitForURL((u) => u.pathname === "/suspended", { timeout: 15000 }).catch(() => null);
ok("suspended login: page names the login", norm(await staff.textContent("[data-testid=suspended-message]").catch(() => "")) === `Your SureFrame login (${staffEmail}) has been suspended. Nothing has been deleted. Contact support@sureframe.app.`);
ok("the rest of the team carries on", (await apiStatus(owner)).status === 200);
await anaPhone.goto(BASE + "/inbox");
ok("and so do the clients", (await anaPhone.locator("[data-testid=client-unavailable]").count()) === 0);
const loginMail = await waitMail(staffEmail, (m) => m.subject === "Your SureFrame login has been suspended");
ok("login email: why, review route", norm(loginMail?.text).includes(`We've suspended your SureFrame login (${staffEmail}) to protect people from harm.`) && norm(loginMail?.text).includes("within 30 days"), loginMail?.text);
// A suspended login can't join another team either.
await signIn(`susp-other${stamp}@example.com`, "/library");
const otherWs = (await prisma.membership.findFirst({ where: { user: { email: `susp-other${stamp}@example.com` } } })).workspaceId;
await prisma.invite.create({ data: { workspaceId: otherWs, tokenHash: sha(`su-other-${stamp}`), teamKeyWrap: "w".repeat(60), expiresAt: new Date(Date.now() + 7 * D), invitedById: (await prisma.user.findUnique({ where: { email: `susp-other${stamp}@example.com` } })).id } });
res = await staff.request.post(BASE + "/api/team/join", { data: { token: `su-other-${stamp}` } });
ok("suspended login: joining a team refused", res.status() === 403 && (await res.json()).code === "ACCOUNT_SUSPENDED");
r = await act({ action: "unsuspendUser", userId: staffUser.id, reason: "Report withdrawn" });
ok("unsuspend login: done", r.status === 200 && r.body.emailed);
ok("unsuspended login: API works again", (await apiStatus(staff)).status === 200);
ok("login suspend/unsuspend both logged", !!(await lastAction({ userId: staffUser.id, action: "user.suspend" })) && !!(await lastAction({ userId: staffUser.id, action: "user.unsuspend" })));
// An owner whose own login is suspended can still manage or cancel the subscription (staff can't: checked above).
r = await act({ action: "suspendUser", userId: ownerUser.id, reason: "Checking the owner's billing while suspended", category: "terms", notify: false });
ok("owner's login suspended", r.status === 200);
await owner.goto(BASE + "/library");
await owner.waitForURL((u) => u.pathname === "/suspended", { timeout: 15000 }).catch(() => null);
ok("suspended owner login: billing still offered", (await owner.locator("text=You can still manage or cancel your subscription.").count()) === 1);
ok("suspended owner login: the billing portal opens", (await owner.request.post(BASE + "/api/billing/portal")).status() === 200);
ok("suspended owner login: the rest of the API is still refused", (await apiStatus(owner)).status === 403);
await act({ action: "unsuspendUser", userId: ownerUser.id, reason: "Done checking", notify: false });

// =====================================================================================================
// Signing a login out everywhere
// =====================================================================================================
const staffPhone = await signIn(staffEmail, "/library");
ok("before: both of the staff member's sign-ins work", (await apiStatus(staff)).status === 200 && (await apiStatus(staffPhone)).status === 200);
await new Promise((r) => setTimeout(r, 1100));
r = await act({ action: "signOutEverywhere", userId: staffUser.id, reason: "Owner reports a lost laptop", category: "security" });
ok("sign out everywhere: done", r.status === 200 && r.body.emailed, JSON.stringify(r));
ok("every existing sign-in is refused", (await apiStatus(staff)).status === 401 && (await apiStatus(staffPhone)).status === 401);
const again = await signIn(staffEmail, "/library");
ok("signing in again works as normal", (await apiStatus(again)).status === 200);
const outMail = await waitMail(staffEmail, (m) => m.subject === "You've been signed out of SureFrame everywhere");
ok("signed-out email: why, sign in again", norm(outMail?.text).includes("on every device to protect the account's security") && norm(outMail?.text).includes("Sign in again to carry on."), outMail?.text);
row = await lastAction({ userId: staffUser.id, action: "user.sign_out_everywhere" });
ok("sign out everywhere logged", row?.reason === "Owner reports a lost laptop" && !!row.details?.after?.sessionsValidAfter);

// =====================================================================================================
// Closing the account for good: Stripe cancelled now, staff taken off, address blocked, can't be kept
// =====================================================================================================
const ownerLaptop = await signIn(ownerEmail, "/library");
ok("close: needs the typed confirmation", (await act({ action: "closeAccount", userId: ownerUser.id, reason, category: "unlawful", confirm: `CLOSE someone@else.com`, blockEmail: true })).status === 400);
ok("close: nothing changed by the refused attempt", !(await prisma.user.findUnique({ where: { id: ownerUser.id } })).closedAt && state.subs.find((s) => s.id === sub.id)?.status === "active");
// A Checkout the owner opened before the closure.
const openCheckout = { id: `cs_su${stamp}`, object: "checkout.session", status: "open", url: "https://checkout.stripe.test/su", params: { customer } };
state.sessions.push(openCheckout);
r = await act({ action: "closeAccount", userId: ownerUser.id, reason, category: "unlawful", confirm: `CLOSE ${ownerEmail.toUpperCase()}`, blockEmail: true });
ok("close: an open Checkout can't be paid any more", state.sessions.find((x) => x.id === openCheckout.id)?.status === "expired");
ok("close: done", r.status === 200 && r.body.emailed && r.body.staffRemoved === 1 && r.body.workspaces?.[0] === ws, JSON.stringify(r));
ok("close: Stripe subscription cancelled now", state.subs.find((s) => s.id === sub.id)?.status === "canceled");
// A subscription that starts after the closure anyway (say, an invoice paid late) is cancelled, not applied.
const lateSub = createSubscription(customer, ws, "sureframe_studio_monthly");
ok("a subscription started after the closure: taken", (await webhook(admin, "customer.subscription.created", lateSub)).status() === 200);
const lateW = await prisma.workspace.findUnique({ where: { id: ws } });
ok("a subscription started after the closure: cancelled straight away, the plan not applied", lateSub.status === "canceled" && lateW.stripeSubscriptionId !== lateSub.id && lateW.plan !== "STUDIO", JSON.stringify({ status: lateSub.status, plan: lateW.plan }));
let u = await prisma.user.findUnique({ where: { id: ownerUser.id } });
w = await prisma.workspace.findUnique({ where: { id: ws } });
ok("close: login closed, suspended, signed out, deleted in 44 days (after the review window)", !!u.closedAt && !!u.suspendedAt && !!u.sessionsValidAfter && Math.abs(u.deleteAt.getTime() - (u.closedAt.getTime() + 44 * D)) < 1000, JSON.stringify(u));
ok("close: workspace closed and suspended with the same date", !!w.closedAt && !!w.suspendedAt && w.deleteAt?.getTime() === u.deleteAt.getTime() && !w.legalHoldAt);
ok("close: staff taken off the team, keeping their login", !(await prisma.membership.findFirst({ where: { workspaceId: ws, userId: staffUser.id } })) && !!(await prisma.user.findUnique({ where: { id: staffUser.id } })));
ok("close: address blocked by a hash of the inbox", !!(await prisma.blockedEmail.findUnique({ where: { emailHash: sha(ownerEmail) } })) && (await prisma.blockedEmail.count({ where: { emailHash: ownerEmail } })) === 0);
ok("close: nothing deleted yet", !!(await prisma.video.findUnique({ where: { id: anaVideo.id } })) && has(fileKey));
row = await lastAction({ userId: ownerUser.id, action: "account.close" });
ok("close logged: block, workspaces, billing, emailed", row?.details?.blockEmail === true && row.details?.workspaces?.[0]?.id === ws && row.details?.billing?.[ws]?.cancelled === true && row.details?.emailedTo === ownerEmail, JSON.stringify(row));
const closeMail = await waitMail(ownerEmail, (m) => m.subject === "Your SureFrame account has been closed");
const cm = norm(closeMail?.text);
ok("closure email: permanent, why, cancelled, deletion date", cm.includes(`We've closed your SureFrame account (${ownerEmail}) and ${business} because we believe it was used for something unlawful or harmful. This is permanent.`) && cm.includes("Your subscription has been cancelled, so you won't be charged again.") && cm.includes("will be deleted for good on"), cm);
// Both 30-day deadlines (review, data copy) are written as the one date, in Queensland time, apart from the deletion date.
const reviewBy = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", year: "numeric" }).format(new Date(Date.now() + 30 * 86_400_000));
ok("closure email: blocked, review route by a date, no internal reason", cm.includes("This email address can't be used to sign up to SureFrame again.") && cm.includes(`email support@sureframe.app by ${reviewBy} and we'll review it`) && !cm.includes("within 30 days") && !cm.includes("Chargeback"), cm);
ok("closure email: how to get a copy of the data", cm.includes(`To get a copy of your account data, email support@sureframe.app by ${reviewBy}.`), cm);
const staffNotice = await waitMail(staffEmail, (m) => m.subject === `You're no longer on ${business}'s team`);
ok("staff are told the account was closed, not why", norm(staffNotice?.text).includes(`${business}'s SureFrame account has been closed, so you're no longer on its team.`) && norm(staffNotice?.text).includes("Your own SureFrame login still works."), staffNotice?.text);
ok("staff member's own login still works", (await apiStatus(again)).status === 200);
ok("the owner's old sign-ins are refused", (await apiStatus(owner)).status === 401 && (await apiStatus(ownerLaptop)).status === 401);
await freshClient.goto(`${BASE}/c/${ana.token}`);
ok("Ana's link: unavailable (not 'closed their account')", new URL(freshClient.url()).searchParams.get("unavailable") === "1" && (await freshClient.locator("[data-testid=client-closed]").count()) === 0);

// Signing in again with the address, or a tagged version of it, is refused on every way in.
const blocked = await (await browser.newContext()).newPage();
await blocked.goto(`${BASE}/login?next=/library`);
await blocked.fill('input[name="email"]', ownerEmail);
await blocked.click("text=Continue");
await blocked.waitForURL((u) => u.searchParams.get("error") === "blocked", { timeout: 30000 }).catch(() => null);
const blockedNote = await blocked.waitForSelector("p.text-danger-fg[role=alert]", { timeout: 15000 }).then((e) => e.textContent()).catch(() => "");
ok("sign-in page: blocked address told why", norm(blockedNote) === "This email address can't be used with SureFrame. Contact support@sureframe.app.", `${blocked.url()} ${blockedNote}`);
await blocked.goto(`${BASE}/login?next=/library`);
await blocked.fill('input[name="email"]', ownerEmail.replace("@", "+again@").toUpperCase());
await blocked.click("text=Continue");
await blocked.waitForURL((u) => u.searchParams.get("error") === "blocked", { timeout: 30000 }).catch(() => null);
ok("sign-in page: a +tag version is blocked too", new URL(blocked.url()).searchParams.get("error") === "blocked");
// Straight at Auth.js, skipping the page's own check.
const csrf = (await (await blocked.request.get(BASE + "/api/auth/csrf")).json()).csrfToken;
await blocked.request.post(BASE + "/api/auth/callback/dev", { form: { email: ownerEmail, csrfToken: csrf, callbackUrl: BASE + "/library" } });
const session = await (await blocked.request.get(BASE + "/api/auth/session")).json();
ok("Auth.js itself refuses the blocked address", !session?.user, JSON.stringify(session));
// The app hand-over, for a code made before the block.
const verifier = crypto.randomBytes(32).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const code = crypto.randomBytes(24).toString("base64url");
await prisma.mobileCode.create({ data: { codeHash: sha(code), challenge, userId: ownerUser.id, expiresAt: new Date(Date.now() + 5 * 60000) } });
res = await anon.request.post(BASE + "/api/mobile/exchange", { data: { code, verifier } });
ok("mobile hand-over refused", res.status() === 403 && (await res.json()).error === "This email address can't be used with SureFrame. Contact support@sureframe.app.");

// Unblocked, they can sign in, but only to see that it can't be kept.
r = await act({ action: "unblockEmail", email: ownerEmail, reason: "Lawyer asked to see the closure page" });
ok("unblock: done and logged", r.status === 200 && !(await prisma.blockedEmail.findUnique({ where: { emailHash: sha(ownerEmail) } })) && !!(await lastAction({ action: "email.unblock", target: ownerEmail })));
const back = await signIn(ownerEmail, "/library", "/account/restore");
const restoreText = norm(await back.textContent("[data-testid=restore-by-support]").catch(() => ""));
ok("restore page: closed by support, can't be kept, review within 30 days", restoreText.includes("SureFrame support closed this account on") && restoreText.includes("It can't be kept from here.") && restoreText.includes("within 30 days of the closure to ask for a review."), restoreText);
ok("restore page: no Keep button", (await back.locator("text=Keep my account").count()) === 0);
await back.screenshot({ path: `${shots}/suspend-closed-restore.png`, fullPage: true });
await back.goto(`${BASE}/join/su-other-${stamp}`);
ok("join page: closed by support", (await back.textContent("h1")).includes("SureFrame support closed this account."));

// No "sign in to keep it" reminder goes out for it, even inside the last 3 days.
await prisma.user.update({ where: { id: ownerUser.id }, data: { deleteAt: new Date(Date.now() + 2 * D) } });
await cron("reminders");
ok("no 'deleting in 3 days' email for a support-closed account", !mailTo(ownerEmail).some((m) => m.subject.includes("will be deleted on")) && !(await prisma.user.findUnique({ where: { id: ownerUser.id } })).deletionWarnedAt);

// =====================================================================================================
// Legal hold: nothing of the workspace is deleted, even past its dates
// =====================================================================================================
r = await act({ action: "setLegalHold", workspaceId: ws, on: true, reason: "Preservation request from police, ref 123" });
ok("legal hold on: done, no email", r.status === 200 && !!(await prisma.workspace.findUnique({ where: { id: ws } })).legalHoldAt);
const mailsBefore = mailTo(ownerEmail).length;
const heldKey = `test/${stamp}/susp-held`;
putFile(heldKey);
const held = await prisma.video.create({ data: { id: `suh${stamp.toString(36)}`, mimeType: "video/webm", storageKey: heldKey, status: "UPLOADED", workspaceId: ws, ownerId: ownerUser.id, clientId: ana.id, purgeAt: new Date(Date.now() - 60000) } });
const removedClient = await prisma.client.create({ data: { name: "Removed", token: `su-${stamp}-rm-${"x".repeat(20)}`, workspaceId: ws, removedAt: new Date(Date.now() - 31 * D), purgeAt: new Date(Date.now() - 60000) } });
const past = new Date(Date.now() - 60000);
// Staff who left the team before the hold, closed their own account and are due now: their recording in it stays.
const leaver = await prisma.user.create({ data: { email: `leaver-${stamp}@example.com`, deleteAt: past, deletionRequestedAt: new Date(Date.now() - 31 * D) } });
const leaverVideo = await prisma.video.create({ data: { id: `sul${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/susp-leaver`, status: "UPLOADED", workspaceId: ws, ownerId: leaver.id } });
await prisma.user.update({ where: { id: ownerUser.id }, data: { deleteAt: past } });
await prisma.workspace.update({ where: { id: ws }, data: { deleteAt: past } });
await cron("reminders");
await cron("purge");
ok("held: the account isn't deleted on its date", !!(await prisma.user.findUnique({ where: { id: ownerUser.id } })) && !!(await prisma.workspace.findUnique({ where: { id: ws } })));
ok("held: an expired recording isn't deleted", (await prisma.video.findUnique({ where: { id: held.id } }))?.status === "UPLOADED" && has(heldKey));
ok("held: a removed client isn't deleted", !!(await prisma.client.findUnique({ where: { id: removedClient.id } })));
ok("held: nobody was emailed", mailTo(ownerEmail).length === mailsBefore);
ok("held: a former staff member's account isn't deleted while rows of the held workspace point at it", !!(await prisma.user.findUnique({ where: { id: leaver.id } })) && !!(await prisma.video.findUnique({ where: { id: leaverVideo.id } })));
ok("legal hold logged", (await lastAction({ workspaceId: ws, action: "workspace.legal_hold_on" }))?.reason === "Preservation request from police, ref 123");
ok("legal hold on twice: 409", (await act({ action: "setLegalHold", workspaceId: ws, on: true, reason: "again" })).status === 409);

// Lifted (and blocked again): the next run deletes what was due.
await act({ action: "blockEmail", email: ownerEmail, reason: "Block again after the review", category: "unlawful", notify: false });
r = await act({ action: "setLegalHold", workspaceId: ws, on: false, reason: "Police confirmed copy received" });
ok("legal hold off", r.status === 200 && !(await prisma.workspace.findUnique({ where: { id: ws } })).legalHoldAt);
await cron("reminders");
await cron("purge");
ok("lifted: the account and workspace are deleted", !(await prisma.user.findUnique({ where: { id: ownerUser.id } })) && !(await prisma.workspace.findUnique({ where: { id: ws } })));
ok("lifted: the files are gone", !has(fileKey) && !has(heldKey));
const goneMail = await waitMail(ownerEmail, (m) => m.subject === "Your SureFrame account has been deleted");
ok("deleted email: no 'welcome back', says the address can't be used again", !!goneMail && norm(goneMail.text).includes("This email address can't be used with SureFrame again.") && !norm(goneMail.text).toLowerCase().includes("welcome"), goneMail?.text);
ok("the support log outlives the account", (await prisma.adminAction.count({ where: { OR: [{ userId: ownerUser.id }, { workspaceId: ws }] } })) >= 6);

// =====================================================================================================
// Closing without notice, then reopening after a review
// =====================================================================================================
const soloEmail = `susp-solo${stamp}@example.com`;
const solo = await signIn(soloEmail, "/library");
const soloUser = await prisma.user.findUnique({ where: { email: soloEmail } });
const soloWs = (await prisma.membership.findFirst({ where: { userId: soloUser.id } })).workspaceId;
const soloMails = mailTo(soloEmail).length;
r = await act({ action: "closeAccount", userId: soloUser.id, reason: "Fraud ring, police asked us not to notify", category: "law", confirm: `CLOSE ${soloEmail}`, notify: false, legalHold: true });
ok("close without notice: done, nobody emailed", r.status === 200 && r.body.emailed === false && mailTo(soloEmail).length === soloMails, JSON.stringify(r));
ok("close with legal hold: the workspace is held", !!(await prisma.workspace.findUnique({ where: { id: soloWs } })).legalHoldAt);
row = await lastAction({ userId: soloUser.id, action: "account.close" });
ok("logged as not emailed", row?.details?.notify === false && row.details?.legalHold === true && !("emailedTo" in (row.details ?? {})), JSON.stringify(row?.details));
ok("not blocked unless asked", !(await prisma.blockedEmail.findUnique({ where: { emailHash: sha(soloEmail) } })));
ok("closed: signed out", (await apiStatus(solo)).status === 401);
ok("unsuspending a closed workspace is refused", (await act({ action: "unsuspendWorkspace", workspaceId: soloWs, reason: "x" })).status === 409);
r = await act({ action: "reopenAccount", userId: soloUser.id, reason: "Review: wrong account identified" });
ok("reopen: done and emailed", r.status === 200 && r.body.emailed, JSON.stringify(r));
const reopened = await prisma.user.findUnique({ where: { id: soloUser.id } });
const reopenedWs = await prisma.workspace.findUnique({ where: { id: soloWs } });
ok("reopen: login and workspace open, no deletion date", !reopened.closedAt && !reopened.suspendedAt && !reopened.deleteAt && !reopenedWs.closedAt && !reopenedWs.suspendedAt && !reopenedWs.deleteAt);
ok("reopen: a legal hold stays until support lifts it", !!reopenedWs.legalHoldAt);
const soloAgain = await signIn(soloEmail, "/library");
ok("reopen: signing in works", (await apiStatus(soloAgain)).status === 200);
ok("reopen email", !!(await waitMail(soloEmail, (m) => m.subject === "Your SureFrame account is open again")));
await act({ action: "setLegalHold", workspaceId: soloWs, on: false, reason: "Not needed after review" });

// An account its holder had already deleted, then closed by support: reopening goes back to the holder's own request.
const selfEmail = `susp-self${stamp}@example.com`;
await signIn(selfEmail, "/library");
const selfUser = await prisma.user.findUnique({ where: { email: selfEmail } });
const selfWs = (await prisma.membership.findFirst({ where: { userId: selfUser.id } })).workspaceId;
const selfAsked = new Date(Date.now() - 5 * D);
const selfDate = new Date(selfAsked.getTime() + 30 * D);
await prisma.user.update({ where: { id: selfUser.id }, data: { deletionRequestedAt: selfAsked, deleteAt: selfDate } });
await prisma.workspace.update({ where: { id: selfWs }, data: { deleteAt: selfDate } });
const selfClient = await prisma.client.create({ data: { name: "Paused by closing", token: `su-${stamp}-self-${"x".repeat(20)}`, workspaceId: selfWs, pausedAt: selfAsked } });
r = await act({ action: "closeAccount", userId: selfUser.id, reason, category: "terms", confirm: `CLOSE ${selfEmail}` });
let selfNow = await prisma.user.findUnique({ where: { id: selfUser.id } });
ok("close after their own deletion: their earlier date stays", r.status === 200 && selfNow.deleteAt?.getTime() === selfDate.getTime() && selfNow.deletionRequestedAt?.getTime() === selfAsked.getTime(), JSON.stringify(selfNow));
const selfCloseMail = await waitMail(selfEmail, (m) => m.subject === "Your SureFrame account has been closed");
ok("closure email: says the date is the one they set", norm(selfCloseMail?.text).includes("the date set when you deleted your account"), selfCloseMail?.text);
const selfConsole = await admin.goto(`${BASE}/support/users/${selfUser.id}`).then(() => admin.textContent("[data-testid=user-status]"));
ok("console: shows they had closed it themselves first", norm(selfConsole).includes("they had closed it themselves on"), selfConsole);
r = await act({ action: "reopenAccount", userId: selfUser.id, reason: "Review: closure was a mistake" });
selfNow = await prisma.user.findUnique({ where: { id: selfUser.id } });
const selfWsNow = await prisma.workspace.findUnique({ where: { id: selfWs } });
ok("reopen after their own deletion: support's closure lifted, their deletion date stays", r.status === 200 && r.body.selfDeleted === true && !selfNow.closedAt && !selfNow.suspendedAt && selfNow.deleteAt?.getTime() === selfDate.getTime() && !!selfNow.deletionRequestedAt && !selfWsNow.closedAt && selfWsNow.deleteAt?.getTime() === selfDate.getTime(), JSON.stringify({ r, selfNow }));
ok("reopen after their own deletion: their clients stay paused", !!(await prisma.client.findUnique({ where: { id: selfClient.id } })).pausedAt);
ok("reopen after their own deletion: logged", (await lastAction({ userId: selfUser.id, action: "account.reopen" }))?.details?.selfDeleted === true);
const liftMail = await waitMail(selfEmail, (m) => m.subject === "We've lifted the closure of your SureFrame account");
ok("reopen email: still due to be deleted, as they asked, unless they keep it", norm(liftMail?.text).includes("still due to be deleted for good on") && norm(liftMail?.text).includes("choose Keep my account") && !norm(liftMail?.text).includes("won't be deleted"), liftMail?.text);
const selfBack = await signIn(selfEmail, "/library", "/account/restore");
ok("reopen after their own deletion: they can keep it themselves", !!(await selfBack.waitForSelector("text=Keep my account", { timeout: 15000 }).catch(() => null)));

// =====================================================================================================
// Cloud backup ending while suspended: backed-up recordings wait (no 30-day clock, nothing deleted unseen),
// and get their 30 days, with the owner told, once it's lifted. Unfinished uploads wait too.
// =====================================================================================================
const bkEmail = `susp-backup${stamp}@example.com`;
await signIn(bkEmail, "/library");
const bkUser = await prisma.user.findUnique({ where: { email: bkEmail } });
const bkWs = (await prisma.membership.findFirst({ where: { userId: bkUser.id } })).workspaceId;
const bkSub = createSubscription(`cus_bk${stamp}`, bkWs, "sureframe_solo_monthly");
await prisma.workspace.update({ where: { id: bkWs }, data: { name: `Backup ${stamp}`, plan: "SOLO", cloudBackup: true, stripeCustomerId: `cus_bk${stamp}`, stripeSubscriptionId: bkSub.id, subscriptionStatus: "active", currentPeriodEnd: new Date(Date.now() + 30 * D) } });
const bkVideo = await prisma.video.create({ data: { id: `sub${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/susp-bk`, status: "UPLOADED", workspaceId: bkWs, ownerId: bkUser.id } });
const bkUpload = await prisma.video.create({ data: { id: `suu${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/susp-bk-up`, status: "RECORDING", uploadId: "u-bk", workspaceId: bkWs, ownerId: bkUser.id } });
r = await act({ action: "suspendWorkspace", workspaceId: bkWs, reason: "Backup test", category: "terms", stopRenewal: true });
ok("backup: suspended with renewal stopped", r.status === 200 && r.body.billing?.renewal === "stopped", JSON.stringify(r));
const bkSusp = norm((await waitMail(bkEmail, (m) => m.subject === "Your SureFrame account has been suspended"))?.text);
ok("suspension email: says cloud backup ends with the plan and backed-up recordings wait", bkSusp.includes("Cloud backup ends with your plan. Backed-up recordings are kept while the account is suspended; once it's lifted, our copies are deleted 30 days later"), bkSusp);
// The plan ends while it's suspended.
const bkStripe = state.subs.find((x) => x.id === bkSub.id);
bkStripe.status = "canceled";
ok("backup: the subscription-ended webhook is taken", (await webhook(admin, "customer.subscription.deleted", bkStripe)).status() === 200);
let bkW = await prisma.workspace.findUnique({ where: { id: bkWs } });
ok("backup: cloud backup is off once the plan ends", !bkW.cloudBackup && !bkW.stripeSubscriptionId);
ok("backup: but no deletion date while suspended", (await prisma.video.findUnique({ where: { id: bkVideo.id } })).purgeAt === null);
ok("backup: and no 'backup ended' email while nobody can save them", !mailTo(bkEmail).some((m) => m.subject === "Cloud backup has ended for your recordings"));
// An upload refused for more than a week while suspended isn't thrown away.
await prisma.$executeRaw`UPDATE "Video" SET "updatedAt" = now() - interval '8 days' WHERE id = ${bkUpload.id}`;
await cron("purge");
ok("backup: an unfinished upload waits while suspended, past the week", !!(await prisma.video.findUnique({ where: { id: bkUpload.id } })));
r = await act({ action: "unsuspendWorkspace", workspaceId: bkWs, reason: "Backup test done" });
ok("backup: unsuspended", r.status === 200, JSON.stringify(r));
const bkPurge = (await prisma.video.findUnique({ where: { id: bkVideo.id } })).purgeAt;
ok("backup: the 30 days start when it's lifted", !!bkPurge && Math.abs(bkPurge.getTime() - (Date.now() + 30 * D)) < 120_000, String(bkPurge));
const bkEnded = await waitMail(bkEmail, (m) => m.subject === "Cloud backup has ended for your recordings");
ok("backup: the owner is told the date then", !!bkEnded && norm(bkEnded.text).includes("will be deleted on"), bkEnded?.text);
ok("backup: the waiting upload gets a new week", Date.now() - (await prisma.video.findUnique({ where: { id: bkUpload.id } })).updatedAt.getTime() < 120_000);
await cron("purge");
ok("backup: so it isn't aborted on the next run", !!(await prisma.video.findUnique({ where: { id: bkUpload.id } })));

// =====================================================================================================
// Blocking an address on its own (no account yet), and the support log's 7-year limit
// =====================================================================================================
const stranger = `Susp.Stranger${stamp}@gmail.com`;
r = await act({ action: "blockEmail", email: stranger, reason: "Known spammer" });
ok("block an address: done", r.status === 200);
ok("block twice: 409", (await act({ action: "blockEmail", email: stranger, reason: "again" })).status === 409);
const spam = await (await browser.newContext()).newPage();
await spam.goto(`${BASE}/login?next=/library`);
await spam.fill('input[name="email"]', `susp.stranger${stamp}+x@gmail.com`.replace(".", ""));
await spam.click("text=Continue");
await spam.waitForURL((u) => u.searchParams.get("error") === "blocked", { timeout: 30000 }).catch(() => null);
ok("a Gmail address with other dots or a +tag is blocked too", new URL(spam.url()).searchParams.get("error") === "blocked");
ok("no account was made for it", !(await prisma.user.findFirst({ where: { email: { contains: `stranger${stamp}`, mode: "insensitive" } } })));
await act({ action: "unblockEmail", email: stranger, reason: "cleanup" });
// A login still signed in when its address is blocked can't join a team with it.
const joinerEmail = `susp-joiner${stamp}@example.com`;
ok("block a signed-up address: needs the reason the email gives", (await act({ action: "blockEmail", email: joinerEmail, reason: "Blocked while signed in" })).status === 400);
r = await act({ action: "blockEmail", email: joinerEmail, reason: "Blocked while signed in", category: "terms" });
ok("block a signed-up address: linked to its account", r.status === 200 && (await prisma.blockedEmail.findUnique({ where: { emailHash: sha(joinerEmail) } }))?.userId === (await prisma.user.findUnique({ where: { email: joinerEmail } })).id);
const blockMail = await waitMail(joinerEmail, (m) => m.subject === "This email address can no longer be used with SureFrame");
ok("block a signed-up address: the login is emailed why, with the review route", r.body?.emailed === true && norm(blockMail?.text).includes(`We've stopped this email address (${joinerEmail}) being used to sign in or sign up to SureFrame because of a breach of our Terms of Service.`) && norm(blockMail?.text).includes("within 30 days"), blockMail?.text);
res = await joiner.request.post(BASE + "/api/team/join", { data: { token: `su-other-${stamp}` } });
ok("blocked address with an old sign-in: joining a team refused", res.status() === 403 && (await res.json()).code === "EMAIL_BLOCKED");
await joiner.goto(`${BASE}/join/su-other-${stamp}`);
ok("join page: says the address can't be used", (await joiner.textContent("h1")).includes("This email address can't be used with SureFrame."));
await act({ action: "unblockEmail", email: joinerEmail, reason: "cleanup" });

const old = await prisma.adminAction.create({ data: { actorEmail: ADMIN, action: "account.warn", target: "old", createdAt: new Date(Date.now() - (7 * 365 + 3) * D) } });
const recent = await prisma.adminAction.create({ data: { actorEmail: ADMIN, action: "account.warn", target: "recent", createdAt: new Date(Date.now() - 6 * 365 * D) } });
const purgeRun = await cron("purge");
ok("daily job prunes support records over 7 years old", purgeRun.adminActionsPruned >= 1 && !(await prisma.adminAction.findUnique({ where: { id: old.id } })) && !!(await prisma.adminAction.findUnique({ where: { id: recent.id } })), JSON.stringify(purgeRun));
await prisma.adminAction.delete({ where: { id: recent.id } });

await browser.close();
server.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
