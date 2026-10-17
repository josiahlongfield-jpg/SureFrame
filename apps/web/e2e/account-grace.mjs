// Deleting your own account: it's closed at once (signed out everywhere, clients' links stop, invites cancelled,
// nothing emailed in the business's name), there are 30 days to keep it by signing in again, then it's deleted.
// Covers the closing email, the 3-day reminder, the restore page (fresh sign-in only, Continue, too late), keeping
// it (clients the plan covers come back, plan-ended note), guards while closed (reminders, expiry warnings, seat
// changes, joining teams), staff leaving their team at once, and the final deletion.
// Needs the app running with AUTH_DEV_LOGIN=true, SUPPORT_EMAIL=owner@test.dev, local file storage (no S3_BUCKET),
// no RESEND_API_KEY (mail goes to .data/outbox) and CRON_SECRET.
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret";
const shots = process.argv[2] ?? "/tmp";
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
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
const longDay = (d, timeZone) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone }).format(d);
const norm = (s) => (s ?? "").replace(/[\s  ]+/g, " ").trim();
const sha = (t) => createHash("sha256").update(t).digest("hex");
const status = async (p) => (await p).status();

// Local storage driver: files live under .data/uploads/<key>.
const uploads = path.resolve(".data/uploads");
const putFile = (key) => {
  mkdirSync(path.dirname(path.join(uploads, key)), { recursive: true });
  writeFileSync(path.join(uploads, key), "encrypted bytes");
};
const has = (key) => existsSync(path.join(uploads, key));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
/** Dev sign-in in a new browser; `lands` is where it should end up (a closed account goes to the restore page). */
async function signIn(email, next = "/library", lands = next.split("?")[0]) {
  // Agreed to the current Terms and Privacy Policy, so signing in isn't stopped at /agree (e2e/agree.mjs).
  await agreed(email);
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname === lands, { timeout: 60000 });
  // The page streams in behind app/loading.tsx; it makes a new account's workspace, so wait until it has rendered.
  await page.waitForSelector("[role=status][aria-label=Loading]", { state: "detached", timeout: 30000 }).catch(() => {});
  return page;
}
async function closeAccount(page, email) {
  await page.goto(BASE + "/settings/account");
  await page.fill('input[name="confirm"]', email);
  await page.click("text=Delete my account");
  await page.waitForURL((u) => u.pathname === "/login", { timeout: 60000 });
}

// =====================================================================================================
// Part 1: a business on Free closes its account, keeps it, closes it again and is deleted.
// =====================================================================================================
const TZ = "Australia/Brisbane";
const ownerEmail = `grace-owner${stamp}@example.com`;
const owner = await signIn(ownerEmail, "/clients");
// Another device, signed in before the account is closed.
const laptop = await signIn(ownerEmail, "/library");
const ownerUser = await prisma.user.findUnique({ where: { email: ownerEmail } });
const ws = (await prisma.membership.findFirst({ where: { userId: ownerUser.id, role: "OWNER" } })).workspaceId;
const business = `Grace ${stamp}`;
await prisma.workspace.update({ where: { id: ws }, data: { name: business, timezone: TZ } });
const mk = (name, email, i, data = {}) =>
  prisma.client.create({ data: { name, email, token: `gr-${stamp}-${i}-${"x".repeat(20)}`, workspaceId: ws, createdAt: new Date(Date.now() - (50 - i) * 60000), ...data } });
const ana = await mk(`Ana ${stamp}`, `ana-gr${stamp}@example.com`, 0);
await mk(`Ben ${stamp}`, null, 1);
await mk(`Cal ${stamp}`, null, 2);
// Free covers 3 clients: Dee was already paused before the account was closed.
const dee = await mk(`Dee ${stamp}`, null, 3, { pausedAt: new Date(Date.now() - D) });
const fileKey = `test/${stamp}/grace-ana`;
putFile(fileKey);
const anaVideo = await prisma.video.create({ data: { id: `gra${stamp.toString(36)}`, mimeType: "video/webm", storageKey: fileKey, status: "UPLOADED", workspaceId: ws, ownerId: ownerUser.id, clientId: ana.id } });
const invite = await prisma.invite.create({ data: { workspaceId: ws, tokenHash: sha(`gr-invite-${stamp}`), teamKeyWrap: "w".repeat(60), expiresAt: new Date(Date.now() + 7 * D), invitedById: ownerUser.id } });

// Ana opened her link on her phone before.
const anaPhone = await (await browser.newContext()).newPage();
await anaPhone.goto(`${BASE}/c/${ana.token}`);
ok("before: Ana's link opens her inbox", new URL(anaPhone.url()).pathname === "/inbox" && (await anaPhone.locator("[data-testid=client-closed]").count()) === 0);

// ---- Settings > Account explains it ----
await owner.goto(BASE + "/settings/account");
const explainer = norm(await owner.textContent("[data-testid=delete-explainer]"));
const roughly = longDay(new Date(Date.now() + 30 * D), TZ);
ok("explainer: closed now, deleted on the date, sign in to keep it", explainer.includes(`Your account is closed straight away and permanently deleted on ${roughly}. Until then, sign in to keep it with everything as it was.`), explainer);
ok("explainer: workspace goes with it, links stop, expiry carries on", explainer.includes("Your workspace goes with it") && explainer.includes("links stop working now") && explainer.includes("still expire on their usual dates") && explainer.includes("removed clients are still deleted on their dates") && !explainer.includes("won't renew"), explainer);
ok("explainer: sooner on request", explainer.includes("Want it deleted sooner? Email support@sureframe.app."), explainer);
await owner.screenshot({ path: `${shots}/account-grace-settings.png`, fullPage: true });

// ---- Closing ----
await closeAccount(owner, ownerEmail);
ok("after closing: the sign-in page says 30 days and how to keep it", norm(await owner.textContent("[data-testid=deleted-note]").catch(() => "")).includes("Your account is closed and will be deleted in 30 days. We've emailed you the date. Changed your mind? Sign in before then to keep it."));
let u = await prisma.user.findUnique({ where: { id: ownerUser.id } });
let w = await prisma.workspace.findUnique({ where: { id: ws } });
ok("closed: deletion 30 days after the request", !!u.deleteAt && !!u.deletionRequestedAt && u.deleteAt.getTime() === u.deletionRequestedAt.getTime() + 30 * D && Math.abs(u.deletionRequestedAt.getTime() - Date.now()) < 120_000, JSON.stringify(u));
ok("closed: the workspace carries the same date, nothing billing to stop", w.deleteAt?.getTime() === u.deleteAt.getTime() && !w.renewalStoppedAt);
const clientsNow = await prisma.client.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "asc" } });
ok("closed: every client paused", clientsNow.every((c) => c.pausedAt));
ok("closed: Dee's earlier pause kept as it was", clientsNow[3].pausedAt.getTime() === dee.pausedAt.getTime());
ok("closed: pending invite cancelled", !!(await prisma.invite.findUnique({ where: { id: invite.id } })).revokedAt);
ok("closed: nothing deleted yet", !!(await prisma.video.findUnique({ where: { id: anaVideo.id } })) && has(fileKey));
const deleteDay = longDay(u.deleteAt, TZ);
const closedMail = await waitMail(ownerEmail, (m) => m.subject === `Your SureFrame account will be deleted on ${deleteDay}`);
ok("emailed: subject has the date in the business's time zone", !!closedMail, JSON.stringify(mailTo(ownerEmail).map((m) => m.subject)));
const ct = closedMail?.text ?? "";
ok("email: deleted for good with the workspace, sign in to keep it", ct.includes(`It will be deleted for good on ${deleteDay}, with ${business} and its recordings, clients, to-dos and notes.`) && ct.includes("Sign in before then to keep your account with everything as it was."), ct);
ok("email: what happens now", ct.includes("You're signed out on every device.") && ct.includes(`Your clients can't open their links, and they aren't sent reminders or new-video emails from ${business}.`), ct);
ok("email: recordings still expire; no plan line on Free", ct.includes("Recordings without cloud backup still expire on their usual dates") && ct.includes("removed clients are still deleted on their dates") && !ct.includes("plan won't renew"), ct);
ok("email: Keep my account button, and 'didn't ask for this'", ct.includes("Keep my account: http") && ct.includes("/account/restore") && ct.includes("Didn't ask for this? Sign in, keep your account and contact support@sureframe.app."), ct);
ok("email: plain SureFrame email", !!closedMail && closedMail.from.startsWith("SureFrame"));

// ---- Every device is signed out; an old sign-in can't keep it ----
ok("other device: API says sign in", (await status(laptop.request.get(BASE + "/api/clients"))) === 401);
await laptop.goto(BASE + "/library");
await laptop.waitForURL((u) => u.pathname === "/login", { timeout: 15000 }).catch(() => null);
ok("other device: pages go to sign-in, not to keep it", new URL(laptop.url()).pathname === "/login" && (await laptop.locator('input[name="email"]').count()) === 1);
await laptop.goto(BASE + "/account/restore");
ok("other device: the restore page asks to sign in again, with no Keep button", (await laptop.textContent("h1")).includes("Sign in again to keep your account") && (await laptop.locator("text=Keep my account").count()) === 0);

// ---- The clients' side ----
const fresh = await (await browser.newContext()).newPage();
await fresh.goto(`${BASE}/c/${ana.token}`);
ok("old link: lands on the closed notice", new URL(fresh.url()).searchParams.get("closed") === "1");
ok("notice: names the business, not a plan change", norm(await fresh.textContent("[data-testid=client-closed]").catch(() => "")).includes(`${business} has closed their SureFrame account`) && (await fresh.locator("[data-testid=client-paused]").count()) === 0);
ok("old link: remembers nothing on this device", !(await fresh.context().cookies()).some((c) => c.name.startsWith("fc_client_")));
await fresh.screenshot({ path: `${shots}/account-grace-client.png`, fullPage: true });
await anaPhone.goto(BASE + "/inbox");
ok("Ana's phone: inbox shows the closed notice", norm(await anaPhone.textContent("[data-testid=client-closed]").catch(() => "")).includes(`${business} has closed their SureFrame account`) && (await anaPhone.locator("[data-testid=client-paused]").count()) === 0);
await anaPhone.goto(`${BASE}/v/${anaVideo.id}`);
ok("Ana's phone: can't open her video", (await anaPhone.textContent("body")).includes("This video is private"));

// ---- Nothing goes out in the business's name, and seat changes wait ----
const item = await prisma.item.create({ data: { kind: "TASK", body: "t".repeat(40), dueAt: new Date(Date.now() + 30 * 60000), authorName: "Owner", workspaceId: ws, remindTeam: true } });
const reminder = await prisma.reminder.create({ data: { itemId: item.id, sendAt: new Date(Date.now() - 60000), to: "TEAM" } });
const soon = await prisma.video.create({ data: { id: `grs${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/soon`, status: "UPLOADED", workspaceId: ws, ownerId: ownerUser.id, clientId: ana.id, purgeAt: new Date(Date.now() + 12 * 3_600_000) } });
const before = mailTo(ownerEmail).length;
await cron("reminders");
const rem = await prisma.reminder.findUnique({ where: { id: reminder.id } });
ok("a due reminder is skipped: account closed", !!rem.sentAt && rem.error === "account closed", JSON.stringify(rem));
ok("no expiry warning while closed", !(await prisma.video.findUnique({ where: { id: soon.id } })).expiryWarnedAt);
const founder = await signIn("owner@test.dev", "/support/accounts");
async function setPlan(plan) {
  await founder.goto(BASE + "/support/accounts");
  await founder.fill('input[name="email"]', ownerEmail);
  await founder.selectOption("select", plan);
  await founder.fill('textarea[name="reason"]', "Test plan change");
  await founder.click("text=Save");
  await founder.waitForSelector(plan === "FREE" ? "text=back on the Free plan" : "text=free of charge");
}
await setPlan("STUDIO");
ok("a bigger plan meanwhile doesn't reopen clients' links", (await prisma.client.count({ where: { workspaceId: ws, pausedAt: null } })) === 0);
await setPlan("FREE");
ok("nothing emailed to the owner while closed", mailTo(ownerEmail).length === before, JSON.stringify(mailTo(ownerEmail).slice(before).map((m) => m.subject)));

// An invite made out somehow while closed still can't be used.
await prisma.invite.create({ data: { workspaceId: ws, tokenHash: sha(`gr-late-${stamp}`), teamKeyWrap: "w".repeat(60), expiresAt: new Date(Date.now() + 7 * D), invitedById: ownerUser.id } });
const joiner = await (await browser.newContext()).newPage();
await joiner.goto(`${BASE}/join/gr-late-${stamp}`);
ok("joining a closed business's team is refused", (await joiner.textContent("h1")).includes("This team has closed its SureFrame account"));

// ---- Signing in again: the restore page; Continue leaves it closed ----
const back = await signIn(ownerEmail, "/library", "/account/restore");
const msg = norm(await back.textContent("main"));
ok("restore page: the date and what keeping it does", msg.includes(`Your account is scheduled for deletion on ${deleteDay}`) && msg.includes(`Keep it and ${business} carries on as it was`) && msg.includes("clients your plan covers"), msg);
await back.screenshot({ path: `${shots}/account-grace-restore.png`, fullPage: true });
await back.click("button:text-is('Continue')");
await back.waitForURL((u) => u.pathname === "/login" && u.searchParams.get("closed") === "1");
ok("Continue: signed out, still closed", (await back.locator("[data-testid=closed-note]").count()) === 1 && !!(await prisma.user.findUnique({ where: { id: ownerUser.id } })).deleteAt);
ok("the sign-in page doesn't bounce a closed account", (await back.locator('input[name="email"]').count()) === 1);

// ---- Keeping it ----
// As if a subscription we had stopped ended meanwhile.
await prisma.workspace.update({ where: { id: ws }, data: { renewalStoppedAt: new Date() } });
// And cloud backup ended with it: a backed-up recording has no deletion date yet (its 30 days wait while closed).
const backedUp = await prisma.video.create({ data: { id: `agb${Date.now().toString(36)}`, mimeType: "video/webm", storageKey: `test/grace-backed-${Date.now()}`, status: "UPLOADED", workspaceId: ws, ownerId: ownerUser.id } });
const keeper = await signIn(ownerEmail, "/clients", "/account/restore");
ok("restore page: says the subscription ended", norm(await keeper.textContent("main")).includes("Your subscription has ended. Choose a plan in Settings > Billing"));
ok("restore page: says removed clients due meanwhile are gone", norm(await keeper.textContent("[data-testid=restore-removed-clients]").catch(() => "")) === "Removed clients whose 30 days ended while it was closed have been deleted and can't be restored.");
const waitingNote = norm(await keeper.textContent("[data-testid=restore-backup-ended]").catch(() => ""));
ok("restore page: says backed-up recordings get 30 days once kept", /^Cloud backup ended while it was closed\. Keep it and our copies of \d+ recordings? are deleted 30 days later, on /.test(waitingNote), waitingNote);
await keeper.click("button:text-is('Keep my account')");
await keeper.waitForURL((u) => u.pathname === "/library", { timeout: 30000 });
ok("kept: lands on the Library with the plan-ended note", new URL(keeper.url()).searchParams.get("restored") === "ended" && norm(await keeper.textContent("[data-testid=account-restored]")).includes("Your account is open again and won't be deleted. Your subscription ended while it was closed."));
ok("kept: links to Billing", (await keeper.locator("[data-testid=account-restored] >> a[href='/settings/billing']").count()) === 1);
u = await prisma.user.findUnique({ where: { id: ownerUser.id } });
w = await prisma.workspace.findUnique({ where: { id: ws } });
ok("kept: the dates are cleared", !u.deleteAt && !u.deletionRequestedAt && !u.deletionWarnedAt && !w.deleteAt && !w.renewalStoppedAt);
const kept = await prisma.client.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "asc" } });
ok("kept: the 3 clients Free covers are back, Dee stays paused", kept.slice(0, 3).every((c) => !c.pausedAt) && !!kept[3].pausedAt);
const keptMail = await waitMail(ownerEmail, (m) => m.subject === "Your SureFrame account is open again");
ok("kept: emailed as a security notice", !!keptMail && keptMail.text.includes("Didn't do this? Contact support@sureframe.app straight away.") && keptMail.text.includes("Your subscription ended while your account was closed."));
await anaPhone.goto(`${BASE}/c/${ana.token}`);
ok("kept: Ana's same link works again", new URL(anaPhone.url()).pathname === "/inbox" && (await anaPhone.locator("[data-testid=client-closed]").count()) === 0 && (await anaPhone.textContent("main")).includes(`From ${business}`));
ok("kept: the owner can use the app", (await status(keeper.request.get(BASE + "/api/clients"))) === 200);
ok("kept: a sign-in from before it was closed stays signed out", (await status(laptop.request.get(BASE + "/api/clients"))) === 401);
const backedUpNow = (await prisma.video.findUnique({ where: { id: backedUp.id } })).purgeAt;
ok("kept: the backed-up recording's 30 days start now", !!backedUpNow && Math.abs(backedUpNow.getTime() - (Date.now() + 30 * D)) < 120_000, String(backedUpNow));
ok("kept: the owner is told the date", !!(await waitMail(ownerEmail, (m) => m.subject === "Cloud backup has ended for your recordings")));

// ---- Closing again: the 3-day reminder, too late to keep, and the deletion ----
await closeAccount(keeper, ownerEmail);
u = await prisma.user.findUnique({ where: { id: ownerUser.id } });
ok("closed again: a new date", !!u.deleteAt && u.deletionRequestedAt > new Date(Date.now() - 120_000));
const soonDate = new Date(Date.now() + 2 * D);
await prisma.user.update({ where: { id: ownerUser.id }, data: { deleteAt: soonDate } });
await prisma.workspace.update({ where: { id: ws }, data: { deleteAt: soonDate } });
await cron("reminders");
const reminderMail = await waitMail(ownerEmail, (m) => m.subject === `Your SureFrame account will be deleted on ${longDay(soonDate, TZ)}` && m.text.includes("After that it can't be brought back."));
ok("3 days before: reminded, with the date and the Keep button", !!reminderMail && reminderMail.text.includes("/account/restore") && reminderMail.text.includes(`with ${business} and its recordings`), JSON.stringify(mailTo(ownerEmail).map((m) => m.subject)));
ok("reminder: recorded", !!(await prisma.user.findUnique({ where: { id: ownerUser.id } })).deletionWarnedAt);
const reminders = mailTo(ownerEmail).filter((m) => m.text.includes("After that it can't be brought back.")).length;
await cron("reminders");
await cron("purge");
ok("reminder: only once", mailTo(ownerEmail).filter((m) => m.text.includes("After that it can't be brought back.")).length === reminders);

// The date passes before the purge runs: it can't be kept any more.
await prisma.user.update({ where: { id: ownerUser.id }, data: { deleteAt: new Date(Date.now() - 60000) } });
const late = await signIn(ownerEmail, "/library", "/account/restore");
ok("after the date: 'being deleted', no Keep button", (await late.textContent("h1")).includes("Your account is being deleted") && (await late.locator("button:text-is('Keep my account')").count()) === 0);

// A stored file that can't be deleted (here a folder stands in its place): nothing is deleted, so the next run tries again.
const filePath = path.join(uploads, fileKey);
rmSync(filePath, { force: true });
mkdirSync(filePath, { recursive: true });
writeFileSync(path.join(filePath, "x"), "x");
await cron("reminders");
ok("a file that can't be deleted: the account and its rows stay for the next run", !!(await prisma.user.findUnique({ where: { id: ownerUser.id } })) && !!(await prisma.video.findUnique({ where: { id: anaVideo.id } })));
rmSync(filePath, { recursive: true, force: true });
putFile(fileKey);

const res = await cron("reminders");
ok("the job deletes it once the date has passed", typeof res.accountsPurged === "number" && res.accountsPurged >= 1 && !(await prisma.user.findUnique({ where: { id: ownerUser.id } })), JSON.stringify(res));
ok("deleted: the workspace, its clients and videos", !(await prisma.workspace.findUnique({ where: { id: ws } })) && (await prisma.client.count({ where: { workspaceId: ws } })) === 0 && !(await prisma.video.findUnique({ where: { id: anaVideo.id } })));
ok("deleted: its files", !has(fileKey));
const goneMail = await waitMail(ownerEmail, (m) => m.subject === "Your SureFrame account has been deleted");
ok("deleted: emailed", !!goneMail && goneMail.text.includes(`with ${business} and its recordings`) && goneMail.text.includes("starts a new, empty account"));
const gone = await (await browser.newContext()).newPage();
await gone.goto(`${BASE}/c/${ana.token}`);
ok("deleted: the old client link is no longer active", new URL(gone.url()).searchParams.get("invalid") === "1");
await late.goto(BASE + "/account/restore");
await late.waitForURL((u) => u.pathname === "/login", { timeout: 15000 }).catch(() => null);
ok("deleted: an old sign-in just gets the sign-in page", new URL(late.url()).pathname === "/login" && (await late.locator('input[name="email"]').count()) === 1);

// =====================================================================================================
// Part 2: a staff member closes their account: they leave the team at once and don't come back with it.
// =====================================================================================================
const teamOwnerEmail = `grace-team${stamp}@example.com`;
const teamOwner = await signIn(teamOwnerEmail, "/settings/team");
const teamOwnerUser = await prisma.user.findUnique({ where: { email: teamOwnerEmail } });
const team = (await prisma.membership.findFirst({ where: { userId: teamOwnerUser.id, role: "OWNER" } })).workspaceId;
const teamName = `Crew ${stamp}`;
await prisma.workspace.update({ where: { id: team }, data: { name: teamName, plan: "STUDIO" } });
const samEmail = `grace-sam${stamp}@example.com`;
const sam = await prisma.user.create({ data: { email: samEmail, name: `Sam ${stamp}`, activeWorkspaceId: team, memberships: { create: { workspaceId: team, role: "ADMIN" } } } });
await prisma.invite.create({ data: { workspaceId: team, tokenHash: sha(`gr-sam-in-${stamp}`), teamKeyWrap: "w".repeat(60), expiresAt: new Date(Date.now() - D), invitedById: teamOwnerUser.id, acceptedAt: new Date(), acceptedById: sam.id } });
const samInvite = await prisma.invite.create({ data: { workspaceId: team, tokenHash: sha(`gr-sam-out-${stamp}`), teamKeyWrap: "w".repeat(60), expiresAt: new Date(Date.now() + 7 * D), invitedById: sam.id } });
const zoe = await prisma.client.create({ data: { name: `Zoe ${stamp}`, token: `gr-zoe-${stamp}-${"x".repeat(20)}`, workspaceId: team, assignedToId: sam.id } });
const samVideo = await prisma.video.create({ data: { id: `grv${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/sam`, status: "UPLOADED", workspaceId: team, ownerId: sam.id, clientId: zoe.id } });
const samReply = await prisma.reply.create({ data: { kind: "TEXT", body: "sealed", encrypted: true, authorName: "Sam", authorUserId: sam.id, videoId: samVideo.id } });

const samPage = await signIn(samEmail, "/library");
await samPage.goto(BASE + "/settings/account");
const samExplainer = norm(await samPage.textContent("[data-testid=delete-explainer]"));
ok("staff explainer: leave the team now, keeping won't put you back", samExplainer.includes(`You leave ${teamName} straight away, and keeping your account won't put you back.`) && !samExplainer.includes("Your workspace goes with it"), samExplainer);
await closeAccount(samPage, samEmail);
ok("staff: membership ended at once", !(await prisma.membership.findFirst({ where: { workspaceId: team, userId: sam.id } })));
const teamAfter = await prisma.workspace.findUnique({ where: { id: team } });
ok("staff: the team is asked to reset its keys, and stays open", teamAfter.keyResetNeeded === `Sam ${stamp}` && !teamAfter.deleteAt);
ok("staff: their recording and reply stay with the team, under the owner", (await prisma.video.findUnique({ where: { id: samVideo.id } })).ownerId === teamOwnerUser.id && (await prisma.reply.findUnique({ where: { id: samReply.id } })).authorUserId === teamOwnerUser.id);
ok("staff: their client goes back to the shared list", (await prisma.client.findUnique({ where: { id: zoe.id } })).assignedToId === null);
ok("staff: their unused invite stops working", !!(await prisma.invite.findUnique({ where: { id: samInvite.id } })).revokedAt);
const leftMail = await waitMail(teamOwnerEmail, (m) => m.subject === `Sam ${stamp} closed their SureFrame account and left ${teamName}`);
ok("staff: the owner is emailed to reset the keys", !!leftMail && leftMail.text.includes("reset the keys on Settings > Team"));
const samMail = await waitMail(samEmail, (m) => m.subject.startsWith("Your SureFrame account will be deleted on"));
ok("staff: their email says they've left the team", !!samMail && samMail.text.includes(`You've left ${teamName}. Keeping your account won't put you back on that team; ask them for a new invite.`) && !samMail.text.includes("Your clients can't"), samMail?.text);
await teamOwner.goto(BASE + "/settings/team");
ok("staff: the team page asks to reset the keys", !!(await teamOwner.waitForSelector(`text=Sam ${stamp} left the team and still holds its keys`, { timeout: 15000 }).catch(() => null)));

// Joining a team is refused while closed.
const newInvite = `gr-sam-again-${stamp}`;
await prisma.invite.create({ data: { workspaceId: team, tokenHash: sha(newInvite), teamKeyWrap: "w".repeat(60), expiresAt: new Date(Date.now() + 7 * D), invitedById: teamOwnerUser.id } });
const samJoin = await signIn(samEmail, `/join/${newInvite}`);
ok("closed staff: the invite page says to keep the account first", (await samJoin.textContent("h1")).includes("Your account is closed and waiting to be deleted") && (await samJoin.locator("a:text-is('Keep my account')").count()) === 1);
ok("closed staff: joining is refused (403)", (await status(samJoin.request.post(BASE + "/api/team/join", { data: { token: newInvite } }))) === 403);
ok("closed staff: still not on the team", !(await prisma.membership.findFirst({ where: { workspaceId: team, userId: sam.id } })));

// Keeping it doesn't bring the team back. Said even when they joined over a month ago (the daily clean-up keeps that invite).
await prisma.invite.updateMany({ where: { acceptedById: sam.id }, data: { acceptedAt: new Date(Date.now() - 60 * D) } });
await cron("purge");
ok("closed staff: the invite they joined with outlives the monthly clean-up while closed", (await prisma.invite.count({ where: { acceptedById: sam.id } })) > 0);
await samJoin.goto(BASE + "/account/restore");
ok("closed staff: the restore page says the team won't come back", norm(await samJoin.textContent("main")).includes(`Keeping it won't put you back on ${teamName}; ask them for a new invite.`));
await samJoin.click("button:text-is('Keep my account')");
await samJoin.waitForURL((u) => u.pathname === "/library", { timeout: 30000 });
ok("staff kept: open again, on their own and not on the team", new URL(samJoin.url()).searchParams.get("restored") === "1" && !(await prisma.membership.findFirst({ where: { workspaceId: team, userId: sam.id } })) && !(await prisma.user.findUnique({ where: { id: sam.id } })).deleteAt);

await browser.close();
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
