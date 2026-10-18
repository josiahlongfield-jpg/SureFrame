// Billing and account controls against a fake Stripe (e2e/fake-stripe.mjs).
// Start the app with:
//   STRIPE_SECRET_KEY=sk_test_fake STRIPE_API_BASE=http://localhost:12111 STRIPE_WEBHOOK_SECRET=whsec_test
import { chromium } from "@playwright/test";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { start, state, control, createSubscription } from "./fake-stripe.mjs";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ok = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
};
// Earlier runs share this machine's IP; start with fresh rate-limit windows.
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
const server = await start();
const sig = new Stripe("sk_test_fake");

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage();
const email = `bill${Date.now()}@example.com`;
await page.goto(BASE + "/login?next=/settings/billing");
await agreed(email);
await page.fill('input[name="email"]', email);
await page.click("text=Continue");
await page.waitForURL((u) => u.pathname === "/settings/billing");

const api = (path, data) => page.request.post(BASE + path, { data });
async function webhook(type, sub, secret = "whsec_test") {
  const payload = JSON.stringify({ id: `evt_${Date.now()}`, object: "event", type, data: { object: sub } });
  const header = sig.webhooks.generateTestHeaderString({ payload, secret });
  return page.request.post(BASE + "/api/webhooks/stripe", { headers: { "stripe-signature": header, "content-type": "application/json" }, data: payload });
}
const started = Date.now();
const outbox = () =>
  existsSync(".data/outbox")
    ? readdirSync(".data/outbox").filter((f) => Number(f.split("-")[0]) >= started).sort().map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8")))
    : [];
const alerts = (subject) => outbox().filter((m) => m.to === "owner@test.dev" && m.subject.startsWith("[Action needed]") && m.subject.includes(subject));
const planText = async () => {
  await page.goto(BASE + "/settings/billing");
  // The page streams in behind app/loading.tsx; wait for the plan card itself.
  await page.waitForSelector("main h1:has-text('Billing')", { state: "visible", timeout: 15000 }).catch(() => {});
  return page.textContent("main");
};

// 1) Checkout creates the catalog on first use and uses Managed Payments.
let res = await api("/api/billing/checkout", { plan: "SOLO" });
const { url } = await res.json();
ok("checkout returns a Stripe URL", res.ok() && url?.startsWith("https://checkout.stripe.test"));
const session = state.sessions.at(-1).params;
const proPrice = state.prices.find((p) => p.id === session.line_items[0].price);
ok("Solo price has the right amount", proPrice?.lookup_key === "sureframe_solo_monthly" && proPrice?.unit_amount === 1500 && proPrice.recurring?.interval === "month");
ok("product uses the SaaS tax code", state.products.find((p) => p.id === proPrice.product)?.tax_code === "txcd_10103001");
ok("checkout uses Managed Payments", session.managed_payments?.enabled === "true" && !session.automatic_tax);
ok("checkout charges the Solo price once", session.line_items[0].price === proPrice.id && session.line_items[0].quantity === "1");
const workspaceId = session.subscription_data.metadata.workspaceId;

res = await api("/api/billing/checkout", { plan: "SOLO" });
ok("prices are reused, not duplicated", state.prices.filter((p) => p.lookup_key === "sureframe_solo_monthly").length === 1);

// 2) Stripe confirms the subscription.
const sub = createSubscription(session.customer, workspaceId, "sureframe_solo_monthly");
ok("bad webhook signature refused", (await webhook("customer.subscription.created", sub, "whsec_wrong")).status() === 400);
ok("webhook accepted", (await webhook("customer.subscription.created", sub)).ok());
ok("billing page shows Solo", /Solo plan/.test(await planText()) && /Renews/.test(await page.textContent("main")));

// Cancelling in the portal: the plan stays until the period ends, and Billing says so instead of "Renews".
sub.cancel_at_period_end = true;
await webhook("customer.subscription.updated", sub);
await planText();
ok("a cancelled plan shows when it cancels, not a renewal", (await page.isVisible("[data-testid=cancels-on]")) && !(await page.isVisible("[data-testid=renews-on]")) && /Solo plan/.test(await page.textContent("main")));
sub.cancel_at_period_end = false;
await webhook("customer.subscription.updated", sub);
await planText();
ok("renewing again shows the renewal date", (await page.isVisible("[data-testid=renews-on]")) && !(await page.isVisible("[data-testid=cancels-on]")));

// 3) Extra client seats and cloud backup ride on the same subscription.
res = await api("/api/billing/seats", { extraSeats: 3 });
const seatItem = sub.items.data.find((i) => i.price.lookup_key === "sureframe_client_seat_monthly");
ok("extra seats added to the subscription", res.ok() && seatItem?.quantity === 3 && seatItem.price.unit_amount === 150);
res = await api("/api/billing/backup", { enabled: true });
ok("cloud backup added", res.ok() && sub.items.data.some((i) => i.price.lookup_key === "sureframe_cloud_backup_monthly"));
ok("add-ons are charged today, not at the next renewal", sub.lastUpdate?.proration_behavior === "always_invoice" && sub.lastUpdate?.payment_behavior === "pending_if_incomplete");
control.declineNext = true;
res = await api("/api/billing/seats", { extraSeats: 5 });
ok("a declined card adds nothing and links to the invoice", res.status() === 402 && !!(await res.json()).url && seatItem.quantity === 3);
const lastBefore = sub.lastUpdate;
res = await api("/api/billing/seats", { extraSeats: 3 });
ok("asking for the seats already there changes nothing in Stripe", res.ok() && sub.lastUpdate === lastBefore && seatItem.quantity === 3);
res = await api("/api/billing/seats", { extraSeats: 2 });
ok("removing seats credits the next bill instead", res.ok() && sub.lastUpdate?.proration_behavior === "create_prorations" && seatItem.quantity === 2);
await webhook("customer.subscription.updated", sub);

// 3b) Billing lists what's paid for, each period, with the total; receipts come from Stripe (Link).
await planText();
// A row's cells joined with a space (they're side by side, so textContent alone runs them together).
const pay = (id) =>
  page
    .$eval(`[data-testid=${id}]`, (el) => (el.tagName === "LI" ? [...el.children].map((c) => c.textContent).join(" ") : el.textContent))
    .then((t) => t.replace(/\s+/g, " ").trim(), () => "");
ok("what you pay: the plan", (await pay("pay-plan")) === "Solo plan US$15 a month", await pay("pay-plan"));
ok("what you pay: extra client seats", (await pay("pay-seats")) === "2 extra client seats (US$1.50 each) US$3 a month", await pay("pay-seats"));
ok("what you pay: cloud backup", (await pay("pay-backup")) === "Cloud backup US$5 a month", await pay("pay-backup"));
ok("what you pay: the monthly total", (await pay("pay-total")) === "Total US$23 a month", await pay("pay-total"));
ok("receipts: from Link, Stripe's payment service, with invoices under Manage subscription", /Receipts for your payments come by email from Link, Stripe.s payment service/.test(await pay("receipts-note")));
ok("no raw HTML entities on Billing", !/&(apos|quot|amp|lt|gt);/.test(await page.textContent("main")));
await page.goto(BASE + "/settings/billing?upgraded=1");
await page.waitForSelector("[data-testid=upgraded]");
const thanks = await pay("upgraded");
ok("after checkout: says the plan is on, not that it's pending", thanks.includes("You're on Solo now") && !thanks.includes("as soon as payment is confirmed"), thanks);
// A discount code on a running plan: checked here, used by moving up a plan.
await page.click("[data-testid=have-code]");
await page.fill("#discount-code", "NO-SUCH-CODE");
await page.click("text=Check code");
ok("discount box on a paid plan: an unknown code is refused", !!(await page.waitForSelector("text=That code isn't valid or has ended.", { timeout: 10000 }).catch(() => null)));

// 4) Upgrading switches the plan in place, after the owner confirms what's charged and to which card.
const sessionsBefore = state.sessions.length;
const updateBefore = sub.lastUpdate;
await page.route("https://billing.stripe.test/**", (r) => r.fulfill({ body: "portal" }));
await page.goto(BASE + "/pricing");
await page.click("button:has-text('Switch to Studio')");
const dialog = await page.waitForSelector("[data-testid=plan-confirm]");
const confirmText = await dialog.textContent();
ok("nothing changes before confirming", sub.items.data.some((i) => i.price.lookup_key === "sureframe_solo_monthly") && sub.lastUpdate === updateBefore);
ok("confirm shows the card on file", /Visa ending 4242/.test(confirmText));
ok("confirm shows full price, credit and amount due", /Studio, from today/.test(confirmText) && /Unused time on your current plan/.test(confirmText) && /Due today/.test(confirmText), confirmText);
ok("confirm lists add-ons and tax on their own rows", /Studio, from today\s*US\$49\.00/.test(confirmText) && /Add-ons, from today/.test(confirmText) && /Tax/.test(confirmText));
ok("confirm says the extra seats Studio includes come off", /Studio includes 40 clients, so your 2 extra client seats are removed with this switch/.test(confirmText), confirmText);
{
  const amounts = [...confirmText.matchAll(/(−?)US\$([\d,]+\.\d\d)/g)].map((m) => (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, "")));
  const due = amounts.at(-2) ?? amounts.at(-1); // the Pay button repeats the amount
  ok("the confirm's rows add up to the amount due", Math.abs(amounts.slice(0, amounts.length - 2).reduce((t, a) => t + a, 0) - due) < 0.011, amounts.join(" "));
}
ok("confirm says billing restarts today", /renews on this date each month/.test(confirmText));
await page.click("text=Use a different card");
await page.waitForURL("https://billing.stripe.test/**");
const cardFlow = state.portalSessions.at(-1);
ok("different card opens Stripe's card update", cardFlow.flow_data?.type === "payment_method_update" && cardFlow.flow_data.after_completion.redirect.return_url.endsWith("/pricing"));
await page.goto(BASE + "/pricing");
await page.click("button:has-text('Switch to Studio')");
await page.waitForSelector("[data-testid=plan-confirm]");
await page.click("button:has-text('and switch')");
await page.waitForURL((u) => u.pathname === "/settings/billing" && u.searchParams.get("upgraded") === "1");
ok("upgrade goes straight back to billing, no second checkout", state.sessions.length === sessionsBefore);
ok("upgrade charges now and restarts the billing date", sub.lastUpdate.billing_cycle_anchor?.type === "now" && sub.lastUpdate.proration_behavior === "always_invoice");
// It removes the extra seats, which a pending update can't do, so a declined card refuses it outright (lib/billing.ts chargeChange);
// a plain upgrade keeps a link to pay (4a below).
ok("upgrade only applies once paid", sub.lastUpdate.payment_behavior === "error_if_incomplete");
ok("plan item switched to Studio", sub.items.data.some((i) => i.price.lookup_key === "sureframe_studio_monthly") && !sub.items.data.some((i) => i.price.lookup_key === "sureframe_solo_monthly"));
// Studio includes 40 clients, so the 2 extra seats bought on Solo (no clients yet) come off with the move (lib/planChange.ts).
ok("extra seats the bigger plan includes come off with the upgrade", !sub.items.data.some((i) => i.price.lookup_key?.startsWith("sureframe_client_seat")));
await webhook("customer.subscription.updated", sub);
ok("billing page shows Studio", /Studio plan/.test(await planText()));
await page.goto(BASE + "/pricing");
ok("current plan isn't offered again", !!(await page.waitForSelector("[data-testid=plan-STUDIO] >> text=You’re on Studio", { timeout: 10000 }).catch(() => null)) && (await page.$$("[data-testid=plan-STUDIO] button")).length === 0);

// 4a) A declined card leaves the plan as it was and sends the owner to pay the invoice.
control.declineNext = true;
res = await api("/api/billing/checkout", { plan: "AGENCY" });
const declined = await res.json();
ok("declined upgrade goes to Stripe's invoice page", res.ok() && declined.url === "https://invoice.stripe.test/pay");
ok("declined upgrade keeps Studio", /Studio plan/.test(await planText()) && sub.items.data.some((i) => i.price.lookup_key === "sureframe_studio_monthly"));

// 4b) Switching to yearly moves the plan and every add-on to yearly prices together. Seats bought ahead stay: it isn't a bigger plan.
res = await api("/api/billing/seats", { extraSeats: 2 });
ok("seats can be bought ahead on Studio", res.ok());
res = await api("/api/billing/checkout", { plan: "STUDIO", interval: "year" });
const keys = () => sub.items.data.map((i) => i.price.lookup_key).sort();
ok("yearly switch moves every item, seats bought ahead included", res.ok() && JSON.stringify(keys()) === JSON.stringify(["sureframe_client_seat_yearly", "sureframe_cloud_backup_yearly", "sureframe_studio_yearly"]), keys().join());
const yearly = sub.items.data.find((i) => i.price.lookup_key === "sureframe_studio_yearly");
ok("yearly Studio costs 10 months", yearly?.price.unit_amount === 49000 && yearly.price.recurring?.interval === "year");
res = await api("/api/billing/seats", { extraSeats: 4 });
ok("seats added later bill yearly too", res.ok() && sub.items.data.find((i) => i.price.lookup_key === "sureframe_client_seat_yearly")?.quantity === 4);
await webhook("customer.subscription.updated", sub);
ok("yearly Studio still shows as Studio", /Studio plan/.test(await planText()));
ok("billing says it's billed yearly", (await page.textContent("[data-testid=billing-interval]"))?.includes("yearly"));
await page.goto(BASE + "/clients");
ok("yearly plans see yearly prices for extra clients", !!(await page.waitForSelector("button:has-text('Add for US$75/year')", { timeout: 15000 }).catch(() => null)));
await page.goto(BASE + "/settings/team");
ok("and for extra staff", !!(await page.waitForSelector("button:has-text('/year')", { timeout: 15000 }).catch(() => null)));

// 4c) A switch that also drops something (extra staff, leaving Studio) still only happens once paid.
res = await api("/api/billing/staff", { extraStaff: 1 });
ok("extra staff added (yearly)", res.ok() && sub.items.data.find((i) => i.price.lookup_key === "sureframe_staff_seat_yearly")?.quantity === 1);
await webhook("customer.subscription.updated", sub);
await planText();
ok("what you pay, yearly: extra staff at the yearly price", (await pay("pay-staff")) === "1 extra staff login (US$80 each) US$80 a year", await pay("pay-staff"));
ok("what you pay, yearly: the total is a year's", (await pay("pay-total")).endsWith("a year"), await pay("pay-total"));
control.declineNext = true;
res = await api("/api/billing/checkout", { plan: "SOLO", interval: "year" });
ok("declined downgrade is refused, nothing changes", res.status() === 402 && sub.items.data.some((i) => i.price.lookup_key === "sureframe_studio_yearly") && sub.items.data.some((i) => i.price.lookup_key === "sureframe_staff_seat_yearly"));
ok("still Studio after the declined downgrade", /Studio plan/.test(await planText()));
res = await api("/api/billing/staff", { extraStaff: 0 });
ok("extra staff removed", res.ok() && !sub.items.data.some((i) => i.price.lookup_key === "sureframe_staff_seat_yearly"));
await webhook("customer.subscription.updated", sub);

// 5) Customer portal.
res = await api("/api/billing/portal");
const portal = await res.json();
ok("portal opens with our configuration", res.ok() && portal.url && state.portalConfigs.length === 1);

// 6) Cancelling drops to Free; a stale event for an old subscription can't undo a newer one.
sub.status = "canceled";
await webhook("customer.subscription.deleted", sub);
ok("cancelled subscription returns to Free", /Free plan/.test(await planText()));
const sub2 = createSubscription(session.customer, workspaceId, "sureframe_solo_monthly");
await webhook("customer.subscription.created", sub2);
await webhook("customer.subscription.deleted", sub);
ok("old subscription's events don't override the new one", /Solo plan/.test(await planText()));

// 6a) A second paid subscription for the same workspace: keep the first, and tell a person.
const sub3 = createSubscription(session.customer, workspaceId, "sureframe_studio_monthly");
await webhook("customer.subscription.created", sub3);
ok("a second subscription doesn't take over", /Solo plan/.test(await planText()));
ok("the founder is told about the double subscription", alerts("two subscriptions").length === 1);
sub3.status = "canceled";

// 6b) Refunds and disputes reach a person; a dispute stops renewal.
const refund = { id: `ch_r${Date.now()}`, object: "charge", customer: session.customer, amount: 1650, amount_refunded: 1650, refunded: true, currency: "usd" };
await webhook("charge.refunded", refund);
await webhook("charge.refunded", refund);
ok("a refund emails the founder once", alerts("Refund for").length === 1);
const chargeId = `ch_d${Date.now()}`;
state.charges = { ...(state.charges ?? {}), [chargeId]: { id: chargeId, object: "charge", customer: session.customer } };
await webhook("charge.dispute.created", { id: `dp_${Date.now()}`, object: "dispute", charge: chargeId, amount: 1650, currency: "usd", reason: "fraudulent" });
ok("a dispute stops renewal without ending the paid period", sub2.status !== "canceled" && sub2.lastUpdate?.cancel_at_period_end === "true", JSON.stringify(sub2.lastUpdate));
ok("and emails the founder", alerts("Payment disputed").length === 1);
sub2.status = "active";

// 6c) A subscription Stripe doesn't have (an id from test mode, before the switch to live keys):
// forgotten, not a 500, and the paid features it was giving end.
await prisma.workspace.update({ where: { id: workspaceId }, data: { stripeSubscriptionId: "sub_from_test_mode", plan: "STUDIO", cloudBackup: true, extraClientSeats: 5 } });
res = await api("/api/billing/preview", { plan: "AGENCY" });
ok("a missing subscription goes to checkout instead of failing", res.ok() && (await res.json()).mode === "checkout");
const forgotten = await prisma.workspace.findUnique({ where: { id: workspaceId } });
ok("and its paid features end", forgotten.plan === "FREE" && !forgotten.stripeSubscriptionId && !forgotten.cloudBackup && forgotten.extraClientSeats === 0 && forgotten.stripeCustomerId === session.customer);
await webhook("customer.subscription.updated", sub2);
ok("the real subscription is picked up again", /Solo plan/.test(await planText()));
// The daily clean-up does the same for subscriptions nobody opens Billing for, and fills in
// the billing interval for workspaces from before it was stored.
const daily = () => page.request.get(BASE + "/api/cron/purge", { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? "test-cron-secret"}` } });
// It runs after the job's response, so wait for it.
const settle = async (done) => {
  for (let i = 0; i < 180; i++) {
    const w = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (done(w)) return w;
    await new Promise((r) => setTimeout(r, 500));
  }
  return prisma.workspace.findUnique({ where: { id: workspaceId } });
};
await prisma.workspace.update({ where: { id: workspaceId }, data: { billingInterval: null } });
res = await daily();
ok("the daily check fills in a missing billing interval", res.ok() && (await settle((w) => w.billingInterval)).billingInterval === "month");
await prisma.workspace.update({ where: { id: workspaceId }, data: { stripeSubscriptionId: "sub_from_test_mode", plan: "STUDIO" } });
res = await daily();
const checked = await settle((w) => !w.stripeSubscriptionId);
ok("and forgets a subscription Stripe doesn't have", res.ok() && checked.plan === "FREE" && !checked.stripeSubscriptionId);
await webhook("customer.subscription.updated", sub2);
ok("which comes back with the next webhook for a real one", /Solo plan/.test(await planText()));

// 7) Data export.
res = await page.request.get(BASE + "/api/account/export");
const exp = await res.json();
ok("export downloads as a file", /attachment/.test(res.headers()["content-disposition"] ?? ""));
ok("export has the account and workspace", exp.user?.email === email && exp.workspaces?.[0]?.workspace?.id === workspaceId);

// 8) Deleting the account: closed now and deleted 30 days later, unless they sign in and keep it.
// The dispute above stopped renewal; renew again, as in Manage subscription.
sub2.cancel_at_period_end = false;
await webhook("customer.subscription.updated", sub2);
await page.goto(BASE + "/settings/account");
const explainer = (await page.textContent("[data-testid=delete-explainer]")).replace(/\s+/g, " ");
ok("explainer: closed now, deleted in 30 days unless kept, plan won't renew", explainer.includes("closed straight away and permanently deleted 30 days later") && explainer.includes("sign in to keep it") && explainer.includes("your plan won't renew"), explainer);
await page.fill('input[name="confirm"]', "someone@else.com");
ok("wrong confirmation: the button stays off", await page.isDisabled("[data-testid=delete-account]"));
await page.fill('input[name="confirm"]', email);
await page.click("text=Delete my account");
await page.click("[data-testid=delete-account-yes]");
await page.waitForURL((u) => u.pathname === "/login");
ok("after closing: told it's deleted in 30 days unless kept", ((await page.textContent("[data-testid=deleted-note]", { timeout: 10000 }).catch(() => "")) ?? "").includes("will be deleted in 30 days"));
const closedUser = await prisma.user.findUnique({ where: { email } });
const closedWs = await prisma.workspace.findUnique({ where: { id: workspaceId } });
ok("closing schedules deletion 30 days out", !!closedUser?.deleteAt && Math.abs(closedUser.deleteAt.getTime() - (Date.now() + 30 * 86_400_000)) < 10 * 60_000);
ok("closing stops renewal, and notes it so keeping turns it back on", closedWs.deleteAt?.getTime() === closedUser.deleteAt.getTime() && !!closedWs.renewalStoppedAt);
ok("closing stops renewal in Stripe, without cancelling or deleting the customer", sub2.cancel_at_period_end === true && sub2.status === "active" && !state.deletedCustomers.includes(session.customer));
const closedMail = outbox().find((m) => m.to === email && m.subject.startsWith("Your SureFrame account will be deleted on"));
ok("emailed the date, how to keep it, and that the plan won't renew", !!closedMail && closedMail.text.includes("/account/restore") && closedMail.text.includes("Your Solo plan won't renew"), closedMail?.text);
await page.goto(BASE + "/settings/billing");
// Pages stream behind a loading state, so the sign-in redirect can land just after the load.
ok("signed out after closing", !!(await page.waitForURL("**/login**", { timeout: 10000 }).then(() => true).catch(() => null)));

// Signing in again offers to keep it; keeping it turns renewal back on.
await page.goto(BASE + "/login?next=/settings/billing");
await page.fill('input[name="email"]', email);
await page.click("text=Continue");
await page.waitForURL((u) => u.pathname === "/account/restore");
ok("signing in again offers to keep the account", (await page.textContent("main")).includes("Your Solo plan renews as normal again"));
await page.click("button:text-is('Keep my account')");
await page.waitForURL((u) => u.pathname === "/library");
const keptUser = await prisma.user.findUnique({ where: { email } });
const keptWs = await prisma.workspace.findUnique({ where: { id: workspaceId } });
ok("keeping it clears the deletion", !keptUser.deleteAt && !keptWs.deleteAt && !keptWs.renewalStoppedAt && new URL(page.url()).searchParams.get("restored") === "1");
ok("keeping it turns renewal back on in Stripe", sub2.cancel_at_period_end === false && sub2.lastUpdate?.cancel_at_period_end === "false" && sub2.status === "active");
await webhook("customer.subscription.updated", sub2);
await planText();
ok("Billing shows the renewal again", (await page.isVisible("[data-testid=renews-on]")) && /Solo plan/.test(await page.textContent("main")));

// Closed again; once the date has passed the daily job deletes it, ends billing and deletes the customer.
await page.goto(BASE + "/settings/account");
await page.fill('input[name="confirm"]', email);
await page.click("text=Delete my account");
await page.click("[data-testid=delete-account-yes]");
await page.waitForURL((u) => u.pathname === "/login");
ok("closed again: renewal stopped and noted", !!(await prisma.workspace.findUnique({ where: { id: workspaceId } })).renewalStoppedAt);
// A payment disputed while it's closed: keeping it mustn't turn renewal back on.
const chargeId2 = `ch_d2${Date.now()}`;
state.charges = { ...(state.charges ?? {}), [chargeId2]: { id: chargeId2, object: "charge", customer: session.customer } };
await webhook("charge.dispute.created", { id: `dp2_${Date.now()}`, object: "dispute", charge: chargeId2, amount: 1650, currency: "usd", reason: "fraudulent" });
ok("a dispute while it's closed: Keep my account won't turn renewal back on", !(await prisma.workspace.findUnique({ where: { id: workspaceId } })).renewalStoppedAt && sub2.cancel_at_period_end === true);
await prisma.user.update({ where: { email }, data: { deleteAt: new Date(Date.now() - 60_000) } });
res = await daily();
ok("the daily job deletes it once its date has passed", res.ok() && (await res.json()).accountsPurged >= 1 && !(await prisma.user.findUnique({ where: { email } })) && !(await prisma.workspace.findUnique({ where: { id: workspaceId } })));
ok("deleting cancels billing in Stripe", state.deletedCustomers.includes(session.customer) && state.subs.filter((s) => s.customer === session.customer).every((s) => s.status === "canceled"));
ok("and says so by email", outbox().some((m) => m.to === email && m.subject === "Your SureFrame account has been deleted"));
await page.goto(BASE + "/settings/billing");
ok("signed out after deletion", !!(await page.waitForURL("**/login**", { timeout: 10000 }).then(() => true).catch(() => null)));

// 9) Rate limits.
let limited = false;
for (let i = 0; i < 25 && !limited; i++) limited = (await page.request.post(BASE + "/api/billing/portal")).status() === 429;
ok("billing endpoints are rate limited", limited);

await browser.close();
await prisma.$disconnect();
server.close();
