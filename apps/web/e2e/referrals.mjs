// Referrals (lib/referrals.ts) against a fake Stripe (e2e/fake-stripe.mjs): a paying business's code on Settings >
// Billing, a new business taking 10% off with it, the sharer's 10% going on just before their next bill and coming off
// again when the referred business leaves, one referral per business, and the terms.
// Start the app as for offers.mjs, with founding off and CRON_SECRET=test-cron-secret:
//   STRIPE_SECRET_KEY=sk_test_fake STRIPE_API_BASE=http://localhost:12111 STRIPE_WEBHOOK_SECRET=whsec_test
import { chromium } from "@playwright/test";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { start, state, createSubscription } from "./fake-stripe.mjs";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
const server = await start();
// Offers left by earlier runs would apply to this one's checkouts.
for (const p of state.promos) Object.assign(p, { active: false, metadata: { ...p.metadata, sureframe_auto: "no" } });
const sig = new Stripe("sk_test_fake");
const fake = new Stripe("sk_test_fake", { host: "localhost", port: 12111, protocol: "http" });
const stamp = Date.now();
const COUPON = "sureframe_referral_10_forever";

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
async function signIn(email, next = "/settings/billing", { phone = false } = {}) {
  await agreed(email);
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname === next.split("?")[0], { timeout: 60000 });
  return page;
}
const api = (page, path, data) => page.request.post(BASE + path, { data });
async function webhook(page, type, sub) {
  const payload = JSON.stringify({ id: `evt_${Date.now()}`, object: "event", type, data: { object: sub } });
  const header = sig.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
  return page.request.post(BASE + "/api/webhooks/stripe", { headers: { "stripe-signature": header, "content-type": "application/json" }, data: payload });
}
const cron = async (page) => (await page.request.get(BASE + "/api/cron/reminders", { headers: { authorization: `Bearer ${CRON}` } })).json();
const lastSession = () => state.sessions.at(-1).params;
const squash = (s) => (s ?? "").replace(/\s+/g, " ");
const text = async (page, path, sel = "main") => {
  await page.goto(BASE + path);
  return squash(await page.textContent(sel).catch(() => ""));
};
const workspaceOf = async (email) => {
  for (let i = 0; i < 40; i++) {
    const m = await prisma.membership.findFirst({ where: { user: { email }, role: "OWNER" }, include: { workspace: true } });
    if (m) return m.workspace;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no workspace for ${email}`);
};
const ws = (id) => prisma.workspace.findUnique({ where: { id } });
const fits = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

/** Signs a new business up and pays for a plan, optionally with the referral code its checkout carried. */
async function subscribe(email, { lookupKey = "sureframe_solo_monthly", referral = null } = {}) {
  const page = await signIn(email);
  const w = await workspaceOf(email);
  const res = await api(page, "/api/billing/checkout", { plan: "SOLO" });
  if (!res.ok()) throw new Error(`checkout failed for ${email}: ${await res.text()}`);
  const session = lastSession();
  const sub = createSubscription(session.customer, w.id, lookupKey, "active", referral ? { metadata: { referralCode: referral }, coupon: COUPON } : {});
  await webhook(page, "customer.subscription.created", sub);
  return { page, w, sub, session };
}

// 1) A paying business has a code on Settings > Billing; a Free one doesn't.
const freeEmail = `reffree${stamp}@example.com`;
const freePage = await signIn(freeEmail);
ok("a Free business has no referral card", (await freePage.locator('[data-testid="referrals"]').count()) === 0);

const A = await subscribe(`refa${stamp}@example.com`);
let t = await text(A.page, "/settings/billing", '[data-testid="referrals"]');
const codeA = squash(await A.page.textContent('[data-testid="referral-code"]').catch(() => "")).trim();
ok("a paying business gets a referral code", /^REF-[A-Z2-9]{6}$/.test(codeA), codeA);
ok("its share link is shown", squash(await A.page.textContent('[data-testid="referral-link"]')).includes(`/offer/${codeA}`));
ok("it says what the new business gets", t.includes("they get 10% off their plan on every bill for as long as they stay subscribed"), t);
ok("it says the sharer's 10% starts from their next bill and then every bill", /It starts from your next bill, not the one you.ve already paid, and then comes off every bill after that/.test(t), t);
ok("it says the code works once and referred businesses get no code", t.includes("Your code works for one business") && t.includes("a business that joins with a code doesn't get one to share"));
ok("one code per business, the same on every visit", (await prisma.referralCode.count({ where: { workspaceId: A.w.id } })) === 1);
await text(A.page, "/settings/billing");
ok("still the same code on the next visit", squash(await A.page.textContent('[data-testid="referral-code"]')).trim() === codeA);
ok("Copy code and Copy link buttons", (await A.page.locator('[data-testid="referral-copy-code"]').count()) === 1 && (await A.page.locator('[data-testid="referral-copy-link"]').count()) === 1);
const phone = await signIn(`refa${stamp}@example.com`, "/settings/billing", { phone: true });
await phone.waitForSelector('[data-testid="referral-code"]');
ok("the referral card fits a phone screen", await fits(phone));

// 2) A new business opens the share link: the pricing page says what it gets, and checkout takes 10% off.
const bEmail = `refb${stamp}@example.com`;
const bPage = await signIn(bEmail, "/pricing");
await bPage.goto(`${BASE}/offer/${codeA}`);
t = squash(await bPage.textContent('[data-testid="referral-banner"]').catch(() => ""));
ok("pricing shows the referral banner", t.includes(`Referral code ${codeA}: 10% off your plan for as long as you stay subscribed`), t);
ok("and no other offer beside it", (await bPage.locator('[data-testid="offer-banner"]').count()) === 0);
let res = await api(bPage, "/api/billing/checkout", { plan: "SOLO" });
let session = lastSession();
ok("checkout takes the referral coupon", res.ok() && session.discounts?.[0]?.coupon === COUPON && !session.allow_promotion_codes, JSON.stringify(session.discounts));
ok("the subscription carries the code", session.subscription_data.metadata.referralCode === codeA);
const coupon = state.coupons.find((c) => c.id === COUPON);
const planProducts = ["SureFrame Solo", "SureFrame Studio", "SureFrame Agency"].map((n) => state.products.find((p) => p.name === n)?.id).sort();
ok("the coupon is 10% forever on plans only", coupon?.percent_off === 10 && coupon.duration === "forever" && JSON.stringify([...coupon.applies_to.products].sort()) === JSON.stringify(planProducts), JSON.stringify(coupon));

// The code box takes a referral code too; a made-up one is refused.
const cEmail = `refc${stamp}@example.com`;
const cPage = await signIn(cEmail);
res = await api(cPage, "/api/billing/code", { code: "REF-ZZZZZZ" });
ok("a made-up referral code is refused", res.status() === 400 && /isn't valid, or it has already been used/.test((await res.json()).error));
res = await api(cPage, "/api/billing/code", { code: codeA.toLowerCase() });
let body = await res.json();
ok("the code box saves a referral code", res.ok() && body.code === codeA && /10% off your plan/.test(body.summary), JSON.stringify(body));

// 3) B pays: the code is used up and A's 10% booked for just before A's next bill.
const bWs = await workspaceOf(bEmail);
const subB = createSubscription(session.customer, bWs.id, "sureframe_solo_monthly", "active", { metadata: { referralCode: codeA }, coupon: COUPON });
await webhook(bPage, "customer.subscription.created", subB);
let row = await prisma.referralCode.findUnique({ where: { code: codeA } });
const aWs = await ws(A.w.id);
ok("the code is used by B", !!row.usedAt && row.usedByWorkspaceId === bWs.id);
ok("A's reward is due two hours before A's next bill", Math.abs(row.rewardDueAt - (aWs.currentPeriodEnd.getTime() - 2 * 3600_000)) < 5000, `${row.rewardDueAt} vs ${aWs.currentPeriodEnd}`);
t = await text(bPage, "/settings/billing");
ok("B's billing shows its referral discount", squash(await bPage.textContent('[data-testid="discount"]').catch(() => "")).includes("Referral: 10% off your plan"), t.slice(0, 400));
ok("B is told it joined with a referral and has no code to share", (await bPage.locator('[data-testid="referral-joined"]').count()) === 1 && (await bPage.locator('[data-testid="referral-code"]').count()) === 0);
ok("B never gets a code of its own", (await prisma.referralCode.count({ where: { workspaceId: bWs.id } })) === 0);
t = await text(A.page, "/settings/billing", '[data-testid="referral-status"]');
ok("A sees the code was used and when the 10% starts", t.includes(`Your code ${codeA} was used on`) && /starts with your next bill, on \w+ \d{1,2}, \d{4}, and then comes off every bill after that/.test(t), t);

// 4) The code works once: C's saved code no longer applies, and the share link says it has ended.
res = await api(cPage, "/api/billing/checkout", { plan: "SOLO" });
session = lastSession();
ok("a used code isn't applied at checkout", res.ok() && !session.discounts && !session.subscription_data.metadata.referralCode, JSON.stringify(session.discounts));
await cPage.goto(`${BASE}/offer/${codeA}`);
ok("its share link says it has ended", (await cPage.locator('[data-testid="offer-ended"]').count()) === 1);
res = await api(cPage, "/api/billing/code", { code: codeA });
ok("and the code box refuses it", res.status() === 400);

// 5) The cron puts A's 10% on just before A's next bill, keeping a discount A already has.
const keepCoupon = await fake.coupons.create({ percent_off: 20, duration: "repeating", duration_in_months: 3, name: "keep" });
const keepPromo = await fake.promotionCodes.create({ promotion: { type: "coupon", coupon: keepCoupon.id }, code: `KEEP-${stamp}` });
await fake.subscriptions.update(A.sub.id, { discounts: [{ promotion_code: keepPromo.id }] });
await prisma.referralCode.update({ where: { code: codeA }, data: { rewardDueAt: new Date(Date.now() - 60_000) } });
let out = await cron(A.page);
row = await prisma.referralCode.findUnique({ where: { code: codeA } });
ok("not yet: A's next bill is weeks away, so it waits for it", !row.rewardAppliedAt && row.rewardDueAt > new Date(Date.now() + 20 * 86400_000) && A.sub.discounts.length === 1, JSON.stringify(out.referralRewards));
for (const i of A.sub.items.data) i.current_period_end = Math.floor(Date.now() / 1000) + 3600;
await prisma.referralCode.update({ where: { code: codeA }, data: { rewardDueAt: new Date(Date.now() - 60_000) } });
out = await cron(A.page);
row = await prisma.referralCode.findUnique({ where: { code: codeA } });
const codes = A.sub.discounts.map((d) => d.source.coupon.id);
ok("the cron gives A the 10%", out.referralRewards?.applied >= 1 && !!row.rewardAppliedAt && codes.includes(COUPON), JSON.stringify(out.referralRewards));
ok("A's earlier discount is kept beside it", codes.includes(keepCoupon.id) && codes.length === 2, codes.join(","));
ok("without charging anything now", A.sub.lastUpdate?.proration_behavior === "none");
await cron(A.page);
ok("running again adds nothing", A.sub.discounts.length === 2);
await webhook(A.page, "customer.subscription.updated", A.sub);
t = await text(A.page, "/settings/billing");
ok("A's billing shows the referral discount", squash(await A.page.textContent('[data-testid="discount"]').catch(() => "")).includes("Referral: 10% off your plan"), t.slice(0, 500));
ok("and says it's active while B stays", squash(await A.page.textContent('[data-testid="referral-status"]')).includes("Your 10% referral discount is active"));

// 6) The 10% follows a move up: the coupon covers every plan, and the switch leaves discounts alone.
res = await api(A.page, "/api/billing/checkout", { plan: "STUDIO" });
ok("A moves up to Studio", res.ok(), await res.text());
ok("A's referral discount is still on the subscription", A.sub.discounts.some((d) => d.source.coupon.id === COUPON) && A.sub.items.data.some((i) => i.price.lookup_key === "sureframe_studio_monthly"));

// 7) B leaves: A's 10% comes off again, and A's other discount stays.
subB.status = "canceled";
await webhook(bPage, "customer.subscription.deleted", subB);
row = await prisma.referralCode.findUnique({ where: { code: codeA } });
ok("A's referral discount is removed when B leaves", !!row.rewardEndedAt && !A.sub.discounts.some((d) => d.source.coupon.id === COUPON) && A.sub.discounts.some((d) => d.source.coupon.id === keepCoupon.id), JSON.stringify(A.sub.discounts.map((d) => d.source.coupon.id)));
await webhook(A.page, "customer.subscription.updated", A.sub);
ok("A is told why it ended", squash(await (async () => (await text(A.page, "/settings/billing"), A.page.textContent('[data-testid="referral-status"]')))()).includes("ended on"));
ok("A gets no second code", (await prisma.referralCode.count({ where: { workspaceId: A.w.id } })) === 1 && (await A.page.locator('[data-testid="referral-code"]').count()) === 0);

// 8) A referred business that leaves before the sharer's next bill: the sharer's 10% is never given.
const E = await subscribe(`refe${stamp}@example.com`);
await text(E.page, "/settings/billing");
const codeE = squash(await E.page.textContent('[data-testid="referral-code"]')).trim();
const fEmail = `reff${stamp}@example.com`;
const fPage = await signIn(fEmail);
res = await api(fPage, "/api/billing/code", { code: codeE });
ok("F saves E's code", res.ok());
await api(fPage, "/api/billing/checkout", { plan: "SOLO" });
const fWs = await workspaceOf(fEmail);
const subF = createSubscription(lastSession().customer, fWs.id, "sureframe_solo_monthly", "active", { metadata: { referralCode: codeE }, coupon: COUPON });
await webhook(fPage, "customer.subscription.created", subF);
subF.status = "canceled";
await webhook(fPage, "customer.subscription.deleted", subF);
row = await prisma.referralCode.findUnique({ where: { code: codeE } });
ok("E's reward lapses", !!row.rewardLapsedAt && !row.rewardAppliedAt);
await prisma.referralCode.update({ where: { code: codeE }, data: { rewardDueAt: new Date(Date.now() - 60_000) } });
await cron(E.page);
ok("and the cron never gives it", !E.sub.discounts.some((d) => d.source.coupon.id === COUPON));
t = await text(E.page, "/settings/billing", '[data-testid="referral-status"]');
ok("E is told it wasn't given", t.includes("wasn't given"), t);

// 9) A business can't use its own team's code.
const G = await subscribe(`refg${stamp}@example.com`);
await text(G.page, "/settings/billing");
const codeG = squash(await G.page.textContent('[data-testid="referral-code"]')).trim();
const mateEmail = `refmate${stamp}@example.com`;
const matePage = await signIn(mateEmail);
const mateUser = await prisma.user.findUnique({ where: { email: mateEmail } });
await prisma.membership.create({ data: { workspaceId: G.w.id, userId: mateUser.id, role: "MEMBER" } });
await prisma.user.update({ where: { id: mateUser.id }, data: { activeWorkspaceId: (await workspaceOf(mateEmail)).id } });
res = await api(matePage, "/api/billing/code", { code: codeG });
ok("a teammate can't use their team's code for their own business", res.status() === 400 && /your own business/.test((await res.json()).error));

// 10) The console shows referrals, can't make REF- codes, and the Terms explain it all.
const admin = await signIn("owner@test.dev", `/support/workspaces/${A.w.id}`);
t = squash(await admin.textContent('[data-testid="ws-referrals"]').catch(() => ""));
ok("the console shows A's code and its reward", t.includes(`Own code ${codeA}: used`) && t.includes("reward ended"), t);
await admin.goto(`${BASE}/support/workspaces/${bWs.id}`);
ok("and that B joined with it", squash(await admin.textContent('[data-testid="ws-referrals"]').catch(() => "")).includes(`Joined with ${codeA}`));
t = await text(cPage, "/legal/terms");
ok("terms explain referrals", /Referrals: a business on a paid plan can share its referral code/.test(t) && /gets 10% off its own plan from its next bill on, for as long as the business it referred stays subscribed/.test(t));
ok("terms say each business takes part once", t.includes("each business can take part once (a business that joined with a code has no code to share)"));

await browser.close();
server.close();
await prisma.$disconnect();
