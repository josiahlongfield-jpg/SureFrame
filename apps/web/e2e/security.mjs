// Security regressions: redirects, mobile sign-in handoff, upload bounds, cron auth.
import { chromium } from "@playwright/test";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const email = `sec${Date.now()}@example.com`;
await page.goto(BASE + "/login?next=/library");
await agreed(email);
await page.fill('input[name="email"]', email);
await page.click("text=Continue");
await page.waitForURL((u) => u.pathname === "/library");

// The script policy (SEC-9, src/lib/scriptPolicy.ts): every page carries one with a fresh nonce, the site's own
// scripts run under it with nothing refused, and a handler slipped into a page is refused.
const refusals = (p) => {
  const seen = [];
  p.on("console", (m) => /Content Security Policy/i.test(m.text()) && seen.push(m.text()));
  return seen;
};
const policyOf = (res) => res?.headers()["content-security-policy"] ?? "";
const nonceOf = (csp) => /'nonce-([^']+)'/.exec(csp)?.[1];
{
  const tab = await ctx.newPage();
  const seen = refusals(tab);
  const first = policyOf(await tab.goto(BASE + "/library", { waitUntil: "networkidle" }));
  ok("pages carry a script policy with a nonce", /script-src [^;]*'nonce-[^']+'[^;]*'strict-dynamic'/.test(first) && first.includes("frame-ancestors 'none'"), first);
  ok("the site's own code runs under it", await tab.evaluate(() => !!window.next?.appDir));
  await tab.click("header nav a[href='/todos']");
  await tab.waitForURL((u) => u.pathname === "/todos");
  const second = policyOf(await tab.reload({ waitUntil: "networkidle" }));
  ok("each page gets a fresh nonce", !!nonceOf(second) && nonceOf(second) !== nonceOf(first), second);
  ok("nothing on a signed-in page is refused by the policy", seen.length === 0, seen.join(" | "));
  await tab.close();
  const visitor = await browser.newContext();
  const p = await visitor.newPage();
  const shut = refusals(p);
  for (const path of ["/", "/pricing", "/login"]) await p.goto(BASE + path, { waitUntil: "networkidle" });
  ok("nothing on the public pages or sign-in is refused by the policy", shut.length === 0, shut.join(" | "));
  ok("the layout's own inline script runs (sign-in sets the time zone cookie)", (await visitor.cookies()).some((c) => c.name === "sf_tz"));
  await p.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<img src="/csp-probe-missing.png" onerror="window.__injected = 1">'));
  await p.waitForTimeout(1500);
  ok("a handler slipped into a page is refused", !(await p.evaluate(() => window.__injected)) && shut.some((t) => /inline event handler/i.test(t)), shut.join(" | "));
  await visitor.close();
}

// Open redirect after login.
for (const bad of ["/%5Cevil.com", "//evil.com", "/\\evil.com", "https://evil.com"]) {
  const res = await page.request.get(`${BASE}/login?next=${encodeURIComponent(bad).replace("%255C", "%5C")}`, { maxRedirects: 0 });
  const loc = res.headers()["location"] ?? "";
  ok(`login next=${bad} stays on site`, !/evil/.test(loc), loc);
}

// Mobile handoff: one-time code + PKCE, with a consent step.
const verifier = crypto.randomBytes(32).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
await page.goto(`${BASE}/mobile/handoff?challenge=${challenge}`);
ok("handoff asks before signing the app in", !!(await page.waitForSelector("text=Sign in to the SureFrame app?", { timeout: 10000 }).catch(() => null)));
// The server action answers with a redirect to the app's scheme.
const appRedirect = (p) =>
  p.waitForResponse((r) => (r.headers()["x-action-redirect"] ?? "").startsWith("sureframe://"), { timeout: 10000 })
    .then((r) => r.headers()["x-action-redirect"].split(";")[0]);
const appUrl = appRedirect(page).catch(() => null);
await page.click("text=Continue to the app");
const back = await appUrl;
const code = back && new URL(back.replace("sureframe://", "https://x/")).searchParams.get("code");
ok("app receives a code, not a session token", !!code && !/token=/.test(back ?? ""), back ?? "no navigation");
const anon = await chromium.launch({ executablePath: process.env.CHROMIUM }).then((b) => b.newContext());
const ex = (body) => anon.request.post(BASE + "/api/mobile/exchange", { data: body });
ok("wrong verifier refused", (await ex({ code, verifier: crypto.randomBytes(32).toString("base64url") })).status() === 400);
const fresh = await (async () => {
  // A fresh tab: the first one is stuck on the app-scheme navigation.
  const tab = await page.context().newPage();
  await tab.goto(`${BASE}/mobile/handoff?challenge=${challenge}`, { waitUntil: "networkidle" });
  const u = appRedirect(tab);
  await tab.click("text=Continue to the app");
  return new URL((await u).replace("sureframe://", "https://x/")).searchParams.get("code");
})();
const good = await ex({ code: fresh, verifier });
const sess = await good.json();
ok("right verifier gets a session", good.ok() && sess.token?.length > 50, JSON.stringify(sess));
ok("code works only once", (await ex({ code: fresh, verifier })).status() === 400);
// Sign-ins end after 8 hours unused, for the app too: it has to send its last-activity time
// (the sf_active cookie) along with the session, or the API treats it as signed out. The time is signed by the
// server (src/lib/activityMark.ts), so the app is handed its first one with the session and can't make one up.
const bare = await anon.request.get(BASE + "/api/clients", { headers: { cookie: `${sess.cookie}=${sess.token}` } });
ok("the app's session alone counts as signed out", bare.status() === 401);
const made = await anon.request.get(BASE + "/api/clients", { headers: { cookie: `${sess.cookie}=${sess.token}; sf_active=${Date.now()}` } });
ok("nor does it work with an activity time the app made up", made.status() === 401, String(made.status()));
const me = await anon.request.get(BASE + "/api/clients", { headers: { cookie: `${sess.cookie}=${sess.token}; ${sess.activity}` } });
ok("the app's session works on the API with the activity time it was given", me.ok() && /^sf_active=\d+\.[\w-]{43}$/.test(sess.activity ?? ""), `${me.status()} ${sess.activity}`);
ok("handoff without a challenge refuses", await (async () => { await page.goto(`${BASE}/mobile/handoff`); return !!(await page.waitForSelector("text=Update the SureFrame app", { timeout: 10000 }).catch(() => null)); })());

// Upload bounds.
const v = await (await page.request.post(BASE + "/api/videos", { data: { mimeType: "video/webm" } })).json();
const vid = v.video?.id;
const huge = await page.request.post(`${BASE}/api/videos/${vid}/complete`, { data: { partCount: 2_000_000_000 } });
ok("absurd part count refused quickly", huge.status() === 400, String(huge.status()));

// A recording far longer than the plan allows (more than twice its length) is refused when it completes; one that
// ran a little over is kept (free-limit.mjs).
const ws = (await prisma.membership.findFirst({ where: { user: { email } } })).workspaceId;
const fp = "f".repeat(32), wrap = "w".repeat(44);
await prisma.workspace.update({ where: { id: ws }, data: { keyFingerprint: fp } });
const newVideo = async () => (await (await page.request.post(BASE + "/api/videos", { data: { mimeType: "video/webm", teamKeyWrap: wrap, keyFingerprint: fp } })).json()).video.id;
const upload = (id, ch) => page.request.put(`${BASE}/api/videos/${id}/parts/1`, { data: Buffer.from(ch.repeat(1000)), headers: { "content-type": "application/octet-stream" } });
const longId = await newVideo();
await upload(longId, "x");
const tooLong = await page.request.post(`${BASE}/api/videos/${longId}/complete`, { data: { partCount: 1, durationMs: 3 * 60 * 60 * 1000 } });
ok("recording over the plan's length refused", tooLong.status() === 413, String(tooLong.status()));

// The pieces of one recording can't add up to more than the plan's size budget (0.3 GB on Free), wherever each one
// says it sits: ten pieces of 32 MB all claiming the start of the recording are 320 MB.
const piecesId = await newVideo();
const piece = (seq) => page.request.post(`${BASE}/api/videos/${piecesId}/pieces/${seq}`, { data: { offset: 0, size: 32 * 1024 * 1024 } });
const nine = [];
for (let seq = 0; seq < 9; seq++) nine.push((await piece(seq)).status());
ok("pieces within the size budget are accepted", nine.every((s) => s === 200), nine.join(" "));
const tenth = await piece(9);
ok("a piece that would take the recording past its size budget is refused", tenth.status() === 413, String(tenth.status()));
const again = await piece(3);
ok("a piece already accepted can still be sent again", again.status() === 200, String(again.status()));
await page.request.delete(`${BASE}/api/videos/${piecesId}`);

// Once a client has replied, the video can't be moved to another client (their replies would go with it).
const [c1, c2] = await Promise.all(["Ann", "Ben"].map((name) => prisma.client.create({ data: { name, token: crypto.randomBytes(16).toString("hex"), workspaceId: ws } })));
const shortId = await newVideo();
await upload(shortId, "y");
await page.request.post(`${BASE}/api/videos/${shortId}/complete`, { data: { partCount: 1, durationMs: 2000 } });
const sendTo = (clientId) => page.request.patch(`${BASE}/api/videos/${shortId}`, { data: { clientId, clientKeyWrap: wrap, keyFingerprint: fp } });
ok("video sent to a client", (await sendTo(c1.id)).ok());
await prisma.reply.create({ data: { kind: "TEXT", body: "hi", authorName: "Ann", videoId: shortId } });
const moved = await sendTo(c2.id);
ok("after a reply, moving it to another client is refused", moved.status() === 409, String(moved.status()));
ok("the video stays with the first client", (await prisma.video.findUnique({ where: { id: shortId } })).clientId === c1.id);

// Cron needs the exact secret.
ok("cron refuses a wrong secret", (await anon.request.get(BASE + "/api/cron/purge", { headers: { authorization: "Bearer nope" } })).status() === 401);

await browser.close();
await prisma.$disconnect();
process.exit();
