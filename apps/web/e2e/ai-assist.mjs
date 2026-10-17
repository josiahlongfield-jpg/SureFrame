// AI transcripts and summaries add-on: gating (Free and workspaces without the
// add-on can't use it), switching it on (paid via fake Stripe, and free via
// /support/accounts), the summary route (fake Anthropic) storing only
// ciphertext, the fair-use cap, the video page for team and client, the
// client note, and that transcription only runs after the upload has
// finished, never touches the recorder's saved chunks, and fails safely.
//
// The in-browser model can't run headless (no model files, no real speech),
// so the page's transcriber is replaced with window.__sureframeTranscribe.
// Needs the app running with the fake Stripe env (see billing.mjs),
// SUPPORT_EMAIL=owner@test.dev, ANTHROPIC_API_KEY=test and
// ANTHROPIC_BASE_URL=http://localhost:12112.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { start, state, createSubscription } from "./fake-stripe.mjs";
import { requests, startFakeAnthropic } from "./fake-anthropic.mjs";
import { agreed } from "./agree.mjs";
import { chooseClients, sendByLink } from "./send.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
const stripeServer = await start();
const anthropic = await startFakeAnthropic();
const sig = new Stripe("sk_test_fake");
const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args });
const stamp = Date.now();
const perms = { permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"] };
const SPOKEN = "Hello Ana, here is the plan for next week";

/** A speech model "installed" in the app's local storage (the dev server runs without a bucket here). */
const manifestFile = fileURLToPath(new URL("../.data/uploads/models/manifest.json", import.meta.url));
const hadManifest = existsSync(manifestFile);
async function installModel() {
  if (hadManifest) return;
  mkdirSync(dirname(manifestFile), { recursive: true });
  const file = { sha256: "0".repeat(64), bytes: 1 };
  writeFileSync(manifestFile, JSON.stringify({ model: "onnx-community/whisper-base", revision: "0".repeat(40), files: { "config.json": file }, installedAt: new Date().toISOString() }));
}

/** Stands in for the on-device model. `mode` picks what it does; calls are counted. */
function stubTranscriber({ gpu = true, memory = 8 } = {}) {
  return `(() => {
    Object.defineProperty(navigator, "gpu", { value: ${gpu ? "{}" : "undefined"}, configurable: true });
    Object.defineProperty(navigator, "deviceMemory", { value: Number(localStorage.getItem("aiMemory") || ${memory}), configurable: true });
    window.__aiCalls = 0;
    window.__aiMode = localStorage.getItem("aiMode") || "ok";
    window.__sureframeTranscribe = async (blob, onProgress) => {
      window.__aiCalls++;
      window.__aiBlobSize = blob.size;
      onProgress({ stage: "transcribe", fraction: 0.5 });
      await new Promise((r) => setTimeout(r, 300));
      if (window.__aiMode === "fail") throw new Error("Out of memory");
      return { v: 1, segments: [{ start: 0, end: 2.5, text: ${JSON.stringify(SPOKEN)} }, { start: 2.5, end: 4, text: "Talk soon." }] };
    };
  })()`;
}

async function signIn(context, email, next) {
  // Agreed to the current Terms and Privacy Policy, so signing in isn't stopped at /agree (e2e/agree.mjs).
  await agreed(email);
  const page = await context.newPage();
  await page.goto(`${BASE}/login?next=${next}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname === next, { timeout: 60000 });
  // The page streams in behind app/loading.tsx; it makes a new account's workspace, so wait until it has rendered.
  await page.waitForSelector("[role=status][aria-label=Loading]", { state: "detached", timeout: 30000 }).catch(() => {});
  return page;
}
async function webhook(page, sub) {
  const payload = JSON.stringify({ id: `evt_${Date.now()}`, object: "event", type: "customer.subscription.updated", data: { object: sub } });
  const header = sig.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
  return page.request.post(BASE + "/api/webhooks/stripe", { headers: { "stripe-signature": header, "content-type": "application/json" }, data: payload });
}
/** A video row for API-level checks (no recording needed). */
async function fakeVideo(email) {
  const user = await prisma.user.findUnique({ where: { email }, include: { memberships: true } });
  const id = `ai${Math.random().toString(36).slice(2, 12)}`;
  await prisma.video.create({ data: { id, mimeType: "video/webm", storageKey: `test/${id}`, status: "UPLOADED", ownerId: user.id, workspaceId: user.memberships[0].workspaceId } });
  return id;
}
/** The AI section starts collapsed to one bar; open it (waits for the bar to appear). */
async function openAi(page) {
  await page.waitForSelector("[data-testid=ai-toggle]", { timeout: 30000 });
  if ((await page.getAttribute("[data-testid=ai-toggle]", "aria-expanded")) !== "true") await page.click("[data-testid=ai-toggle]");
}
const recorderChunks = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("framecast-recorder");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("chunks")) return resolve("none");
          const tx = db.transaction(["chunks", "sessions"], "readonly");
          const out = {};
          tx.objectStore("chunks").getAllKeys().onsuccess = (e) => (out.chunks = JSON.stringify(e.target.result));
          tx.objectStore("sessions").getAllKeys().onsuccess = (e) => (out.sessions = JSON.stringify(e.target.result));
          tx.oncomplete = () => resolve(JSON.stringify(out));
        };
        req.onerror = () => resolve("error");
      }),
  );

// ---------- 1. Free: no add-on, and the API refuses ----------
const freeEmail = `ai-free${stamp}@example.com`;
const free = await signIn(await browser.newContext(), freeEmail, "/settings/billing");
await free.waitForSelector("[data-testid=ai-assist]");
ok("Free: AI switch is shown but disabled", await free.isDisabled("[data-testid=ai-assist] [role=switch]"));
ok("Free: says not on Free", (await free.textContent("[data-testid=ai-assist]")).includes("not on Free"));
let res = await free.request.post(BASE + "/api/billing/ai", { data: { enabled: true } });
ok("Free: switching on is refused", res.status() === 400);
const freeVideo = await fakeVideo(freeEmail);
res = await free.request.post(`${BASE}/api/videos/${freeVideo}/summary`, { data: { transcript: "[0:00] hi" } });
ok("Free: summary API refuses", res.status() === 403);
res = await free.request.put(`${BASE}/api/videos/${freeVideo}/insight`, { data: { transcript: "x".repeat(40), summary: null } });
ok("Free: saving a transcript is refused", res.status() === 403);
await prisma.workspace.updateMany({ where: { members: { some: { user: { email: freeEmail } } } }, data: { aiAssist: true } });
res = await free.request.post(`${BASE}/api/videos/${freeVideo}/summary`, { data: { transcript: "[0:00] hi" } });
ok("Free: even a stray aiAssist flag doesn't unlock it", res.status() === 403);

// ---------- 2. Paid Solo: switch it on, priced by plan ----------
const ownerCtx = await browser.newContext(perms);
await ownerCtx.addInitScript(stubTranscriber());
const ownerEmail = `ai-owner${stamp}@example.com`;
const owner = await signIn(ownerCtx, ownerEmail, "/record");
await owner.click("text=I've saved it");
await owner.request.post(BASE + "/api/billing/checkout", { data: { plan: "SOLO" } });
const session = state.sessions.at(-1).params;
const workspaceId = session.subscription_data.metadata.workspaceId;
const sub = createSubscription(session.customer, workspaceId, "sureframe_solo_monthly");
await webhook(owner, sub);

const ownerVideoApi = await fakeVideo(ownerEmail);
res = await owner.request.post(`${BASE}/api/videos/${ownerVideoApi}/summary`, { data: { transcript: "[0:00] hi" } });
ok("Solo without the add-on: summary API refuses", res.status() === 403);

// Before the speech model is installed, nobody can pay for the add-on.
res = await owner.request.post(BASE + "/api/billing/ai", { data: { enabled: true } });
ok("Solo: can't buy it before the speech model is installed", res.status() === 503 && !sub.items.data.some((i) => /ai_assist/.test(i.price.lookup_key)));
await installModel();

await owner.goto(BASE + "/settings/billing");
await owner.waitForSelector("[data-testid=ai-assist]");
const billingText = await owner.textContent("[data-testid=ai-assist]");
ok("billing explains what leaves the device", billingText.includes("The audio isn't sent anywhere to make it") && billingText.includes("Anthropic") && billingText.includes("$8 per month"));
// Adding it asks first, in the page (src/components/ConfirmDialog.tsx).
await owner.click("[data-testid=ai-assist] [role=switch]");
await owner.click("[data-testid=ai-confirm-yes]");
await owner.waitForSelector("[data-testid=ai-assist] [role=switch][aria-checked=true]");
const aiItem = sub.items.data.find((i) => i.price.lookup_key === "sureframe_ai_assist_solo_monthly");
ok("Solo add-on added at $8/month", aiItem?.price.unit_amount === 800 && aiItem.price.recurring?.interval === "month");
await webhook(owner, sub);
ok("webhook keeps it on", (await prisma.workspace.findUnique({ where: { id: workspaceId } })).aiAssist === true);

// Clients and a recording sent to one.
await owner.goto(BASE + "/clients");
await owner.fill('input[aria-label="Client name"]', "Ana");
await owner.fill('input[aria-label="Client email"]', `ana${stamp}@example.com`);
await owner.click("button:has-text('Add client')");
await owner.waitForSelector("a:has-text('Ana')");
const ana = await prisma.client.findFirst({ where: { workspaceId, name: "Ana" } });

await owner.goto(BASE + "/record");
await owner.click("text=Camera only");
await owner.click("text=Start recording");
await owner.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await owner.waitForTimeout(3000);
await owner.click("button:has-text('Stop')");
await owner.waitForURL("**/v/**", { timeout: 30000 });
const videoId = owner.url().split("/v/")[1].split("?")[0];
for (let i = 0; i < 100 && (await prisma.video.findUnique({ where: { id: videoId } })).status === "RECORDING"; i++) await owner.waitForTimeout(200);

// ---------- 3. Only after the upload has finished ----------
await prisma.video.update({ where: { id: videoId }, data: { status: "RECORDING" } });
await owner.reload();
await owner.waitForSelector("text=still uploading");
await owner.waitForTimeout(1500);
ok("upload not finished: no transcript panel", (await owner.locator("[data-testid=ai-insight]").count()) === 0);
ok("upload not finished: transcriber not run", (await owner.evaluate(() => window.__aiCalls)) === 0);
await prisma.video.update({ where: { id: videoId }, data: { status: "UPLOADED" } });

// A failure (e.g. out of memory) shows a retry and leaves the recording alone.
const chunksBefore = await recorderChunks(owner);
await owner.evaluate(() => localStorage.setItem("aiMode", "fail"));
await owner.reload();
await openAi(owner);
await owner.waitForSelector("text=Make transcript and summary", { timeout: 20000 });
await owner.click("text=Make transcript and summary");
await owner.waitForSelector("[data-testid=ai-failed]", { timeout: 30000 });
ok("failure says 'Transcript unavailable, try again'", (await owner.textContent("[data-testid=ai-failed]")).includes("Transcript unavailable, try again"));
ok("failure: the video still plays", await owner.isVisible("main video"));
ok("failure: nothing saved", !(await prisma.videoInsight.findUnique({ where: { videoId } })));
ok("failure: recorder chunks untouched", (await recorderChunks(owner)) === chunksBefore, `${chunksBefore}`);
await owner.reload();
await openAi(owner);
await owner.waitForSelector("text=Make transcript and summary", { timeout: 20000 });
ok("after a failure it doesn't restart by itself on this device", (await owner.evaluate(() => window.__aiCalls)) === 0);

// Retry succeeds: transcript made on the device from the decrypted recording, summary from (fake) Claude.
await owner.evaluate(() => localStorage.setItem("aiMode", "ok"));
await owner.reload();
await openAi(owner);
await owner.waitForSelector("text=Make transcript and summary", { timeout: 20000 });
await owner.evaluate(() => (window.__aiMode = "ok"));
const before = requests.length;
await owner.click("text=Make transcript and summary");
await owner.waitForSelector("[data-testid=ai-summary]", { timeout: 30000 });
ok("transcriber got the decrypted recording", (await owner.evaluate(() => window.__aiBlobSize)) > 1000);
ok("recorder chunks still untouched", (await recorderChunks(owner)) === chunksBefore);
const summaryReq = requests.slice(before).find((r) => r.body.output_config?.format);
ok("summary uses Sonnet 5.5 with low effort", summaryReq?.body.model === "claude-sonnet-5-5" && summaryReq.body.output_config.effort === "low");
ok("only transcript text was sent", JSON.stringify(summaryReq?.body.messages).includes(SPOKEN) && !JSON.stringify(summaryReq?.body).includes("data:"));
ok("team sees the summary", (await owner.textContent("[data-testid=ai-summary]")).includes(SPOKEN) && (await owner.isVisible("text=Send the signed form by Friday")));
ok("summary says it can contain mistakes", await owner.isVisible("text=/can contain mistakes/"));
await owner.click("[data-testid=ai-transcript] summary");
ok("team sees the transcript", await owner.isVisible(`[data-testid=ai-transcript] >> text=${SPOKEN}`));
// The conversation panel is tall enough for a video reply, fits the screen and stays beside the video
// however long the transcript (it's sticky, not stretched to the page).
const edges = await owner.evaluate(() => {
  const aside = document.querySelector("[data-testid=conversation]").getBoundingClientRect();
  const section = document.querySelector("main section").getBoundingClientRect();
  return { top: aside.top, bottom: aside.bottom, height: aside.height, screen: innerHeight, section: section.bottom };
});
ok(
  "conversation panel is tall, fits the screen and doesn't stretch with the transcript",
  edges.height >= 480 && edges.bottom <= edges.screen && edges.section > edges.bottom,
  JSON.stringify(edges),
);
await owner.click("button[aria-label='Open conversation in a larger view']");
ok("conversation opens in a larger view", (await owner.getAttribute("[data-testid=conversation]", "data-expanded")) === "true");
await owner.keyboard.press("Escape");
ok("Escape closes the larger view", (await owner.getAttribute("[data-testid=conversation]", "data-expanded")) === null);
await owner.screenshot({ path: `${shots}/ai-team.png`, fullPage: true });

const stored = await prisma.videoInsight.findUnique({ where: { videoId } });
ok("stored transcript is ciphertext", !!stored && /^[A-Za-z0-9_-]+$/.test(stored.transcript) && !stored.transcript.includes("Hello"));
ok("stored summary is ciphertext", !!stored?.summary && /^[A-Za-z0-9_-]+$/.test(stored.summary));
res = await owner.request.put(`${BASE}/api/videos/${videoId}/insight`, { data: { transcript: JSON.stringify({ segments: [{ text: "plain words here" }] }), summary: null } });
ok("plain text is refused by the save API", res.status() === 400);
const devLog = (await import("node:fs")).readFileSync(process.env.DEV_LOG ?? "/tmp/claude-0/dev.log", "utf8");
ok("server log has no transcript text", !devLog.includes(SPOKEN));

// Even a capable computer waits for the button (the first model download is large).
await prisma.videoInsight.deleteMany({ where: { videoId } });
await owner.reload();
await openAi(owner);
await owner.waitForSelector("text=Make transcript and summary", { timeout: 20000 });
await owner.waitForTimeout(1500);
ok("doesn't start by itself, even on a capable computer", (await owner.evaluate(() => window.__aiCalls)) === 0);

// Low-memory device: no automatic start, a button instead.
await prisma.videoInsight.deleteMany({ where: { videoId } });
await owner.evaluate(() => localStorage.setItem("aiMemory", "2"));
await owner.reload();
await openAi(owner);
await owner.waitForSelector("text=Make transcript and summary", { timeout: 20000 });
await owner.waitForTimeout(1500);
ok("low-memory device: no automatic start", (await owner.evaluate(() => window.__aiCalls)) === 0);
ok("low-memory device: says it may struggle", await owner.isVisible("text=This device may struggle"));
await owner.click("text=Make transcript and summary");
await owner.waitForSelector("[data-testid=ai-summary]", { timeout: 30000 });
ok("low-memory device: manual button works", (await owner.evaluate(() => window.__aiCalls)) === 1);
await owner.evaluate(() => localStorage.removeItem("aiMemory"));
await owner.reload();
await openAi(owner);
await owner.waitForSelector("[data-testid=ai-summary]", { timeout: 30000 });

// ---------- 4. The client reads it, sees the note, and can't trigger AI ----------
// First video for Ana: her personal link is copied to send her.
await sendByLink(owner, ana.name);
for (let i = 0; i < 30 && (await prisma.video.findUnique({ where: { id: videoId } })).clientId !== ana.id; i++) await owner.waitForTimeout(100);
const link = await owner.evaluate(() => navigator.clipboard.readText());
const clientCtx = await browser.newContext(perms);
await clientCtx.addInitScript(stubTranscriber());
const client = await clientCtx.newPage();
await client.goto(link);
await openAi(client);
await client.waitForSelector("[data-testid=ai-summary]", { timeout: 30000 });
ok("client sees the summary", (await client.textContent("[data-testid=ai-summary]")).includes(SPOKEN));
await client.click("[data-testid=ai-transcript] summary");
ok("client sees the transcript", await client.isVisible(`[data-testid=ai-transcript] >> text=${SPOKEN}`));
ok("client sees the AI note", (await client.textContent("[data-testid=ai-notice]")).includes("This business uses AI summaries"));
ok("client has no make or remove buttons", !(await client.isVisible("text=Make transcript and summary")) && !(await client.isVisible("text=Remove transcript and summary")));
ok("client's device never transcribes", (await client.evaluate(() => window.__aiCalls)) === 0);
res = await client.request.post(`${BASE}/api/videos/${videoId}/summary`, { data: { transcript: "[0:00] hi" } });
ok("client can't call the summary API", res.status() === 401 || res.status() === 404);
res = await client.request.put(`${BASE}/api/videos/${videoId}/insight`, { data: { transcript: "x".repeat(40), summary: null } });
ok("client can't save transcripts", res.status() === 401 || res.status() === 404);
await client.screenshot({ path: `${shots}/ai-client.png`, fullPage: true });
await client.goto(BASE + "/inbox");
ok("client inbox shows the AI note", !!(await client.waitForSelector("[data-testid=ai-notice]", { timeout: 15000 }).catch(() => null)));

// ---------- 5. Fair-use cap, plan change, switching off ----------
const month = new Date().toISOString().slice(0, 7);
await prisma.aiUsage.upsert({ where: { workspaceId_month: { workspaceId, month } }, create: { workspaceId, month, summaries: 100 }, update: { summaries: 100 } });
res = await owner.request.post(`${BASE}/api/videos/${videoId}/summary`, { data: { transcript: "[0:00] hi" } });
ok("monthly cap reached: refused with a clear message", res.status() === 429 && /fair-use limit/.test((await res.json()).error));
await owner.goto(BASE + "/settings/billing");
ok("billing shows summaries used", (await owner.textContent("[data-testid=ai-assist]")).includes("100 of 100 summaries used this month"));
res = await owner.request.post(BASE + "/api/billing/checkout", { data: { plan: "STUDIO" } });
ok("upgrading moves the add-on to the Studio price", res.ok() && sub.items.data.some((i) => i.price.lookup_key === "sureframe_ai_assist_studio_monthly" && i.price.unit_amount === 1500) && !sub.items.data.some((i) => i.price.lookup_key === "sureframe_ai_assist_solo_monthly"));
await webhook(owner, sub);
res = await owner.request.post(`${BASE}/api/videos/${videoId}/summary`, { data: { transcript: "[0:00] hi" } });
ok("Studio's higher cap applies", res.ok() && (await res.json()).summary?.overview);
res = await owner.request.post(`${BASE}/api/videos/${videoId}/summary`, { data: { transcript: "[0:00] explode" } });
const usage = await prisma.aiUsage.findUnique({ where: { workspaceId_month: { workspaceId, month } } });
ok("a failed summary isn't counted", res.status() === 502 && usage.summaries === 101, `${res.status()} ${usage.summaries}`);
res = await owner.request.post(BASE + "/api/billing/ai", { data: { enabled: false } });
ok("switching off removes the add-on", res.ok() && !sub.items.data.some((i) => /ai_assist/.test(i.price.lookup_key)));
await webhook(owner, sub);
res = await owner.request.post(`${BASE}/api/videos/${videoId}/summary`, { data: { transcript: "[0:00] hi" } });
ok("switched off: summary API refuses", res.status() === 403);
await client.goto(`${BASE}/v/${videoId}`);
await openAi(client);
await client.waitForSelector("[data-testid=ai-summary]", { timeout: 30000 });
ok("existing summary stays readable after switching off", true);
await owner.goto(`${BASE}/v/${videoId}`);
await openAi(owner);
await owner.waitForSelector("[data-testid=ai-summary]", { timeout: 30000 });
owner.once("dialog", (d) => d.accept());
await owner.click("text=Remove transcript and summary");
for (let i = 0; i < 30 && (await prisma.videoInsight.findUnique({ where: { videoId } })); i++) await owner.waitForTimeout(100);
ok("team can remove the transcript", !(await prisma.videoInsight.findUnique({ where: { videoId } })));

// ---------- 6. Complimentary: the founder switches it on, no card ----------
const compEmail = `ai-comp${stamp}@example.com`;
const comp = await signIn(await browser.newContext(), compEmail, "/settings/billing");
const founder = await signIn(await browser.newContext(), "owner@test.dev", "/support/accounts");
await founder.fill("[data-testid=comp-ai] input[name=email]", compEmail);
await founder.fill("[data-testid=comp-ai] textarea[name=reason]", "Partner trial");
await founder.click("text=Save AI");
ok("founder can't give AI to a Free workspace", !!(await founder.waitForSelector("text=AI summaries aren't available on Free", { timeout: 15000 }).catch(() => null)));
await founder.fill('form:not([data-testid=comp-ai]) input[name="email"]', compEmail);
await founder.selectOption("form:not([data-testid=comp-ai]) select", "SOLO");
await founder.fill('form:not([data-testid=comp-ai]) textarea[name="reason"]', "Partner trial");
await founder.click("button:text-is('Save')");
await founder.waitForSelector("text=free of charge");
await founder.fill("[data-testid=comp-ai] input[name=email]", compEmail);
await founder.fill("[data-testid=comp-ai] textarea[name=reason]", "Partner trial");
await founder.click("text=Save AI");
await founder.waitForSelector("text=now has AI summaries free of charge");
ok("listed with AI summaries", (await founder.textContent("main")).includes("+ AI summaries"));
await comp.goto(BASE + "/settings/billing");
await comp.waitForSelector("[data-testid=ai-assist]");
ok("comp workspace: on, no price", (await comp.isChecked("[data-testid=ai-assist] [role=switch]")) && (await comp.textContent("[data-testid=ai-assist]")).includes("Included free"));
const compVideo = await fakeVideo(compEmail);
res = await comp.request.post(`${BASE}/api/videos/${compVideo}/summary`, { data: { transcript: `[0:00] ${SPOKEN}` } });
ok("comp workspace gets summaries without a card", res.ok() && (await res.json()).summary.overview.includes(SPOKEN));
res = await comp.request.post(BASE + "/api/billing/ai", { data: { enabled: false } });
ok("comp workspace can switch it off", res.ok());
res = await comp.request.post(BASE + "/api/billing/ai", { data: { enabled: true } });
ok("and back on, still free", res.ok() && (await prisma.workspace.findFirst({ where: { members: { some: { user: { email: compEmail } } } } })).aiAssist);
await founder.fill('form:not([data-testid=comp-ai]) input[name="email"]', compEmail);
await founder.selectOption("form:not([data-testid=comp-ai]) select", "FREE");
await founder.fill('form:not([data-testid=comp-ai]) textarea[name="reason"]', "Partner trial ended");
await founder.click("button:text-is('Save')");
await founder.waitForSelector("text=back on the Free plan");
res = await comp.request.post(`${BASE}/api/videos/${compVideo}/summary`, { data: { transcript: "[0:00] hi" } });
ok("back on Free: AI is off", res.status() === 403);

// ---------- 7. Pricing page ----------
const visitor = await (await browser.newContext()).newPage();
await visitor.goto(BASE + "/pricing");
const addOn = await visitor.textContent("[data-testid=addon-ai]");
ok("pricing lists the add-on by plan", addOn.includes("$8/month") && addOn.includes("$15/month") && addOn.includes("$29/month") && addOn.includes("Not available on Free"));

if (!hadManifest) rmSync(manifestFile, { force: true });
await browser.close();
stripeServer.close();
anthropic.close();
await prisma.$disconnect();
