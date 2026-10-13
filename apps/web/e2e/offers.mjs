// Founding prices and discount offers against a fake Stripe (e2e/fake-stripe.mjs): founding checkouts keep founding
// prices through plan, seat and interval changes and lose them when the subscription ends; the console's Offers page
// makes, automates and ends codes; share links, the automatic offer and codes typed on Settings > Billing reach Stripe.
// Start the app as for billing.mjs, plus FOUNDING_ENDS=2099-12-31 and SUPPORT_EMAIL=owner@test.dev:
//   STRIPE_SECRET_KEY=sk_test_fake STRIPE_API_BASE=http://localhost:12111 STRIPE_WEBHOOK_SECRET=whsec_test
import { chromium } from "@playwright/test";
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
// Offers left by earlier runs would apply to this one's checkouts.
for (const p of state.promos) Object.assign(p, { active: false, metadata: { ...p.metadata, sureframe_auto: "no" } });
const sig = new Stripe("sk_test_fake");
const fake = new Stripe("sk_test_fake", { host: "localhost", port: 12111, protocol: "http" });
const stamp = Date.now();

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
const lastSession = () => state.sessions.at(-1).params;
const priceOf = (id) => state.prices.find((p) => p.id === id);
const keys = (sub) => sub.items.data.map((i) => i.price.lookup_key).sort().join(",");
const text = async (page, path) => {
  await page.goto(BASE + path);
  return (await page.textContent("main")).replace(/\s+/g, " ");
};
const workspaceOf = async (email) => (await prisma.membership.findFirst({ where: { user: { email }, role: "OWNER" }, include: { workspace: true } })).workspace;
const fits = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

// 1) Founding prices: offered on the pricing page, taken at checkout, kept through changes, lost when the subscription ends.
const foundEmail = `found${stamp}@example.com`;
const founder = await signIn(foundEmail);
let t = await text(founder, "/pricing");
ok("pricing page shows the founding offer and its last day", /Founding prices: start a subscription by 31 December 2099/.test(t), t.slice(0, 300));
let res = await api(founder, "/api/billing/checkout", { plan: "SOLO" });
let session = lastSession();
let price = priceOf(session.line_items[0].price);
ok("checkout uses the founding Solo price", res.ok() && price?.lookup_key === "sureframe_founding_solo_monthly" && price.unit_amount === 1500);
ok("founding price belongs to the Solo product", state.products.find((p) => p.id === price.product)?.name === "SureFrame Solo");
ok("the subscription is marked founding", session.subscription_data.metadata.foundingPrices === "yes");
ok("with no offer running, checkout takes a typed code", session.allow_promotion_codes === "true" && !session.discounts);
const foundWs = await workspaceOf(foundEmail);
const sub = createSubscription(session.customer, foundWs.id, "sureframe_founding_solo_monthly", "active", { metadata: { foundingPrices: "yes" } });
await webhook(founder, "customer.subscription.created", sub);
ok("workspace records founding prices", (await prisma.workspace.findUnique({ where: { id: foundWs.id } })).foundingPrices === true);
t = await text(founder, "/settings/billing");
ok("billing page says founding prices", /Founding prices\. You keep today.s prices/.test(t));

res = await api(founder, "/api/billing/preview", { plan: "AGENCY" });
const preview = await res.json();
ok("switch preview prices Agency at its founding price", res.ok() && preview.mode === "change" && preview.plan === 9900, JSON.stringify(preview));
res = await api(founder, "/api/billing/checkout", { plan: "AGENCY" });
ok("upgrade keeps founding prices on Agency", res.ok() && keys(sub) === "sureframe_founding_agency_monthly", keys(sub));
res = await api(founder, "/api/billing/seats", { extraSeats: 2 });
ok("extra clients use the founding price", res.ok() && sub.items.data.find((i) => i.price.lookup_key === "sureframe_founding_client_seat_monthly")?.quantity === 2, keys(sub));
res = await api(founder, "/api/billing/staff", { extraStaff: 1 });
ok("extra staff use the founding price", res.ok() && sub.items.data.some((i) => i.price.lookup_key === "sureframe_founding_staff_seat_monthly"), keys(sub));
res = await api(founder, "/api/billing/backup", { enabled: true });
ok("add-ons stay at the normal price", res.ok() && sub.items.data.some((i) => i.price.lookup_key === "sureframe_cloud_backup_monthly"), keys(sub));
res = await api(founder, "/api/billing/checkout", { plan: "AGENCY", interval: "year" });
ok(
  "yearly switch keeps founding prices for plan and seats",
  res.ok() && keys(sub) === "sureframe_cloud_backup_yearly,sureframe_founding_agency_yearly,sureframe_founding_client_seat_yearly,sureframe_founding_staff_seat_yearly",
  keys(sub),
);
sub.status = "canceled";
await webhook(founder, "customer.subscription.deleted", sub);
const ended = await prisma.workspace.findUnique({ where: { id: foundWs.id } });
ok("founding prices end with the subscription", ended.foundingPrices === false && ended.plan === "FREE");

// 2) The console's Offers page: make a code limited to the plans.
const ADMIN = "owner@test.dev";
const admin = await signIn(ADMIN, "/support/offers", { phone: true });
async function power(testId, fields = {}) {
  const box = admin.locator(`[data-testid="${testId}"]`);
  await box.locator("summary").click();
  for (const [name, value] of Object.entries(fields)) {
    const input = box.locator(`[name="${name}"]`);
    if ((await input.getAttribute("type")) === "checkbox") await input.setChecked(!!value);
    else if ((await input.evaluate((e) => e.tagName)) === "SELECT") await input.selectOption(String(value));
    else await input.fill(String(value));
  }
  await box.locator("textarea[name=reason]").fill("e2e offers test");
  const before = admin.url();
  await box.locator("button").last().click();
  // Success reloads the page with ?done=…; a refusal shows in this form (Next's route announcer is a role=alert too, so only look in the form).
  await admin
    .waitForFunction(([b, id]) => location.href !== b || !!document.querySelector(`[data-testid="${id}"] p[role="alert"]`), [before, testId], { timeout: 20000 })
    .catch(() => {});
  await admin.waitForLoadState("networkidle").catch(() => {});
  return admin.url() !== before ? "" : (await box.locator('p[role="alert"]').allTextContents()).join(" ") || "no result";
}
ok("offers page fits a phone", await fits(admin));
const CODE = `SPRING-${String(stamp).slice(-6)}`;
let err = await power("create-offer", { code: CODE.toLowerCase(), percentOff: 20, scope: "plan", duration: "repeating", months: 3, maxUses: 50 });
const promo = state.promos.find((p) => p.code === CODE);
const coupon = promo?.promotion.coupon;
const planProducts = ["SureFrame Solo", "SureFrame Studio", "SureFrame Agency"].map((n) => state.products.find((p) => p.name === n)?.id).sort();
ok("offer created in Stripe as an upper-case code", !err && !!promo && promo.active && promo.max_redemptions === 50, err);
ok("coupon: 20% for 3 months", coupon?.percent_off === 20 && coupon.duration === "repeating" && coupon.duration_in_months === 3 && coupon.name === CODE);
ok("coupon comes off the three plans only", JSON.stringify([...(coupon?.applies_to?.products ?? [])].sort()) === JSON.stringify(planProducts));
const created = await prisma.adminAction.findFirst({ where: { action: "offer.create", target: CODE }, orderBy: { createdAt: "desc" } });
ok("support log records the offer", created?.reason === "e2e offers test" && created.details?.summary === "20% off your plan for 3 months");
t = (await admin.textContent("main")).replace(/\s+/g, " ");
ok("console shows it with its share link", t.includes(`Done: Offer created (${CODE})`) && t.includes(`/offer/${CODE}`) && t.includes("Used0 of 50 times"), t.slice(0, 400));
err = await power("create-offer", { code: CODE, percentOff: 10, scope: "all", duration: "once" });
ok("a code already running can't be made twice", /already in use/.test(err), err);

// 3) A share link applies the code at checkout.
const linkEmail = `link${stamp}@example.com`;
const visitor = await signIn(linkEmail);
await visitor.goto(`${BASE}/offer/${CODE.toLowerCase()}`);
ok("share link opens the pricing page", new URL(visitor.url()).pathname === "/pricing");
t = (await visitor.textContent('[data-testid="offer-banner"]').catch(() => "")).replace(/\s+/g, " ");
ok("pricing page shows the code's offer", t.includes(`Code ${CODE}: 20% off your plan for 3 months`), t);
res = await api(visitor, "/api/billing/checkout", { plan: "STUDIO" });
session = lastSession();
ok("checkout applies the linked code", res.ok() && session.discounts?.[0]?.promotion_code === promo.id && !session.allow_promotion_codes);
await visitor.goto(`${BASE}/offer/NOPE-${stamp}`);
ok("an unknown code says it has ended", (await visitor.locator('[data-testid="offer-ended"]').count()) === 1);
res = await api(visitor, "/api/billing/checkout", { plan: "STUDIO" });
session = lastSession();
ok("an unknown code leaves an ordinary checkout", res.ok() && session.allow_promotion_codes === "true" && !session.discounts);

// 4) The automatic offer: every new checkout gets it, no code needed. One at a time.
err = await power(`auto-on-${CODE}`);
ok("offer made automatic", !err && promo.metadata.sureframe_auto === "yes", err);
const freshEmail = `fresh${stamp}@example.com`;
const fresh = await signIn(freshEmail);
t = (await text(fresh, "/pricing"));
ok("pricing page shows the automatic offer", /Offer: 20% off your plan for 3 months\. It comes off at checkout, no code needed\./.test(t), t.slice(0, 400));
res = await api(fresh, "/api/billing/checkout", { plan: "SOLO" });
session = lastSession();
ok("checkout applies the automatic offer", res.ok() && session.discounts?.[0]?.promotion_code === promo.id);
err = await power("create-offer", { code: `OTHER-${String(stamp).slice(-6)}`, percentOff: 10, scope: "all", duration: "once", automatic: true });
ok("only one offer can be automatic", /already applied automatically/.test(err), err);
ok("the refused offer leaves nothing in Stripe", !state.promos.some((p) => p.code === `OTHER-${String(stamp).slice(-6)}`));

// 5) A current subscriber types a code on Settings > Billing.
const linkWs = await workspaceOf(linkEmail);
const linkCustomer = (await prisma.workspace.findUnique({ where: { id: linkWs.id } })).stripeCustomerId;
const sub2 = createSubscription(linkCustomer, linkWs.id, "sureframe_founding_solo_monthly", "active", { metadata: { foundingPrices: "yes" } });
await webhook(visitor, "customer.subscription.created", sub2);
await visitor.goto(BASE + "/settings/billing");
await visitor.click('[data-testid="have-code"]');
await visitor.fill("#discount-code", CODE.toLowerCase());
await visitor.click('[data-testid="code-form"] button');
await visitor.waitForSelector('[data-testid="code-done"]', { timeout: 15000 }).catch(() => {});
t = ((await visitor.textContent('[data-testid="code-done"]').catch(() => "")) ?? "").replace(/\s+/g, " ");
ok("a subscriber's code is applied", t.includes(`${CODE} applied: 20% off your plan for 3 months`) && sub2.discounts?.[0]?.promotion_code?.id === promo.id, t);
const linkAfter = await prisma.workspace.findUnique({ where: { id: linkWs.id } });
const days = (linkAfter.discountEndsAt - Date.now()) / 86400000;
ok("billing records the discount and its end", linkAfter.discountLabel === `${CODE}: 20% off your plan` && days > 88 && days < 91, `${linkAfter.discountLabel} ${days}`);
await visitor.reload();
t = ((await visitor.textContent('[data-testid="discount"]').catch(() => "")) ?? "").replace(/\s+/g, " ");
ok("billing page shows the discount", t.startsWith(`Discount: ${CODE}: 20% off your plan, until `), t);
ok("no code box while a discount runs", (await visitor.locator('[data-testid="have-code"]').count()) === 0);
res = await api(visitor, "/api/billing/code", { code: CODE });
ok("a second code is refused", res.status() === 400 && /already has a discount/.test((await res.json()).error));

// New-customers-only codes aren't for subscribers; a Free owner's typed code is kept for checkout.
const newOnly = await fake.coupons.create({ name: "NEWONLY", percent_off: 50, duration: "once", metadata: { sureframe_scope: "all" } });
const NEWCODE = `NEW-${String(stamp).slice(-6)}`;
await fake.promotionCodes.create({ promotion: { type: "coupon", coupon: newOnly.id }, code: NEWCODE, restrictions: { first_time_transaction: true } });
const sub3Email = `sub3${stamp}@example.com`;
const third = await signIn(sub3Email);
const sub3Ws = await workspaceOf(sub3Email);
await api(third, "/api/billing/checkout", { plan: "SOLO" });
const sub3 = createSubscription(lastSession().customer, sub3Ws.id, "sureframe_solo_monthly");
await webhook(third, "customer.subscription.created", sub3);
res = await api(third, "/api/billing/code", { code: NEWCODE });
ok("a new-customers code is refused for a subscriber", res.status() === 400 && /new subscriptions only/.test((await res.json()).error));
res = await api(fresh, "/api/billing/code", { code: NEWCODE.toLowerCase() });
let body = await res.json();
ok("a Free owner's code is saved for checkout", res.ok() && body.applied === false && body.summary === "50% off your whole bill on your first bill", JSON.stringify(body));
res = await api(fresh, "/api/billing/checkout", { plan: "SOLO" });
session = lastSession();
ok("the saved code beats the automatic offer at checkout", res.ok() && session.discounts?.[0]?.promotion_code === state.promos.find((p) => p.code === NEWCODE).id);

// 6) Ending the offer: nobody new gets it, the subscriber keeps theirs.
err = await power(`end-${CODE}`);
ok("offer ended in Stripe", !err && promo.active === false && promo.metadata.sureframe_auto === "no", err);
t = (await admin.textContent("main")).replace(/\s+/g, " ");
ok("console lists it under Ended", /Ended \(\d+\)/.test(t) && t.includes(`Done: Offer ended (${CODE})`));
await visitor.goto(`${BASE}/offer/${CODE}`);
ok("its share link now says it has ended", (await visitor.locator('[data-testid="offer-ended"]').count()) === 1);
const lateEmail = `late${stamp}@example.com`;
const late = await signIn(lateEmail);
res = await api(late, "/api/billing/checkout", { plan: "SOLO" });
session = lastSession();
ok("new checkouts no longer get it", res.ok() && session.allow_promotion_codes === "true" && !session.discounts);
ok("the subscriber keeps the discount", sub2.discounts?.length === 1);

// 7) The Terms cover both.
t = await text(late, "/legal/terms");
ok("terms explain founding prices", /Founding prices are the exception/.test(t) && /Last updated 13 October 2026|13 October 2026/.test(t));
ok("terms explain discounts", /Discount codes and offers work as described when you use them/.test(t));

await browser.close();
server.close();
await prisma.$disconnect();
