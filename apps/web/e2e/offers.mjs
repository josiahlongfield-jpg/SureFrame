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
// The workspace is made as the first page renders, so it can arrive a moment after the page's address.
const workspaceOf = async (email) => {
  for (let i = 0; i < 40; i++) {
    const m = await prisma.membership.findFirst({ where: { user: { email }, role: "OWNER" }, include: { workspace: true } });
    if (m) return m.workspace;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no workspace for ${email}`);
};
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
const left = Number(session.expires_at) - Date.now() / 1000;
ok("a founding checkout expires within a day", left > 22.9 * 3600 && left <= 23 * 3600, String(left));
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

// A checkout opened just before the offer began and paid during it: the webhook gives it founding prices.
const lateStartEmail = `latestart${stamp}@example.com`;
const lateStarter = await signIn(lateStartEmail);
await api(lateStarter, "/api/billing/checkout", { plan: "STUDIO" });
const lateStartWs = await workspaceOf(lateStartEmail);
const subL = createSubscription(lastSession().customer, lateStartWs.id, "sureframe_studio_monthly");
await webhook(lateStarter, "customer.subscription.created", subL);
ok("a subscription started during the offer without founding prices gets them", subL.metadata.foundingPrices === "yes" && keys(subL) === "sureframe_founding_studio_monthly", keys(subL));
ok("with nothing charged for the swap", subL.lastUpdate?.proration_behavior === "none");
ok("and the workspace records them", (await prisma.workspace.findUnique({ where: { id: lateStartWs.id } })).foundingPrices === true);

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
ok("offers for a number of months are capped at 12", (await admin.locator('[data-testid="create-offer"] input[name="months"]').getAttribute("max")) === "12");
err = await power("create-offer", { code: CODE, percentOff: 10, scope: "all", duration: "once" });
ok("a code already running can't be made twice", /already in use/.test(err), err);

// 3) A share link applies the code at checkout.
const linkEmail = `link${stamp}@example.com`;
const visitor = await signIn(linkEmail);
await visitor.goto(`${BASE}/offer/${CODE.toLowerCase()}`);
ok("share link opens the pricing page", new URL(visitor.url()).pathname === "/pricing");
t = (await visitor.textContent('[data-testid="offer-banner"]').catch(() => "")).replace(/\s+/g, " ");
ok("pricing page shows the code's offer", t.includes(`Code ${CODE}: 20% off your plan for 3 months`), t);
ok("and that it comes off when a subscription starts", t.includes("It comes off at checkout when you start a subscription.") && !t.includes("Already subscribed"), t);
const cookie = (await visitor.context().cookies()).find((c) => c.name === "sf_offer");
ok("the share link's cookie is signed", !!cookie && cookie.value.startsWith(`${CODE}.`) && cookie.httpOnly, cookie?.value);
res = await api(visitor, "/api/billing/checkout", { plan: "STUDIO" });
session = lastSession();
ok("checkout applies the linked code", res.ok() && session.discounts?.[0]?.promotion_code === promo.id && !session.allow_promotion_codes);
// A cookie set by hand (not by our link or code box) is ignored: the pricing page and checkout can't be used to try codes.
const forger = await signIn(`forge${stamp}@example.com`);
await forger.context().addCookies([{ name: "sf_offer", value: CODE, url: BASE }]);
t = await text(forger, "/pricing");
ok("a hand-made code cookie is ignored on the pricing page", (await forger.locator('[data-testid="offer-banner"], [data-testid="offer-ended"]').count()) === 0, t.slice(0, 300));
await forger.context().addCookies([{ name: "sf_offer", value: `${CODE}.forged-signature-xx`, url: BASE }]);
res = await api(forger, "/api/billing/checkout", { plan: "STUDIO" });
session = lastSession();
ok("and at checkout", res.ok() && session.allow_promotion_codes === "true" && !session.discounts);
await visitor.goto(`${BASE}/offer/NOPE-${stamp}`);
ok("an unknown code says it has ended", (await visitor.locator('[data-testid="offer-ended"]').count()) === 1);
ok("and isn't remembered", (await visitor.context().cookies()).find((c) => c.name === "sf_offer")?.value.startsWith(`${CODE}.`));
res = await api(visitor, "/api/billing/checkout", { plan: "STUDIO" });
session = lastSession();
ok("so checkout still applies the earlier code", res.ok() && session.discounts?.[0]?.promotion_code === promo.id);
const strangerPage = await (await browser.newContext()).newPage();
await strangerPage.goto(`${BASE}/offer/NOPE-${stamp}`);
ok("an unknown link alone leaves no code", (await strangerPage.context().cookies()).every((c) => c.name !== "sf_offer"));
await strangerPage.goto(`${BASE}/offer/${CODE}`);
await strangerPage.goto(`${BASE}/offer/${CODE}`);
ok("opening the same link twice still works", (await strangerPage.context().cookies()).some((c) => c.name === "sf_offer" && c.value.startsWith(`${CODE}.`)));
await strangerPage.context().close();

// 4) The automatic offer: every new checkout gets it, no code needed. One at a time.
err = await power(`auto-on-${CODE}`);
ok("offer made automatic", !err && promo.metadata.sureframe_auto === "yes", err);
const freshEmail = `fresh${stamp}@example.com`;
const fresh = await signIn(freshEmail);
t = (await text(fresh, "/pricing"));
ok(
  "pricing page shows the automatic offer",
  /Offer: 20% off your plan for 3 months, for new subscriptions\. It comes off at checkout when you start a subscription, no code needed\. Have a different code\? Enter it on Settings > Billing before you choose a plan\./.test(t),
  t.slice(0, 500),
);
res = await api(fresh, "/api/billing/checkout", { plan: "SOLO" });
session = lastSession();
ok("checkout applies the automatic offer", res.ok() && session.discounts?.[0]?.promotion_code === promo.id);
err = await power("create-offer", { code: `OTHER-${String(stamp).slice(-6)}`, percentOff: 10, scope: "all", duration: "once", automatic: true });
ok("only one offer can be automatic", /already applied automatically/.test(err), err);
ok("the refused offer leaves nothing in Stripe", !state.promos.some((p) => p.code === `OTHER-${String(stamp).slice(-6)}`));

// 5) The linked checkout is paid: the subscription starts with the code's discount.
let body;
const linkWs = await workspaceOf(linkEmail);
const linkCustomer = (await prisma.workspace.findUnique({ where: { id: linkWs.id } })).stripeCustomerId;
const sub2 = createSubscription(linkCustomer, linkWs.id, "sureframe_founding_solo_monthly", "active", { metadata: { foundingPrices: "yes" }, promotionCode: promo.id });
await webhook(visitor, "customer.subscription.created", sub2);
const linkAfter = await prisma.workspace.findUnique({ where: { id: linkWs.id } });
const days = (linkAfter.discountEndsAt - Date.now()) / 86400000;
ok("billing records the discount and its end", linkAfter.discountLabel === `${CODE}: 20% off your plan` && days > 88 && days < 91, `${linkAfter.discountLabel} ${days}`);
await visitor.goto(BASE + "/settings/billing");
t = ((await visitor.textContent('[data-testid="discount"]').catch(() => "")) ?? "").replace(/\s+/g, " ");
ok("billing page shows the discount", t.startsWith(`Discount: ${CODE}: 20% off your plan, until `), t);
// Codes are only for starting a subscription: a subscriber has no code box, and the API refuses them.
ok("no code box for a subscriber", (await visitor.locator('[data-testid="have-code"]').count()) === 0);
res = await api(visitor, "/api/billing/code", { code: CODE });
ok("a subscriber's code is refused", res.status() === 400 && /only be used when you start a paid plan/.test((await res.json()).error));

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
await third.goto(BASE + "/settings/billing");
ok("no code box for a subscriber without a discount either", (await third.locator('[data-testid="have-code"]').count()) === 0 && (await third.locator('[data-testid="renews-on"]').count()) === 1);
res = await api(third, "/api/billing/code", { code: NEWCODE });
ok("a new-customers code is refused for a subscriber", res.status() === 400 && /only be used when you start a paid plan/.test((await res.json()).error));
const once = await fake.coupons.create({ name: "ONCE", percent_off: 30, duration: "once", metadata: { sureframe_scope: "all" } });
const ONCECODE = `ONCE-${String(stamp).slice(-6)}`;
await fake.promotionCodes.create({ promotion: { type: "coupon", coupon: once.id }, code: ONCECODE });
res = await api(third, "/api/billing/code", { code: ONCECODE });
ok("a first-bill code is refused for a subscriber", res.status() === 400 && /only be used when you start a paid plan/.test((await res.json()).error) && !sub3.discounts.length);
const yearlyEmail = `yearly${stamp}@example.com`;
const yearly = await signIn(yearlyEmail);
await api(yearly, "/api/billing/checkout", { plan: "SOLO", interval: "year" });
const subY = createSubscription(lastSession().customer, (await workspaceOf(yearlyEmail)).id, "sureframe_founding_solo_yearly", "active", { metadata: { foundingPrices: "yes" } });
await webhook(yearly, "customer.subscription.created", subY);
res = await api(yearly, "/api/billing/code", { code: CODE });
body = await res.json();
ok("a yearly subscriber's code is refused", res.status() === 400 && /only be used when you start a paid plan/.test(body.error) && !subY.discounts.length, body.error);

// Moving up a plan can take a code, typed in the switch box, as long as the bigger plan still costs at least the current one.
// (Billing calls share a limit of 20 per IP per 10 minutes, which this run's earlier checkouts have used up.)
await prisma.rateLimit.deleteMany({ where: { key: { contains: "billing" } } });
const big = await fake.coupons.create({ name: "BIG", percent_off: 75, duration: "forever", metadata: { sureframe_scope: "plan" } });
const BIGCODE = `BIG-${String(stamp).slice(-6)}`;
await fake.promotionCodes.create({ promotion: { type: "coupon", coupon: big.id }, code: BIGCODE });
res = await api(third, "/api/billing/preview", { plan: "STUDIO", code: BIGCODE });
body = await res.json();
ok("upgrade: a code making Studio cheaper than Solo is refused", res.status() === 400 && /would make Studio cost less than your Solo plan/.test(body.error), body.error);
res = await api(third, "/api/billing/preview", { plan: "SOLO", interval: "year", code: CODE });
body = await res.json();
ok("upgrade: no code for a switch that isn't a move up", res.status() === 400 && /only be used when moving up to a bigger plan/.test(body.error), body.error);
res = await api(third, "/api/billing/preview", { plan: "STUDIO", code: NEWCODE });
ok("upgrade: a new-customers code is refused", res.status() === 400 && /never billed before/.test((await res.json()).error));
res = await api(third, "/api/billing/checkout", { plan: "STUDIO", code: BIGCODE });
ok("upgrade: the switch itself refuses it too, and nothing changes", res.status() === 400 && sub3.items.data.some((i) => /solo/.test(i.price.lookup_key)) && !sub3.discounts.length);
await third.goto(BASE + "/pricing");
await third.click("button:has-text('Get Studio')");
await third.waitForSelector("[data-testid=plan-confirm]");
const dueBefore = (await third.textContent("[data-testid=due-today]")).replace(/\s+/g, " ");
await third.click("[data-testid=upgrade-have-code]");
await third.fill("[data-testid=upgrade-code-form] input", BIGCODE);
await third.click("[data-testid=upgrade-code-form] button");
t = (await third.waitForSelector("[data-testid=upgrade-code-form] [role=alert]").then((e) => e.textContent()).catch(() => "")) ?? "";
ok("switch box explains a refused code", /cost less than your Solo plan/.test(t), t);
await third.fill("[data-testid=upgrade-code-form] input", CODE.toLowerCase());
await third.click("[data-testid=upgrade-code-form] button");
t = ((await third.waitForSelector("[data-testid=upgrade-code-applied]").then((e) => e.textContent()).catch(() => "")) ?? "").replace(/\s+/g, " ");
const dueAfter = (await third.textContent("[data-testid=due-today]")).replace(/\s+/g, " ");
ok("switch box applies the code and shows the discount", t.includes(`${CODE}: 20% off your plan for 3 months`) && /Discount/.test(dueAfter) && dueAfter !== dueBefore, `${t} | ${dueAfter} | ${await third.textContent("[data-testid=plan-confirm]")}`);
await third.screenshot({ path: `${process.argv[2] ?? "/tmp"}/upgrade-code.png` });
await third.click("button:has-text('and switch')");
await third.waitForURL((u) => u.pathname === "/settings/billing", { timeout: 20000 });
ok(
  "upgrade with a code: Studio with the discount, refused rather than left pending if unpaid",
  sub3.items.data.some((i) => /studio/.test(i.price.lookup_key)) && sub3.discounts?.[0]?.promotion_code?.id === promo.id && sub3.lastUpdate.payment_behavior === "error_if_incomplete",
  JSON.stringify(sub3.lastUpdate),
);
ok("billing shows the upgrade's discount", ((await third.textContent('[data-testid="discount"]').catch(() => "")) ?? "").includes(`${CODE}: 20% off your plan`));
res = await api(third, "/api/billing/preview", { plan: "AGENCY", code: ONCECODE });
ok("upgrade: a second code can't be added to a discount", res.status() === 400 && /already has a discount/.test((await res.json()).error));
res = await api(fresh, "/api/billing/code", { code: NEWCODE.toLowerCase() });
body = await res.json();
ok("a Free owner's code is saved for checkout", res.ok() && body.applied === false && body.summary === "50% off your whole bill on your first bill", JSON.stringify(body));
res = await api(fresh, "/api/billing/checkout", { plan: "SOLO" });
session = lastSession();
ok("the saved code beats the automatic offer at checkout", res.ok() && session.discounts?.[0]?.promotion_code === state.promos.find((p) => p.code === NEWCODE).id);

// A business that paid before and left: told a new-customers code isn't for them, and if a link brings one anyway, Stripe
// refuses it at checkout and the automatic offer applies instead.
sub3.status = "canceled";
await webhook(third, "customer.subscription.deleted", sub3);
res = await api(third, "/api/billing/code", { code: NEWCODE });
ok("a returning business can't save a new-customers code", res.status() === 400 && /we've never billed before/.test((await res.json()).error));
await third.goto(`${BASE}/offer/${NEWCODE}`);
t = ((await third.textContent('[data-testid="offer-banner"]').catch(() => "")) ?? "").replace(/\s+/g, " ");
ok("the link's banner says who it's for", t.includes("for businesses we've never billed before") && !t.includes("Already subscribed"), t);
res = await api(third, "/api/billing/checkout", { plan: "SOLO" });
session = lastSession();
ok("when Stripe refuses the link's code, the automatic offer applies", res.ok() && session.discounts?.[0]?.promotion_code === promo.id, JSON.stringify(session.discounts));

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
await prisma.workspace.update({ where: { id: linkWs.id }, data: { discountEndsAt: new Date(Date.now() - 60_000) } });
await visitor.goto(BASE + "/settings/billing");
ok("a discount past its end isn't shown, and still no code box", (await visitor.locator('[data-testid="discount"]').count()) === 0 && (await visitor.locator('[data-testid="have-code"]').count()) === 0);

// 7) The Terms cover both.
t = await text(late, "/legal/terms");
ok("terms explain founding prices", /Founding prices are the exception/.test(t) && /16 October 2026/.test(t));
ok("terms explain discounts", /Discount codes and offers work as described when you use them/.test(t) && /only be used when you start a paid subscription or move up to a bigger plan, and when moving up a code can.t bring the new plan below what your current plan costs/.test(t));

// 8) Share links can't be used to try codes: 30 different codes per IP in 10 minutes, and retrying a refused one is refused again.
const linkTo = async (c) => (await late.request.get(`${BASE}/offer/${c}`, { maxRedirects: 0 })).headers().location ?? "";
const opened = `GUESS-${stamp}-first`;
await linkTo(opened);
let busyAt = null;
for (let i = 0; i < 40 && busyAt === null; i++) if ((await linkTo(`GUESS-${stamp}-${i}`)).includes("code=busy")) busyAt = i;
ok("share links stop after 30 different codes", busyAt !== null && busyAt <= 30, String(busyAt));
ok("and asking for the refused code again is refused too", (await linkTo(`GUESS-${stamp}-${busyAt}`)).includes("code=busy"));
ok("a code already opened still works", (await linkTo(opened)).includes("ended="));

await browser.close();
server.close();
await prisma.$disconnect();
