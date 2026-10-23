// Staff who join from an invite get no business of their own (Decision 4, Josiah, 22 October 2026: "if they want their
// own business they need to pay for their own subscription separate to the one they are staffed in"):
// - signing in from an invite, and joining, makes no Free workspace (lib/session.ts mayStartFree), and pages before
//   joining don't make one either; a staff member on a team works there as before;
// - "Start your own business" (Settings, Account, Switch business) leads to /start, which offers paid plans only;
//   the server opens a Checkout with no workspace (api/billing/start-business) and makes the business only once
//   Stripe says it's paid (lib/newBusiness.ts), once however often the event comes;
// - someone removed from their only team lands on /start, told why, with no Free business made;
// - someone who signs up on their own still gets Free.
// Run against a server with the dev login and the fake Stripe (same env as billing.mjs).
import { chromium } from "@playwright/test";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { start, state, createSubscription } from "./fake-stripe.mjs";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
const server = await start();
const sig = new Stripe("sk_test_fake");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const newPage = async (viewport = { width: 1280, height: 900 }) => (await browser.newContext({ viewport })).newPage();
const stamp = Date.now();
const path = (p) => new URL(p.url()).pathname;
const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const owned = (userId) => prisma.membership.count({ where: { userId, role: "OWNER" } });
async function webhook(page, type, sub) {
  const payload = JSON.stringify({ id: `evt_${Date.now()}`, object: "event", type, data: { object: sub } });
  const header = sig.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
  return page.request.post(BASE + "/api/webhooks/stripe", { headers: { "stripe-signature": header, "content-type": "application/json" }, data: payload });
}

// ---- A Studio owner (Business S) ----
const owner = await newPage();
const ownerEmail = `so-owner${stamp}@example.com`;
await owner.goto(`${BASE}/login?next=/record`);
await agreed(ownerEmail);
await owner.fill('input[name="email"]', ownerEmail);
await owner.click("text=Continue");
await owner.waitForURL((u) => u.pathname === "/record");
await owner.click("text=I've saved it").catch(() => {});
const ownerUser = await prisma.user.findUnique({ where: { email: ownerEmail } });
const ws = await prisma.workspace.findFirst({ where: { members: { some: { userId: ownerUser.id } } } });
ok("someone who signs up on their own still gets a Free business", !!ws && ws.plan === "FREE" && (await owned(ownerUser.id)) === 1);
await prisma.workspace.update({ where: { id: ws.id }, data: { plan: "STUDIO", name: "Business S" } });

async function invite(email) {
  await owner.goto(BASE + "/settings/team");
  await owner.fill('input[aria-label="Staff email"]', email);
  await owner.click("text=Create invite link");
  return (await owner.waitForSelector("[data-testid=invite-link]")).textContent();
}

// ---- Staff member 1 signs in from the invite: no Free business on the way ----
const staffEmail = `so-staff${stamp}@example.com`;
const staff = await newPage({ width: 320, height: 700 });
await staff.goto(await invite(staffEmail));
await staff.click("text=Sign in to join");
await staff.fill('input[name="email"]', staffEmail);
await staff.click("text=Continue");
await staff.waitForURL((u) => u.pathname.startsWith("/join/"));
const joinPath = path(staff);
const staffUser = await prisma.user.findUnique({ where: { email: staffEmail } });
ok("signed in from an invite: no workspace made", (await prisma.membership.count({ where: { userId: staffUser.id } })) === 0);
for (const p of ["/library", "/settings/billing", "/pricing", "/help"]) await staff.goto(BASE + p);
ok("looking around before joining makes none either", (await prisma.membership.count({ where: { userId: staffUser.id } })) === 0);
await staff.goto(BASE + "/library");
await staff.waitForURL((u) => u.pathname === "/agree" || u.pathname === "/start", { timeout: 15000 }).catch(() => {});
ok("before joining, an app page goes to the terms and then Start, not to a Free business", ["/agree", "/start"].includes(path(staff)) && new URL(staff.url()).searchParams.get("next") !== "/library", staff.url());
// Agreeing on the way (not on the invite page): /start leads back to the invite.
await staff.goto(`${BASE}/agree?next=/start`);
await staff.check("[data-testid=agree-checkbox]");
await staff.click("[data-testid=agree-submit]");
await staff.waitForURL((u) => u.pathname === "/start", { timeout: 15000 });
ok("Start: leads back to the invite not yet used", (await staff.textContent("[data-testid=start-joining]")).includes("Joining Business S?") && (await staff.getAttribute("[data-testid=start-joining] a", "href")) === joinPath);
ok("Start: offers paid plans only", (await staff.locator("[data-testid^=start-plan-]").count()) === 3 && (await staff.locator("[data-testid=start-plan-FREE]").count()) === 0 && (await staff.textContent("[data-testid=start-lead]")).includes("don't come with a Free plan"));
ok("Start fits 320px", await fits(staff));
await staff.screenshot({ path: `${shots}/staff-own-start-joining-320.png`, fullPage: true });
await staff.click("[data-testid=start-joining] a");
await staff.waitForURL((u) => u.pathname === joinPath);
await staff.fill("[data-testid=join-name]", "Team member 1").catch(() => {});
await staff.click("[data-testid=join-team]");
await staff.waitForURL((u) => u.pathname === "/library", { timeout: 30000 });
ok("joined the team, and still no business of their own", (await prisma.membership.count({ where: { userId: staffUser.id, workspaceId: ws.id } })) === 1 && (await owned(staffUser.id)) === 0);
ok("the joining mark is cleared once joined", !(await staff.context().cookies()).some((c) => c.name === "sf_joining" && c.value));

// ---- On the team: Start your own business, from Settings and Account ----
await staff.goto(BASE + "/settings");
ok("Settings: Start your own business", (await staff.locator("[data-testid=settings-index] a[href='/start']").count()) === 1);
await staff.goto(BASE + "/settings/account");
ok("Account: Your own business, on a paid plan", (await staff.textContent("[data-testid=own-business]")).includes("don't come with a Free plan") && (await staff.getAttribute("[data-testid=own-business-link]", "href")) === "/start");
ok("Account fits 320px", await fits(staff));
await staff.click("[data-testid=own-business-link]");
await staff.waitForURL((u) => u.pathname === "/start");
ok("Start, from the team: separate from Business S, and a way back", (await staff.textContent("[data-testid=start-lead]")).includes("separate from Business S's team") && (await staff.isVisible("text=Back to Business S")));
// The server refuses the team's own checkout and the Free route alike.
ok("staff can't start a plan on the team's checkout", (await staff.request.post(BASE + "/api/billing/checkout", { data: { plan: "SOLO" } })).status() === 403);
ok("the new-business checkout never takes Free", (await staff.request.post(BASE + "/api/billing/start-business", { data: { plan: "FREE" } })).status() === 400);
const before = await prisma.workspace.count();
const res = await staff.request.post(BASE + "/api/billing/start-business", { data: { plan: "SOLO", interval: "month" } });
const { url } = await res.json();
const session = state.sessions.at(-1).params;
ok("Start on Solo opens Stripe Checkout", res.ok() && url?.startsWith("https://checkout.stripe.test") && session.line_items[0].price === state.prices.find((p) => p.lookup_key === "sureframe_solo_monthly")?.id);
ok("…for them, with no workspace made before paying", session.subscription_data.metadata.newBusinessFor === staffUser.id && !session.subscription_data.metadata.workspaceId && (await prisma.workspace.count()) === before && (await owned(staffUser.id)) === 0);

// Stripe says it's paid: the business is made, once.
const sub = createSubscription(session.customer, undefined, "sureframe_solo_monthly", "active", { metadata: { newBusinessFor: staffUser.id } });
ok("payment: webhook accepted", (await webhook(staff, "customer.subscription.created", sub)).ok());
await webhook(staff, "customer.subscription.updated", sub);
const mineNow = await prisma.workspace.findMany({ where: { members: { some: { userId: staffUser.id, role: "OWNER" } } } });
ok("paid: one business of their own, on Solo, with the subscription", mineNow.length === 1 && mineNow[0].plan === "SOLO" && mineNow[0].stripeSubscriptionId === sub.id, JSON.stringify(mineNow.map((w) => [w.plan, w.stripeSubscriptionId])));
ok("paid: the subscription now names its business", state.subs.find((s) => s.id === sub.id)?.metadata?.workspaceId === mineNow[0]?.id);
ok("paid: still on Business S's team", (await prisma.membership.count({ where: { userId: staffUser.id, workspaceId: ws.id } })) === 1);
await staff.goto(BASE + "/start?paid=1");
await staff.waitForURL((u) => u.pathname !== "/start", { timeout: 15000 }).catch(() => {});
ok("paid: Start moves on to their business", path(staff) !== "/start", staff.url());
ok("a second business can't be started", (await staff.request.post(BASE + "/api/billing/start-business", { data: { plan: "SOLO" } })).status() === 409);

// ---- Staff member 2 is removed from their only team: Start, not a Free business ----
const s2Email = `so-staff2${stamp}@example.com`;
await agreed(s2Email, { name: "Team member 2" });
const s2 = await newPage({ width: 320, height: 700 });
await s2.goto(await invite(s2Email));
await s2.click("text=Sign in to join");
await s2.fill('input[name="email"]', s2Email);
await s2.click("text=Continue");
await s2.waitForURL((u) => u.pathname.startsWith("/join/"));
await s2.click("text=Join the team");
await s2.waitForURL((u) => u.pathname === "/library");
const s2User = await prisma.user.findUnique({ where: { email: s2Email } });
await prisma.membership.deleteMany({ where: { userId: s2User.id, workspaceId: ws.id } });
await s2.goto(BASE + "/library");
await s2.waitForURL((u) => u.pathname === "/start", { timeout: 15000 }).catch(() => {});
ok("removed from their only team: Start, told why", path(s2) === "/start" && (await s2.textContent("[data-testid=removed-from-team]")).includes("You're no longer on Business S's team"), s2.url());
ok("removed: no Free business made", (await prisma.membership.count({ where: { userId: s2User.id } })) === 0);
ok("removed: paid plans only, and a way to delete the login", (await s2.locator("[data-testid=start-plan-FREE]").count()) === 0 && (await s2.locator("[data-testid=start-delete]").count()) === 1);
ok("removed: Start fits 320px", await fits(s2));
await s2.screenshot({ path: `${shots}/staff-own-removed-320.png`, fullPage: true });
ok("removed: an app API says why, rather than making a business", (await s2.request.get(BASE + "/api/team")).status() === 403 && (await prisma.membership.count({ where: { userId: s2User.id } })) === 0);
await s2.goto(`${BASE}/login?next=/record`);
await s2.waitForURL((u) => u.pathname === "/start", { timeout: 15000 }).catch(() => {});
ok("removed: the sign-in page doesn't bounce, it goes to Start", path(s2) === "/start");

// ---- Opens a join link, then signs up for themselves in the same browser: still a Free business (Fable, 23 Oct) ----
const s3Email = `so-staff3${stamp}@example.com`;
const ownEmail = `so-own${stamp}@example.com`;
const s3 = await newPage({ width: 320, height: 700 });
await s3.goto(await invite(s3Email));
await s3.waitForFunction(() => document.cookie.includes("sf_joining="), null, { timeout: 15000 }).catch(() => {});
ok("a join link marks this browser as joining", (await s3.context().cookies()).some((c) => c.name === "sf_joining" && c.value));
await s3.goto(BASE + "/signup");
await agreed(ownEmail);
await s3.fill('input[name="email"]', ownEmail);
await s3.click("text=Continue");
await s3.waitForURL((u) => u.pathname !== "/signup" && u.pathname !== "/login", { timeout: 30000 }).catch(() => {});
await s3.waitForLoadState("networkidle").catch(() => {});
const ownUser = await prisma.user.findUnique({ where: { email: ownEmail } });
let ownWs = null;
for (let i = 0; i < 20 && !ownWs; i++) {
  ownWs = ownUser && (await prisma.workspace.findFirst({ where: { members: { some: { userId: ownUser.id, role: "OWNER" } } } }));
  if (!ownWs) await new Promise((r) => setTimeout(r, 500));
}
ok("signing up for themselves clears the joining mark", !(await s3.context().cookies()).some((c) => c.name === "sf_joining" && c.value));
ok("…and they get a Free business, not the paid-only Start page", ownWs?.plan === "FREE" && path(s3) !== "/start", `${s3.url()} user=${!!ownUser} ${ownWs?.plan}`);

await browser.close();
server.close();
await prisma.$disconnect();
