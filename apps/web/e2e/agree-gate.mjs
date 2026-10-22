// Agreeing to the Terms of Service and Privacy Policy (src/lib/terms.ts, /agree): new logins land on /agree and
// the API refuses with 403 TERMS_REQUIRED until they tick the box and press Agree, which records who agreed to
// which versions, when, from where. A version change sends existing account holders back with an "updated"
// heading. What's still allowed before agreeing: finishing or discarding an upload already under way, the data
// download, deleting the account, keeping a closed account, and support's own console. Suspended, paused and
// closed accounts still go where they went before. Records survive account deletion and go after 7 years.
// Also: the legal pages show their versions and link to /legal/archive, and nothing scrolls sideways at 320px.
// Needs the app running with AUTH_DEV_LOGIN=true, SUPPORT_EMAIL=owner@test.dev (the support admin), local file
// storage, no RESEND_API_KEY and CRON_SECRET (the usual test env).
import { chromium } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PRIVACY_VERSION, TERMS_VERSION } from "./agree.mjs";
import { start as startStripe, state as stripeState } from "./fake-stripe.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret";
const ADMIN = "owner@test.dev";
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
const norm = (s) => (s ?? "").replace(/[\s ]+/g, " ").trim();
const cron = async (p) => {
  const r = await fetch(`${BASE}/api/cron/${p}`, { headers: { Authorization: `Bearer ${CRON}` } });
  return r.status === 200 ? r.json() : { status: r.status };
};
const rows = (userId) => prisma.termsAcceptance.findMany({ where: { userId }, orderBy: { acceptedAt: "asc" } });
const path = (page) => new URL(page.url()).pathname;
const api = async (page, method, p, data) => {
  const r = await page.request.fetch(BASE + p, { method, ...(data !== undefined ? { data } : {}) });
  let body = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status(), body };
};
/** Opens a page and waits for any redirect to land (pages that stream redirect in the browser). */
async function visit(page, p, lands) {
  await page.goto(BASE + p);
  if (lands) await page.waitForURL((u) => u.pathname === lands, { timeout: 30000 }).catch(() => {});
  else await page.waitForLoadState("networkidle").catch(() => {});
}
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
// The billing portal (managing or cancelling a subscription works before agreeing) talks to the fake Stripe.
const stripeServer = await startStripe();
/** Dev login, without agreeing to anything: waits until it lands on `lands` (or gives up and leaves it where it is). */
async function signIn(email, next = "/library", { lands = "/agree", viewport = { width: 1280, height: 900 } } = {}) {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  // In development a page compiling for the first time can refresh every open tab and cut a redirect short: reload once.
  await page.waitForURL((u) => u.pathname === lands, { timeout: 30000 }).catch(async () => {
    await page.reload();
    await page.waitForURL((u) => u.pathname === lands, { timeout: 60000 }).catch(() => {});
  });
  await page.waitForLoadState("networkidle").catch(() => {});
  return page;
}
/** The notice of the current versions went out more than 30 days ago, so they're in effect for this existing account holder. */
const noticeOver = (userId, email) =>
  prisma.termsNotice.upsert({
    where: { userId_termsVersion_privacyVersion: { userId, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION } },
    update: { sentAt: new Date(Date.now() - 31 * D) },
    create: { userId, email, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, sentAt: new Date(Date.now() - 31 * D) },
  });
const outbox = () => (existsSync(".data/outbox") ? readdirSync(".data/outbox").map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8"))) : []);
const tickAndAgree = async (page) => {
  await page.check("[data-testid=agree-checkbox]");
  await page.click("[data-testid=agree-submit]");
  await page.waitForURL((u) => u.pathname !== "/agree", { timeout: 30000 });
};

// ---- A new account: lands on /agree, the API waits, the box starts unticked --------------------------------
const newEmail = `agree-new${stamp}@example.com`;
const fresh = await signIn(newEmail, "/clients", { viewport: { width: 390, height: 844 } });
const newUser = await prisma.user.findUnique({ where: { email: newEmail } });
ok("a new login lands on /agree", path(fresh) === "/agree", fresh.url());
ok("with where it was going kept", new URL(fresh.url()).searchParams.get("next") === "/clients", fresh.url());
ok("heading: Before you continue", norm(await fresh.textContent("[data-testid=agree-heading]")) === "Before you continue");
ok("no list of changes for a new account", (await fresh.locator("[data-testid=agree-changes]").count()) === 0);
const terms = fresh.locator('a[href="/legal/terms"]');
const privacy = fresh.locator('a[href="/legal/privacy"]');
ok("links to the Terms, in a new tab", (await terms.count()) === 1 && (await terms.getAttribute("target")) === "_blank");
ok("links to the Privacy Policy, in a new tab", (await privacy.count()) === 1 && (await privacy.getAttribute("target")) === "_blank");
ok("the box starts unticked", !(await fresh.isChecked("[data-testid=agree-checkbox]")));
ok("the box says what it means", norm(await fresh.textContent("label:has([data-testid=agree-checkbox])")) === "I have read and agree to the Terms of Service and Privacy Policy");
ok("Agree is off until it's ticked", await fresh.isDisabled("[data-testid=agree-submit]"));
ok("a Sign out button", (await fresh.locator("button:text-is('Sign out')").count()) === 1);
ok("a brand-new account isn't offered its data or cancelling (it has none yet)", (await fresh.locator("[data-testid=agree-account], [data-testid=agree-billing]").count()) === 0);
ok("the logo's frame shows on the light page", (await fresh.locator("main a[aria-label=SureFrame] svg").count()) === 1);
ok("fits a phone", await noSideways(fresh));
await fresh.screenshot({ path: `${shots}/agree-new-phone.png`, fullPage: true });

let r = await api(fresh, "GET", "/api/clients");
ok("the API answers 403 TERMS_REQUIRED before agreeing", r.status === 403 && r.body?.code === "TERMS_REQUIRED", JSON.stringify(r));
ok("with a message saying what to do", /agree to the SureFrame Terms of Service and Privacy Policy/.test(r.body?.error ?? ""), r.body?.error);
r = await api(fresh, "GET", "/api/items");
ok("to-dos too (member or client routes)", r.status === 403 && r.body?.code === "TERMS_REQUIRED", JSON.stringify(r));
r = await api(fresh, "POST", "/api/team/join", { token: "t".repeat(30) });
ok("joining a team waits for agreeing too", r.status === 403 && r.body?.code === "TERMS_REQUIRED", JSON.stringify(r));
await visit(fresh, "/library", "/agree");
ok("every account page goes to /agree", path(fresh) === "/agree" && new URL(fresh.url()).searchParams.get("next") === "/library");
await fresh.goto(BASE + "/agree?next=/clients");

// The server checks the box itself: a form sent without it records nothing.
await fresh.evaluate(() => {
  const b = document.querySelector("[data-testid=agree-submit]");
  document.querySelector("[data-testid=agree-checkbox]").required = false;
  b.disabled = false;
  b.click();
});
await fresh.waitForURL((u) => u.searchParams.get("error") === "tick", { timeout: 30000 }).catch(() => {});
await fresh.waitForSelector("text=Tick the box to agree.", { timeout: 10000 }).catch(() => {});
ok("sent without the tick: refused and asked to tick", new URL(fresh.url()).searchParams.get("error") === "tick" && (await fresh.isVisible("text=Tick the box to agree.")), fresh.url());
ok("and nothing recorded", (await rows(newUser.id)).length === 0);

await fresh.check("[data-testid=agree-checkbox]");
ok("ticking turns Agree on", await fresh.isEnabled("[data-testid=agree-submit]"));
// Fix-first 11 (O3, O4, O11, S4): Agree goes straight to the welcome step, not via a page that then redirects.
const afterAgree = [];
const onNav = (f) => f === fresh.mainFrame() && afterAgree.push(new URL(f.url()).pathname);
fresh.on("framenavigated", onNav);
await fresh.click("[data-testid=agree-submit]");
await fresh.waitForURL((u) => u.pathname !== "/agree", { timeout: 30000 });
// The page streams in, so the redirect to the welcome step can land just after.
await fresh.waitForURL((u) => u.pathname === "/welcome", { timeout: 15000 }).catch(() => {});
// A new owner then gives the business name, in one step (app/welcome), and carries on.
ok("a new owner is asked for the business name next", path(fresh) === "/welcome" && new URL(fresh.url()).searchParams.get("next") === "/clients", fresh.url());
fresh.off("framenavigated", onNav);
ok("Agree goes straight to the welcome step, no stop on the way", afterAgree.filter((p) => p !== "/agree")[0] === "/welcome", afterAgree.join(" > "));
ok("the welcome step shows, not a blank spinner", !!(await fresh.waitForSelector("[data-testid=welcome-business]", { timeout: 10000 }).catch(() => null)));
// Before the business has a name, Settings > Account and Billing wait for it too (no "<email>'s workspace").
for (const p of ["/settings/account", "/settings/billing"]) {
  await visit(fresh, p, "/welcome");
  ok(`${p} asks for the business name first`, path(fresh) === "/welcome" && new URL(fresh.url()).searchParams.get("next") === p, fresh.url());
}
await visit(fresh, "/welcome?next=/clients");
await fresh.fill("[data-testid=welcome-business]", "Business A");
await fresh.click("[data-testid=welcome-submit]");
await fresh.waitForURL((u) => u.pathname !== "/welcome", { timeout: 30000 });
ok("agreeing carries on to where it was going", path(fresh) === "/clients", fresh.url());
let rec = await rows(newUser.id);
ok("one agreement recorded", rec.length === 1, JSON.stringify(rec));
ok("for the current versions", rec[0]?.termsVersion === TERMS_VERSION && rec[0]?.privacyVersion === PRIVACY_VERSION && TERMS_VERSION === "2026-10-11");
ok("as a sign-up, with the email at the time", rec[0]?.method === "signup" && rec[0]?.email === newEmail);
ok("with the IP address and browser", !!rec[0]?.ip && /Chrome/.test(rec[0]?.userAgent ?? ""), `${rec[0]?.ip} ${rec[0]?.userAgent}`);
ok("and when", !!rec[0]?.acceptedAt && Date.now() - rec[0].acceptedAt.getTime() < 120_000);
r = await api(fresh, "GET", "/api/clients");
ok("the API works after agreeing", r.status === 200, JSON.stringify(r));
await visit(fresh, "/library");
ok("pages work after agreeing", path(fresh) === "/library");
await visit(fresh, "/agree?next=/clients", "/clients");
ok("/agree just carries on once agreed", path(fresh) === "/clients");
await visit(fresh, "/agree?next=" + encodeURIComponent("https://evil.example/x"), "/library");
ok("an outside next goes to the library instead", path(fresh) === "/library" && new URL(fresh.url()).host === new URL(BASE).host, fresh.url());
ok("agreeing twice records nothing more", (await rows(newUser.id)).length === 1);

// ---- A version change: an existing account holder is asked again, as an update -----------------------------
await prisma.termsAcceptance.create({ data: { userId: newUser.id, email: newEmail, termsVersion: "2026-01-01", privacyVersion: "2026-01-01", method: "signup" } });
await noticeOver(newUser.id, newEmail);
await visit(fresh, "/clients", "/agree");
ok("a newer agreement to older versions: sent back to /agree", path(fresh) === "/agree", fresh.url());
ok("heading: We've updated our Terms of Service and Privacy Policy", norm(await fresh.textContent("[data-testid=agree-heading]")) === "We’ve updated our Terms of Service and Privacy Policy");
const changes = await fresh.locator("[data-testid=agree-changes] li").count();
ok("with a short summary of the changes", changes >= 3 && changes <= 4, String(changes));
ok("an existing account can manage or cancel its subscription instead", (await fresh.getAttribute("[data-testid=agree-billing]", "href")) === "/settings/billing");
ok("or download its data or delete the account", (await fresh.getAttribute("[data-testid=agree-account]", "href")) === "/settings/account");
await fresh.screenshot({ path: `${shots}/agree-updated-phone.png`, fullPage: true });
await tickAndAgree(fresh);
rec = await rows(newUser.id);
ok("agreeing again is recorded as an update", rec.length === 3 && rec.at(-1).method === "update" && rec.at(-1).termsVersion === TERMS_VERSION, JSON.stringify(rec.map((x) => x.method)));
ok("and carries on", path(fresh) === "/clients");

// An account from before agreements were recorded, with no record at all: also an update.
const oldEmail = `agree-old${stamp}@example.com`;
const oldUser = await prisma.user.create({ data: { onboardedAt: new Date("2026-01-15T00:00:00Z"), email: oldEmail, name: "Old Timer", createdAt: new Date("2026-01-15T00:00:00Z") } });
// Notice first (Terms section 18): until it has been emailed, and for 30 days after, it carries on as before.
const old = await signIn(oldEmail, "/library", { lands: "/library" });
ok("notice period: an existing account isn't sent to /agree before it's been told", path(old) === "/library", old.url());
ok("notice period: the API works meanwhile", (await api(old, "GET", "/api/clients")).status === 200);
ok("notice period: a banner asks them to agree", (await old.locator("[data-testid=terms-notice] a[href='/agree']").count()) === 1);
const purgeRun = await cron("purge");
const noticeRow = await prisma.termsNotice.findUnique({ where: { userId_termsVersion_privacyVersion: { userId: oldUser.id, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION } } });
const effective = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date((noticeRow?.sentAt?.getTime() ?? 0) + 30 * D));
const noticeMail = outbox().find((m) => m.to === oldEmail && m.subject === "We're updating our Terms of Service and Privacy Policy");
ok("notice: the daily job emails existing account holders once, and records it", typeof purgeRun.termsNotices === "number" && purgeRun.termsNotices >= 1 && !!noticeRow && !!noticeMail, JSON.stringify(purgeRun));
ok("notice: gives the date they apply (30 days on), the changes and links", !!noticeMail && norm(noticeMail.text).includes(`The new versions apply to you from ${effective}`) && noticeMail.text.includes("25 videos in total") && noticeMail.text.includes("/legal/terms") && noticeMail.text.includes("/legal/privacy") && noticeMail.text.includes("cancel your subscription"), noticeMail?.text);
await cron("purge");
ok("notice: not sent twice", outbox().filter((m) => m.to === oldEmail && m.subject === "We're updating our Terms of Service and Privacy Policy").length === 1);
await visit(old, "/library", "/library");
ok("notice period: the banner gives the date", norm(await old.textContent("[data-testid=terms-notice]").catch(() => "")).includes(`they apply to you from ${effective}`));
// Meanwhile the Free plan counts as it did: deleting a video frees a place. The 25-in-total count carries on underneath.
const oldWs = (await prisma.membership.findFirst({ where: { userId: oldUser.id } })).workspaceId;
const ofp = "o".repeat(32), owrap = "w".repeat(44);
await prisma.workspace.update({ where: { id: oldWs }, data: { keyFingerprint: ofp, videosRecorded: 30 } });
await prisma.video.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ id: `ag${stamp.toString(36)}o${i}`, mimeType: "video/webm", storageKey: `test/${stamp}/old-${i}`, status: "UPLOADED", workspaceId: oldWs, ownerId: oldUser.id })) });
const oldStart = () => api(old, "POST", "/api/videos", { mimeType: "video/webm", teamKeyWrap: owrap, keyFingerprint: ofp });
r = await oldStart();
ok("notice period: the old Free rule (25 videos kept at a time)", r.status === 402 && r.body?.error === "The Free plan allows 25 videos. Delete one or upgrade to record more.", JSON.stringify(r));
await prisma.video.delete({ where: { id: `ag${stamp.toString(36)}o0` } });
r = await oldStart();
ok("notice period: deleting one frees a place, though 30 were recorded", r.status === 201 && !!r.body?.video?.id, JSON.stringify(r));
if (r.body?.video?.id) await prisma.video.delete({ where: { id: r.body.video.id } });
// Once the 30 days are up: the new versions apply, so it's /agree, and the 25-in-total rule.
await noticeOver(oldUser.id, oldEmail);
r = await oldStart();
ok("after the notice period: recording waits for agreeing", r.status === 403 && r.body?.code === "TERMS_REQUIRED", JSON.stringify(r));
await visit(old, "/library", "/agree");
ok("an older account with no record lands on /agree once its notice period is over", path(old) === "/agree");
ok("told the terms were updated", norm(await old.textContent("[data-testid=agree-heading]")) === "We’ve updated our Terms of Service and Privacy Policy");
await tickAndAgree(old);
rec = await rows(oldUser.id);
ok("its first agreement is recorded as an update", rec.length === 1 && rec[0].method === "update", JSON.stringify(rec));
r = await oldStart();
ok("agreed: the 25-in-total rule applies", r.status === 402 && String(r.body?.error).includes("25 videos in total"), JSON.stringify(r));
await prisma.video.deleteMany({ where: { workspaceId: oldWs } });

// ---- An upload already under way finishes; nothing new starts --------------------------------------------
const upEmail = `agree-up${stamp}@example.com`;
const up = await signIn(upEmail, "/library");
await tickAndAgree(up);
const upUser = await prisma.user.findUnique({ where: { email: upEmail } });
const wsUp = (await prisma.membership.findFirst({ where: { userId: upUser.id } })).workspaceId;
const fp = "f".repeat(32), wrap = "w".repeat(44);
await prisma.workspace.update({ where: { id: wsUp }, data: { keyFingerprint: fp } });
const start = () => api(up, "POST", "/api/videos", { mimeType: "video/webm", teamKeyWrap: wrap, keyFingerprint: fp });
const part = (id) => up.request.put(`${BASE}/api/videos/${id}/parts/1`, { data: Buffer.from("x".repeat(1000)), headers: { "content-type": "application/octet-stream" } });
const complete = (id) => up.request.post(`${BASE}/api/videos/${id}/complete`, { data: { partCount: 1, durationMs: 2000 } });
const done = (await start()).body?.video?.id;
await part(done);
await complete(done);
const inFlight = (await start()).body?.video?.id;
const toDiscard = (await start()).body?.video?.id;
ok("recordings started while agreed", !!done && !!inFlight && !!toDiscard);
// The terms change mid-recording (the latest agreement is now to older versions).
await prisma.termsAcceptance.create({ data: { userId: upUser.id, email: upEmail, termsVersion: "2026-01-01", privacyVersion: "2026-01-01", method: "signup" } });
await noticeOver(upUser.id, upEmail);
r = await start();
ok("a new recording can't start before agreeing", r.status === 403 && r.body?.code === "TERMS_REQUIRED", JSON.stringify(r));
const p1 = await part(inFlight);
ok("but the one under way keeps uploading", p1.status() === 200, String(p1.status()));
const c1 = await complete(inFlight);
ok("and finishes", c1.status() === 200 && (await prisma.video.findUnique({ where: { id: inFlight } })).status === "UPLOADED", String(c1.status()));
ok("discarding one still uploading works", (await up.request.delete(`${BASE}/api/videos/${toDiscard}`)).status() === 204);
r = await api(up, "DELETE", `/api/videos/${done}`);
ok("deleting a finished video waits for agreeing", r.status === 403 && r.body?.code === "TERMS_REQUIRED" && !!(await prisma.video.findUnique({ where: { id: done } })), JSON.stringify(r));
r = await api(up, "GET", `/api/videos/${inFlight}`);
ok("opening the team's own video waits too (not a 404)", r.status === 403 && r.body?.code === "TERMS_REQUIRED", JSON.stringify(r));
await visit(up, `/v/${inFlight}`, "/agree");
ok("the video page sends them to agree, then back", path(up) === "/agree" && new URL(up.url()).searchParams.get("next") === `/v/${inFlight}`, up.url());
await visit(up, "/settings/branding/preview");
ok("the branding preview says to agree first", await up.isVisible("text=Agree to the updated terms to see the preview."));

// ---- Still possible before agreeing: data download, deleting the account ----------------------------------
r = await api(up, "GET", "/api/account/export");
ok("data download works", r.status === 200 && Array.isArray(r.body?.termsAgreements), JSON.stringify(r).slice(0, 200));
ok("and includes the agreement records", r.body?.termsAgreements?.length === 2 && r.body.termsAgreements[0].termsVersion === TERMS_VERSION && !!r.body.termsAgreements[0].acceptedAt, JSON.stringify(r.body?.termsAgreements));
const otherRecord = await api(fresh, "GET", "/api/account/export");
ok("someone else's records aren't in it", otherRecord.body?.termsAgreements?.length === 3 && otherRecord.body.termsAgreements.every((x) => x.email === newEmail));
await visit(up, "/settings/account");
ok("Settings > Account opens before agreeing", path(up) === "/settings/account");
ok("with only the data download and account deletion", (await up.isVisible("text=Download your data")) && (await up.isVisible("text=Delete account")) && !(await up.isVisible("text=Your name")) && !(await up.isVisible("text=Recovery key")));
ok("and a way back to /agree", (await up.locator('a[href="/agree"]').count()) === 1);
ok("no subscription section without a Stripe customer", (await up.locator("[data-testid=account-subscription]").count()) === 0);
// An owner with a subscription can still manage or cancel it without agreeing, so declining never leaves a plan renewing.
await prisma.workspace.update({ where: { id: wsUp }, data: { stripeCustomerId: `cus_agree${stamp}` } });
await visit(up, "/settings/account");
ok("Settings > Account offers Manage subscription before agreeing", (await up.locator("[data-testid=account-subscription] button:text-is('Manage subscription')").count()) === 1);
r = await api(up, "POST", "/api/billing/portal");
ok("the billing portal opens before agreeing", r.status === 200 && !!r.body?.url, JSON.stringify(r));
ok("and comes back to Settings > Account (not a page that bounces to /agree)", /\/settings\/account$/.test(stripeState.portalSessions.at(-1)?.return_url ?? ""), stripeState.portalSessions.at(-1)?.return_url);
await prisma.workspace.update({ where: { id: wsUp }, data: { stripeCustomerId: null } });
const recBefore = await rows(upUser.id);
await up.fill('input[name="confirm"]', upEmail);
await up.click("text=Delete my account");
await up.click("[data-testid=delete-account-yes]");
await up.waitForURL((u) => u.pathname === "/login", { timeout: 60000 });
ok("deleting the account works before agreeing", !!(await prisma.user.findUnique({ where: { email: upEmail } }))?.deleteAt);
await prisma.user.update({ where: { id: upUser.id }, data: { deleteAt: new Date(Date.now() - 60_000) } });
await cron("purge");
ok("the account is deleted for good", !(await prisma.user.findUnique({ where: { id: upUser.id } })));
ok("its agreement records are kept", (await rows(upUser.id)).length === recBefore.length && recBefore.length === 2);

// ---- Keeping a closed account works before agreeing, then the terms come first ---------------------------
const keepEmail = `agree-keep${stamp}@example.com`;
const keepUser = await prisma.user.create({ data: { onboardedAt: new Date("2026-01-15T00:00:00Z"), email: keepEmail, name: "Keeper", deletionRequestedAt: new Date(Date.now() - 60_000), deleteAt: new Date(Date.now() + 20 * D) } });
const keep = await signIn(keepEmail, "/library", { lands: "/account/restore" });
ok("a closed account signing in is offered to keep it (not /agree)", path(keep) === "/account/restore", keep.url());
await keep.click("button:text-is('Keep my account')");
await keep.waitForURL((u) => u.pathname === "/agree", { timeout: 60000 });
ok("kept, then asked to agree", path(keep) === "/agree" && !(await prisma.user.findUnique({ where: { id: keepUser.id } })).deleteAt);
ok("the way back keeps the 'account open again' note", new URL(keep.url()).searchParams.get("next") === "/library?restored=1", keep.url());
await tickAndAgree(keep);
ok("and on to the library", path(keep) === "/library");
ok("which says the account is open again", new URL(keep.url()).searchParams.get("restored") === "1" && (await keep.waitForSelector("[data-testid=account-restored]", { timeout: 15000 }).then(() => true).catch(() => false)), keep.url());

// ---- Suspended and paused still go where they did ----------------------------------------------------------
const suspEmail = `agree-susp${stamp}@example.com`;
const suspUser = await prisma.user.create({ data: { onboardedAt: new Date("2026-01-15T00:00:00Z"), email: suspEmail, name: "Sus", suspendedAt: new Date() } });
const susp = await signIn(suspEmail, "/library", { lands: "/suspended" });
ok("a suspended login goes to /suspended, not /agree", path(susp) === "/suspended", susp.url());
await visit(susp, "/agree", "/suspended");
ok("and /agree sends it there too", path(susp) === "/suspended");
r = await api(susp, "GET", "/api/clients");
ok("its API answer is still ACCOUNT_SUSPENDED", r.status === 403 && r.body?.code === "ACCOUNT_SUSPENDED", JSON.stringify(r));
ok("nothing recorded for it", (await rows(suspUser.id)).length === 0);

// The owner of a workspace support suspended, who hasn't agreed yet: /suspended's Manage subscription still works.
const suspOwnerEmail = `agree-suspowner${stamp}@example.com`;
const suspOwner = await prisma.user.create({ data: { onboardedAt: new Date("2026-01-15T00:00:00Z"), email: suspOwnerEmail, name: "Sue Owner" } });
await prisma.workspace.create({ data: { name: `Agree susp ${stamp}`, suspendedAt: new Date(), stripeCustomerId: `cus_agreesusp${stamp}`, members: { create: { userId: suspOwner.id, role: "OWNER" } } } });
const suspOwnerPage = await signIn(suspOwnerEmail, "/library", { lands: "/suspended" });
ok("a suspended workspace's owner who hasn't agreed lands on /suspended", path(suspOwnerPage) === "/suspended", suspOwnerPage.url());
ok("with Manage subscription offered", (await suspOwnerPage.locator("text=You can still manage or cancel your subscription.").count()) === 1);
r = await api(suspOwnerPage, "POST", "/api/billing/portal");
ok("and the billing portal opens (not TERMS_REQUIRED)", r.status === 200 && !!r.body?.url, JSON.stringify(r));
ok("coming back to /suspended", /\/suspended$/.test(stripeState.portalSessions.at(-1)?.return_url ?? ""), stripeState.portalSessions.at(-1)?.return_url);

const ownerWs = (await prisma.membership.findFirst({ where: { userId: newUser.id } })).workspaceId;
const pausedEmail = `agree-paused${stamp}@example.com`;
const pausedUser = await prisma.user.create({ data: { onboardedAt: new Date("2026-01-15T00:00:00Z"), email: pausedEmail, name: "Paula", activeWorkspaceId: ownerWs } });
await prisma.membership.create({ data: { userId: pausedUser.id, workspaceId: ownerWs, role: "MEMBER", pausedAt: new Date() } });
const paused = await signIn(pausedEmail, "/library", { lands: "/paused" });
ok("paused staff go to /paused, not /agree", path(paused) === "/paused", paused.url());

// ---- Support's console works for the support admin before agreeing -----------------------------------------
const adminUser = await prisma.user.upsert({ where: { email: ADMIN }, update: {}, create: { email: ADMIN, name: "owner", onboardedAt: new Date() } });
await prisma.termsAcceptance.deleteMany({ where: { userId: adminUser.id } });
await noticeOver(adminUser.id, ADMIN);
const admin = await signIn(ADMIN, "/support/lookup", { lands: "/support/lookup" });
ok("the support admin reaches the console without agreeing", path(admin) === "/support/lookup", admin.url());
for (const p of ["/support", "/support/log", `/support/workspaces/${ownerWs}`, `/support/users/${newUser.id}`, "/support/accounts"]) {
  await visit(admin, p);
  ok(`support page ${p.replace(/[a-z0-9]{20,}/, ":id")} opens`, path(admin) === p, admin.url());
}
await visit(admin, `/support/workspaces/${ownerWs}`);
const warnBox = admin.locator('[data-testid="power-warn"]');
await warnBox.locator("summary").click();
await warnBox.locator('select[name="category"]').selectOption("terms");
await warnBox.locator('textarea[name="reason"]').fill("Agree gate test: a support action before agreeing");
const before = await prisma.adminAction.count({ where: { workspaceId: ownerWs, action: "account.warn" } });
await Promise.all([
  admin.waitForResponse((x) => x.request().method() === "POST" && !!x.request().headers()["next-action"], { timeout: 120000 }),
  warnBox.locator("button").click(),
]);
await admin.waitForSelector("[data-testid=done]", { timeout: 60000 }).catch(() => {});
ok("and its actions run", (await prisma.adminAction.count({ where: { workspaceId: ownerWs, action: "account.warn" } })) === before + 1);
r = await api(admin, "POST", "/api/support/admin", { action: "warn", workspaceId: ownerWs, reason: "Agree gate test via the API", category: "terms" });
ok("as does the support API", r.status === 200, JSON.stringify(r));
await visit(admin, "/library", "/agree");
ok("but the admin's own app still asks them to agree", path(admin) === "/agree");
await tickAndAgree(admin);

// ---- Kept 7 years, then deleted by the daily job ----------------------------------------------------------
const ghost = `ghost-${stamp}`;
await prisma.termsAcceptance.createMany({
  data: [
    { userId: ghost, email: "ghost@example.com", termsVersion: "2018-01-01", privacyVersion: "2018-01-01", method: "signup", acceptedAt: new Date(Date.now() - (7 * 365 + 10) * D) },
    { userId: ghost, email: "ghost@example.com", termsVersion: "2020-01-01", privacyVersion: "2020-01-01", method: "update", acceptedAt: new Date(Date.now() - 6 * 365 * D) },
  ],
});
// An account still open whose only agreement is older than 7 years (the terms haven't changed since), and a deleted one's.
const oldTimer = await prisma.user.create({ data: { email: `oldtimer-${stamp}@example.com`, onboardedAt: new Date("2026-01-15T00:00:00Z") } });
const gone = `gone-${stamp}`;
await prisma.termsAcceptance.createMany({
  data: [
    { userId: oldTimer.id, email: oldTimer.email, termsVersion: "2018-01-01", privacyVersion: "2018-01-01", method: "signup", acceptedAt: new Date(Date.now() - (7 * 365 + 10) * D) },
    { userId: gone, email: "gone@example.com", termsVersion: "2018-01-01", privacyVersion: "2018-01-01", method: "signup", acceptedAt: new Date(Date.now() - (7 * 365 + 10) * D) },
  ],
});
const purge = await cron("purge");
const left = await rows(ghost);
ok("records older than 7 years are deleted by the daily job", left.length === 1 && left[0].termsVersion === "2020-01-01", JSON.stringify(left));
ok("an open account's latest agreement is kept, however old", (await rows(oldTimer.id)).length === 1);
ok("a deleted account's only agreement goes after 7 years", (await rows(gone)).length === 0);
await prisma.termsAcceptance.deleteMany({ where: { userId: oldTimer.id } });
await prisma.user.delete({ where: { id: oldTimer.id } });
ok("the job reports it", typeof purge.agreementsPruned === "number" && purge.agreementsPruned >= 1, JSON.stringify(purge));

// ---- Legal pages: versions, the archive, and phones ---------------------------------------------------------
const reader = await (await browser.newContext({ viewport: { width: 320, height: 700 } })).newPage();
for (const [p, label] of [["/legal/terms", "Terms"], ["/legal/privacy", "Privacy Policy"]]) {
  await reader.goto(BASE + p);
  ok(`${label} shows its version`, (await reader.textContent("main")).includes(`Version ${label === "Terms" ? TERMS_VERSION : PRIVACY_VERSION}`));
  ok(`${label} links to the archive`, (await reader.locator('main a[href="/legal/archive"]').count()) >= 1);
  ok(`${label} fits 320px without sideways scrolling`, await noSideways(reader));
}
await reader.goto(BASE + "/legal/dpa");
ok("the DPA fits 320px without sideways scrolling", await noSideways(reader));
await reader.goto(BASE + "/legal/archive");
const archive = norm(await reader.textContent("main"));
ok("the archive lists the current version and its date", archive.includes(TERMS_VERSION) && archive.includes("11 October 2026"), archive.slice(0, 300));
ok("and says earlier versions are kept and available on request", /earlier versions/i.test(archive) && /on request|ask us/i.test(archive), archive);
ok("the archive fits 320px", await noSideways(reader));
await reader.screenshot({ path: `${shots}/legal-archive-320.png`, fullPage: true });
const agree320 = await signIn(`agree-320${stamp}@example.com`, "/library", { viewport: { width: 320, height: 640 } });
ok("/agree fits 320px", path(agree320) === "/agree" && (await noSideways(agree320)));
await agree320.screenshot({ path: `${shots}/agree-320.png`, fullPage: true });

await browser.close();
stripeServer.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
