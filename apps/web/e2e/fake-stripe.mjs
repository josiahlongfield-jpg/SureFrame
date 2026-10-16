// A tiny in-memory stand-in for the parts of the Stripe API SureFrame uses,
// so billing can be tested without a Stripe account. Start the app with
// STRIPE_API_BASE=http://localhost:12111 STRIPE_SECRET_KEY=sk_test_fake.
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// State survives between runs, like a real Stripe account does (the app caches price ids).
const FILE = process.env.FAKE_STRIPE_STATE ?? `${tmpdir()}/sureframe-fake-stripe.json`;
const saved = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
let n = saved.n ?? 0;
const RUN = Math.random().toString(36).slice(2, 8);
const id = (p) => `${p}_${RUN}${(++n).toString().padStart(6, "0")}`;
export const state = { products: [], prices: [], customers: [], sessions: [], subs: [], portalConfigs: [], portalSessions: [], deletedCustomers: [], coupons: [], promos: [], ...saved.state };
state.coupons ??= [];
state.promos ??= [];
// Set to true to make the next payment on a subscription change fail.
export const control = { declineNext: false };
const persist = () => writeFileSync(FILE, JSON.stringify({ n, state }));

// Decode Stripe's form encoding (a[b][0][c]=x) into nested objects.
function parseForm(body) {
  const out = {};
  for (const [k, v] of new URLSearchParams(body)) {
    const path = k.replace(/\]/g, "").split("[");
    let o = out;
    path.forEach((p, i) => {
      if (i === path.length - 1) o[p] = v;
      else o = o[p] ??= {};
    });
  }
  const arrays = (o) => {
    if (o && typeof o === "object") {
      for (const k of Object.keys(o)) o[k] = arrays(o[k]);
      const keys = Object.keys(o);
      if (keys.length && keys.every((k, i) => k === String(i))) return keys.map((k) => o[k]);
    }
    return o;
  };
  return arrays(out);
}

const list = (data) => ({ object: "list", data, has_more: false, url: "" });

function subItem(price, quantity, end) {
  return { id: id("si"), object: "subscription_item", price, quantity, current_period_end: end };
}

/** A discount on a subscription from a promotion code, as Stripe returns it expanded. */
function discountFrom(promo, subId) {
  const start = Math.floor(Date.now() / 1000);
  const c = promo.promotion.coupon;
  promo.times_redeemed += 1;
  return {
    id: id("di"),
    object: "discount",
    source: { type: "coupon", coupon: c },
    promotion_code: promo,
    start,
    end: c.duration === "repeating" ? start + c.duration_in_months * 30 * 86400 : null,
    subscription: subId,
  };
}

/** A discount straight from a coupon (a referral), with no promotion code. */
function discountFromCoupon(couponId, subId) {
  const c = state.coupons.find((x) => x.id === couponId);
  if (!c) return null;
  c.times_redeemed += 1;
  return { id: id("di"), object: "discount", source: { type: "coupon", coupon: c }, promotion_code: null, start: Math.floor(Date.now() / 1000), end: null, subscription: subId };
}

/** Why Stripe would refuse a promotion code, or null. */
function promoRefusal(promoId, customer) {
  const promo = state.promos.find((x) => x.id === promoId);
  if (!promo || !promo.active) return "This promotion code is not active.";
  if (promo.max_redemptions !== null && promo.times_redeemed >= promo.max_redemptions) return "This promotion code has been fully redeemed.";
  if (promo.restrictions.first_time_transaction && state.subs.some((x) => x.customer === customer)) return "This promotion code cannot be redeemed because the associated customer has prior transactions.";
  return null;
}

export function createSubscription(customer, workspaceId, lookupKey, status = "active", { metadata = {}, promotionCode, coupon } = {}) {
  const price = state.prices.find((p) => p.lookup_key === lookupKey);
  const now = Math.floor(Date.now() / 1000);
  const end = now + (price?.recurring?.interval === "year" ? 365 : 30) * 86400;
  const card = { id: id("pm"), object: "payment_method", type: "card", card: { brand: "visa", last4: "4242" } };
  const sub = { id: id("sub"), object: "subscription", created: now, customer, status, metadata: { workspaceId, ...metadata }, default_payment_method: card, items: list([subItem(price, 1, end)]), discounts: [] };
  const promo = promotionCode && state.promos.find((x) => x.id === promotionCode);
  if (promo) sub.discounts = [discountFrom(promo, sub.id)];
  if (coupon) sub.discounts = [discountFromCoupon(coupon, sub.id)].filter(Boolean);
  state.subs.push(sub);
  return sub;
}

export function start(port = Number(process.env.FAKE_STRIPE_PORT ?? 12111)) {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const url = new URL(req.url, "http://x");
    const form = parseForm(req.method === "GET" ? url.search.slice(1) : body);
    const send = (code, obj) => {
      persist();
      res.writeHead(code, { "Content-Type": "application/json", "Request-Id": "req_fake" });
      res.end(JSON.stringify(obj));
    };
    const p = url.pathname;
    let m;
    if (p === "/v1/prices" && req.method === "GET") {
      const keys = [].concat(form.lookup_keys ?? []);
      return send(200, list(state.prices.filter((x) => x.active && keys.includes(x.lookup_key))));
    }
    if (p === "/v1/products" && req.method === "POST") {
      const prod = { id: id("prod"), object: "product", name: form.name, tax_code: form.tax_code, metadata: form.metadata ?? {} };
      state.products.push(prod);
      return send(200, prod);
    }
    if (p === "/v1/prices" && req.method === "POST") {
      if (form.transfer_lookup_key === "true") for (const x of state.prices) if (x.lookup_key === form.lookup_key) x.lookup_key = null;
      const price = { id: id("price"), object: "price", active: true, product: form.product, unit_amount: Number(form.unit_amount), currency: form.currency, lookup_key: form.lookup_key, recurring: form.recurring };
      state.prices.push(price);
      return send(200, price);
    }
    if (p === "/v1/customers" && req.method === "POST") {
      const c = { id: id("cus"), object: "customer", email: form.email, name: form.name, metadata: form.metadata ?? {} };
      state.customers.push(c);
      return send(200, c);
    }
    if ((m = p.match(/^\/v1\/customers\/([^/]+)$/)) && req.method === "GET") {
      return send(200, { id: m[1], object: "customer", invoice_settings: { default_payment_method: null } });
    }
    if (p === "/v1/invoices/create_preview" && req.method === "POST") {
      // Half the difference in price, as if switching halfway through the period.
      const sub = state.subs.find((s) => s.id === form.subscription);
      const cost = (items) => items.reduce((t, i) => t + (i.price?.unit_amount ?? 0) * (i.quantity ?? 1), 0);
      const after = sub.items.data
        .filter((i) => !(form.subscription_details.items ?? []).some((x) => x.id === i.id && x.deleted === "true"))
        .map((i) => {
          const change = (form.subscription_details.items ?? []).find((x) => x.id === i.id);
          return change?.price ? { price: state.prices.find((x) => x.id === change.price), quantity: i.quantity } : i;
        });
      // The new items in full from today, less half the current ones as unused time, plus 10% tax.
      const full = cost(after);
      const credit = -Math.round(cost(sub.items.data) / 2);
      const tax = Math.max(0, Math.round((full + credit) / 10));
      state.previews = [...(state.previews ?? []), form];
      const lines = list([
        ...after.map((i) => ({ amount: (i.price?.unit_amount ?? 0) * (i.quantity ?? 1), pricing: { type: "price_details", price_details: { price: i.price?.id } } })),
        { amount: credit, pricing: null },
      ]);
      // A code's percentage off the new items (the whole invoice, for simplicity), before tax.
      const promoId = [].concat(form.discounts || [])[0]?.promotion_code;
      const pct = promoId ? Number(state.promos.find((x) => x.id === promoId)?.promotion.coupon.percent_off ?? 0) : 0;
      const discount = Math.round((full * pct) / 100);
      const total = full + credit - discount + tax;
      return send(200, { object: "invoice", amount_due: Math.max(0, total), total, starting_balance: 0, currency: "usd", lines, total_taxes: tax ? [{ amount: tax }] : [], total_discount_amounts: discount ? [{ amount: discount }] : [] });
    }
    if ((m = p.match(/^\/v1\/customers\/([^/]+)$/)) && req.method === "DELETE") {
      state.deletedCustomers.push(m[1]);
      for (const s of state.subs) if (s.customer === m[1]) s.status = "canceled";
      return send(200, { id: m[1], object: "customer", deleted: true });
    }
    if (p === "/v1/invoices" && req.method === "GET") {
      // Every subscription a customer has had was paid for once.
      const paid = state.subs.filter((s) => s.customer === form.customer).map((s) => ({ id: `in_${s.id}`, object: "invoice", customer: s.customer, status: "paid", subscription: s.id }));
      return send(200, list(form.status && form.status !== "paid" ? [] : paid.slice(0, Number(form.limit ?? 10))));
    }
    if (p === "/v1/subscriptions" && req.method === "GET") {
      return send(200, list(state.subs.filter((s) => s.customer === form.customer)));
    }
    if (p === "/v1/checkout/sessions" && req.method === "GET") {
      return send(200, list(state.sessions.filter((s) => s.params.customer === form.customer && s.status === (form.status ?? s.status))));
    }
    if ((m = p.match(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/)) && req.method === "POST") {
      const s = state.sessions.find((x) => x.id === m[1]);
      if (s) s.status = "expired";
      return send(200, s ?? {});
    }
    if (p === "/v1/coupons" && req.method === "POST") {
      // A coupon made with its own id is made once (the app sends an idempotency key too).
      const same = form.id && state.coupons.find((c) => c.id === form.id);
      if (same) return send(200, same);
      const c = {
        id: form.id ?? id("co"),
        object: "coupon",
        name: form.name ?? null,
        percent_off: form.percent_off ? Number(form.percent_off) : null,
        amount_off: null,
        currency: null,
        duration: form.duration ?? "once",
        duration_in_months: form.duration_in_months ? Number(form.duration_in_months) : null,
        ...(form.applies_to ? { applies_to: { products: [].concat(form.applies_to.products ?? []) } } : {}),
        metadata: form.metadata ?? {},
        valid: true,
        times_redeemed: 0,
        max_redemptions: null,
        redeem_by: null,
        created: Math.floor(Date.now() / 1000),
      };
      state.coupons.push(c);
      return send(200, c);
    }
    if ((m = p.match(/^\/v1\/coupons\/([^/]+)$/)) && req.method === "GET") {
      const c = state.coupons.find((x) => x.id === m[1]);
      return c ? send(200, c) : send(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such coupon" } });
    }
    if ((m = p.match(/^\/v1\/coupons\/([^/]+)$/)) && req.method === "DELETE") {
      state.coupons = state.coupons.filter((c) => c.id !== m[1]);
      return send(200, { id: m[1], object: "coupon", deleted: true });
    }
    if (p === "/v1/promotion_codes" && req.method === "GET") {
      let out = state.promos;
      if (form.code) out = out.filter((x) => x.code.toUpperCase() === form.code.toUpperCase());
      if (form.active) out = out.filter((x) => String(x.active) === form.active);
      return send(200, list([...out].reverse().slice(0, Number(form.limit ?? 10))));
    }
    if (p === "/v1/promotion_codes" && req.method === "POST") {
      const coupon = state.coupons.find((c) => c.id === form.promotion?.coupon);
      if (!coupon) return send(400, { error: { type: "invalid_request_error", message: "No such coupon" } });
      if (state.promos.some((x) => x.active && x.code.toUpperCase() === form.code.toUpperCase())) {
        return send(400, { error: { type: "invalid_request_error", message: "An active promotion code with that code already exists." } });
      }
      const promo = {
        id: id("promo"),
        object: "promotion_code",
        active: form.active !== "false",
        code: form.code,
        created: Math.floor(Date.now() / 1000) + state.promos.length,
        customer: null,
        expires_at: form.expires_at ? Number(form.expires_at) : null,
        max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
        metadata: form.metadata ?? {},
        promotion: { type: "coupon", coupon },
        restrictions: { first_time_transaction: form.restrictions?.first_time_transaction === "true", minimum_amount: null, minimum_amount_currency: null },
        times_redeemed: 0,
      };
      state.promos.push(promo);
      return send(200, promo);
    }
    if ((m = p.match(/^\/v1\/promotion_codes\/([^/]+)$/))) {
      const promo = state.promos.find((x) => x.id === m[1]);
      if (!promo) return send(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such promotion code" } });
      if (req.method === "POST") {
        if ("active" in form) promo.active = form.active === "true";
        if (form.metadata) promo.metadata = { ...promo.metadata, ...form.metadata };
      }
      return send(200, promo);
    }
    if (p === "/v1/checkout/sessions" && req.method === "POST") {
      const couponId = form.discounts?.[0]?.coupon;
      if (couponId && !state.coupons.some((c) => c.id === couponId)) return send(400, { error: { type: "invalid_request_error", message: "No such coupon" } });
      const promoId = form.discounts?.[0]?.promotion_code;
      if (promoId) {
        const refusal = promoRefusal(promoId, form.customer);
        if (refusal) return send(400, { error: { type: "invalid_request_error", message: refusal } });
      }
      if (promoId && form.allow_promotion_codes) return send(400, { error: { type: "invalid_request_error", message: "You may only specify one of these parameters: allow_promotion_codes, discounts." } });
      const s = { id: id("cs"), object: "checkout.session", status: "open", url: `https://checkout.stripe.test/${n}`, params: form };
      state.sessions.push(s);
      return send(200, s);
    }
    if ((m = p.match(/^\/v1\/subscriptions\/([^/]+)$/))) {
      const sub = state.subs.find((s) => s.id === m[1]);
      if (!sub) return send(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such subscription" } });
      if (req.method === "DELETE") {
        sub.status = "canceled";
        return send(200, sub);
      }
      if (req.method === "POST") {
        sub.lastUpdate = form;
        if ("cancel_at_period_end" in form) sub.cancel_at_period_end = form.cancel_at_period_end === "true";
        if (form.metadata) sub.metadata = { ...sub.metadata, ...form.metadata };
        if (control.declineNext && form.payment_behavior === "pending_if_incomplete") {
          control.declineNext = false;
          return send(200, { ...sub, pending_update: { expires_at: 0 }, latest_invoice: { id: id("in"), hosted_invoice_url: "https://invoice.stripe.test/pay" } });
        }
        // error_if_incomplete: a declined payment refuses the whole update.
        if (control.declineNext && form.payment_behavior === "error_if_incomplete") {
          control.declineNext = false;
          return send(402, { error: { type: "card_error", code: "card_declined", message: "Your card was declined." } });
        }
        if ("discounts" in form) {
          // Each entry is a promotion code, a coupon, or an existing discount to keep; none clears them.
          const next = [];
          for (const d of [].concat(form.discounts || [])) {
            if (d.promotion_code) {
              // A subscriber has always paid before, so a code for first-time customers is refused.
              const refusal = promoRefusal(d.promotion_code, sub.customer);
              if (refusal) return send(400, { error: { type: "invalid_request_error", message: refusal } });
              next.push(discountFrom(state.promos.find((x) => x.id === d.promotion_code), sub.id));
            } else if (d.coupon) {
              const made = discountFromCoupon(d.coupon, sub.id);
              if (!made) return send(400, { error: { type: "invalid_request_error", message: "No such coupon" } });
              next.push(made);
            } else if (d.discount) {
              const kept = sub.discounts.find((x) => x.id === d.discount);
              if (!kept) return send(400, { error: { type: "invalid_request_error", message: "No such discount" } });
              next.push(kept);
            }
          }
          sub.discounts = next;
        }
        for (const it of [].concat(form.items ?? [])) {
          const existing = sub.items.data.find((i) => i.id === it.id);
          const price = it.price ? state.prices.find((x) => x.id === it.price) : existing?.price;
          if (it.deleted === "true") sub.items.data = sub.items.data.filter((i) => i.id !== it.id);
          else if (existing) Object.assign(existing, { price, quantity: Number(it.quantity ?? existing.quantity) });
          else sub.items.data.push(subItem(price, Number(it.quantity ?? 1), sub.items.data[0]?.current_period_end));
        }
      }
      return send(200, req.method === "POST" ? { ...sub, pending_update: null, latest_invoice: { id: id("in"), hosted_invoice_url: null } } : sub);
    }
    if (p === "/v1/charges" && req.method === "GET") {
      return send(200, list(Object.values(state.charges ?? {}).filter((c) => c.customer === form.customer)));
    }
    if ((m = p.match(/^\/v1\/charges\/([^/]+)$/)) && req.method === "GET") {
      return send(200, (state.charges ?? {})[m[1]] ?? { id: m[1], object: "charge", customer: null });
    }
    if (p === "/v1/billing_portal/configurations" && req.method === "GET") return send(200, list(state.portalConfigs));
    if (p === "/v1/billing_portal/configurations" && req.method === "POST") {
      const c = { id: id("bpc"), object: "billing_portal.configuration", active: true, metadata: form.metadata ?? {} };
      state.portalConfigs.push(c);
      return send(200, c);
    }
    if (p === "/v1/billing_portal/sessions" && req.method === "POST") {
      state.portalSessions.push(form);
      return send(200, { id: id("bps"), object: "billing_portal.session", url: "https://billing.stripe.test/portal", configuration: form.configuration });
    }
    send(404, { error: { type: "invalid_request_error", message: `fake-stripe: no route ${req.method} ${p}` } });
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}
