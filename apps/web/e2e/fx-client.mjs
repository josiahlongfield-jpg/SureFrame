// The client's watch page and the conversation (src/components/WatchView.tsx, ReplyComposer.tsx):
// - the Free plan's intro names the sender, shows once per device per business, can be skipped after a
//   few seconds, starts the video, and never covers a page that can't open;
// - video and voice replies are reviewed before sending (Send, Re-record, Discard), one cut short by a
//   closed browser is never sent by itself (and is deleted after 7 days unsent, which both screens say),
//   and anyone can delete their own replies (file included);
// - unread counts only the other side's messages; own messages sit on the right; the panel names who
//   the conversation is with; clients don't see a view count, and a client opening the video counts;
// - reactions toggle and never double up; the business's message (encrypted) shows above the video;
// - one plain "can't open" card for every dead end; the inbox marks new and replied videos, can forget
//   this device and turns emails back on in one tap; and everything fits a 320px phone.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";
import { sendByLink } from "./send.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp/claude-0/fx-client-shots";
mkdirSync(shots, { recursive: true });
const prisma = new PrismaClient();
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};
const waitFor = async (fn, ms = 20000) => {
  for (let t = 0; t < ms; t += 250) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return fn();
};
const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const shown = (p, sel, timeout = 10000) => p.locator(sel).first().waitFor({ timeout }).then(() => true, () => false);

const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args });

// ---------- The business records a video ----------
const ownerCtx = await browser.newContext({ permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"], viewport: { width: 1360, height: 900 } });
const owner = await ownerCtx.newPage();
const email = `fxclient${Date.now()}@example.com`;
await owner.goto(BASE + "/record");
await agreed(email);
await owner.fill('input[name="email"]', email);
await owner.click("text=Continue");
await owner.waitForURL("**/record");
await owner.click("text=I've saved it");
const ws = (await waitFor(() => prisma.membership.findFirst({ where: { user: { email } } }))).workspaceId;
await prisma.workspace.update({ where: { id: ws }, data: { name: "Business A" } });
await owner.click("text=Camera only");
await owner.click("text=Start recording");
await owner.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await owner.waitForTimeout(3000);
await owner.click("button:has-text('Stop')");
await owner.waitForURL("**/v/**", { timeout: 30000 });
const videoId = owner.url().split("/v/")[1].split("?")[0];
await waitFor(async () => (await prisma.video.findUnique({ where: { id: videoId } })).status !== "RECORDING");
await owner.reload();
await owner.waitForSelector("textarea[aria-label='Video title']", { timeout: 20000 });

// Not sent yet: no reactions, and no "be the first" prompt.
ok("unsent video: no reactions", (await owner.locator("[data-testid=reactions]").count()) === 0);
const empty = (await owner.textContent("[data-testid=conversation-empty]")) ?? "";
ok("unsent video: says who will see the conversation, not 'be the first'", empty.includes("Not sent to a client yet") && !empty.includes("Be the first"), empty);

// The title looks editable and says when it's saved, with a note that titles aren't encrypted.
ok("title has an edit button", await owner.isVisible("button[aria-label='Edit title']"));
ok("title note: not encrypted", await owner.isVisible("text=Titles aren't encrypted"));
await owner.fill("textarea[aria-label='Video title']", "Week 1 plan for a long title that keeps going so it has to wrap on a small phone screen");
await owner.keyboard.press("Enter");
ok("title: Saved confirmation", await shown(owner, "[data-testid=title-saved]"));
ok("title saved", (await prisma.video.findUnique({ where: { id: videoId } })).title.startsWith("Week 1 plan"));

// A message to the client, encrypted before it's stored.
await owner.click("[data-testid=message-editor] >> text=Add message");
await owner.fill("textarea[aria-label^='Message to']", "Here's your plan. Start Monday.");
await owner.click("text=Save message");
ok("message: Saved confirmation", await shown(owner, "[data-testid=message-saved]"));
const sealed = (await prisma.video.findUnique({ where: { id: videoId } })).message ?? "";
ok("message stored encrypted (no plain text on the server)", sealed.length > 24 && !sealed.includes("plan") && /^[\w-]+$/.test(sealed), sealed.slice(0, 40));

// A client, sent the video with their personal link.
await owner.goto(BASE + "/clients");
await owner.fill('input[aria-label="Client name"]', "Client A");
await owner.click("button:has-text('Add client')");
await owner.waitForSelector("text=Client A");
const clientRow = await waitFor(() => prisma.client.findFirst({ where: { workspaceId: ws, name: "Client A" } }));
await prisma.client.update({ where: { id: clientRow.id }, data: { email: "clienta@example.com" } });
await owner.goto(`${BASE}/v/${videoId}`);
await sendByLink(owner, "Client A");
const link = await owner.evaluate(() => navigator.clipboard.readText());
await owner.reload();
await owner.waitForSelector("[data-testid=conversation-title]", { timeout: 20000 });
ok("panel names the client", (await owner.textContent("[data-testid=conversation-title]")) === "Conversation with Client A");

// ---------- The client, on a 320px phone ----------
const phoneCtx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
const phone = await phoneCtx.newPage();
await phone.goto(link);
await phone.waitForURL("**/v/**");
ok("intro: shown on the Free plan", await shown(phone, "[data-testid=sureframe-promo]", 20000));
ok("intro: leads with the sender", (await phone.textContent("[data-testid=promo-sender]")) === "Business A sent you a private video");
ok("intro: SureFrame is a small credit", await phone.isVisible("[data-testid=sureframe-promo] >> text=Made with SureFrame"));
ok("intro: can't be skipped straight away", await phone.isDisabled("text=/Watch now \\(\\d\\)/"));
ok("intro fits 320px", await fits(phone));
await phone.screenshot({ path: `${shots}/intro-320.png` });
await phone.waitForSelector("button:has-text('Watch now'):not([disabled])", { timeout: 6000 });
ok("intro: skippable within a few seconds", true);
await phone.tap("text=/^Watch now$/");
ok("intro closes", !(await phone.isVisible("[data-testid=sureframe-promo]")));
ok("Watch now starts the video", !!(await phone.waitForFunction(() => { const v = document.querySelector("main video"); return v && !v.paused && v.currentTime > 0; }, null, { timeout: 20000 }).catch(() => null)));
await phone.reload();
await phone.waitForSelector("main video", { timeout: 20000 });
ok("intro: once per device per business", !(await shown(phone, "[data-testid=sureframe-promo]", 2500)));

ok("client: the business's message above the video", (await phone.textContent("[data-testid=business-message]")).includes("Here's your plan. Start Monday."));
const meta = await phone.textContent("[data-testid=video-meta]");
ok("client: no view count", !/view/.test(meta), meta);
ok("opening it counts as a view (no play needed)", (await waitFor(async () => (await prisma.video.findUnique({ where: { id: videoId } })).viewCount >= 1, 5000)) === true);
ok("client: How this works answers", (await phone.textContent("[data-testid=how-this-works]")).includes("How this works"));
await phone.click("[data-testid=how-this-works] summary");
const how = await phone.textContent("[data-testid=how-this-works]");
ok("How this works: who sees replies, notifications, deleting, devices, views", ["Only you and Business A", "emailed that you replied", "tap Delete", "another device", "how many times you've opened"].every((t) => how.includes(t)), how);
ok("client: download names the business and title", (await phone.getAttribute("a:has-text('Save to device')", "download"))?.startsWith("Business A - Week 1 plan"));
ok("no floating button over the video, title or reactions", !(await phone.isVisible("[data-testid=chat-bubble]")));
ok("the reply card is in the page, right under the reactions", await phone.isVisible("[data-testid=chat-inline] >> text=Reply to Business A"));
ok("client page fits 320px", await fits(phone));
await phone.screenshot({ path: `${shots}/client-320.png`, fullPage: true });

// Reactions: highlighted, a second tap takes it back, quick taps never double up.
const thumbs = "button[aria-label='React 👍']";
await phone.tap(thumbs);
const burstBg = await phone.waitForSelector("[data-testid=reaction-burst]", { timeout: 2000 }).then((e) => e.evaluate((el) => getComputedStyle(el).backgroundColor), () => "");
await phone.waitForFunction((s) => document.querySelector(s)?.getAttribute("aria-pressed") === "true", thumbs);
await waitFor(async () => (await prisma.reaction.count({ where: { videoId, byClient: true } })) === 1, 5000);
ok("reaction highlighted and saved once", (await prisma.reaction.count({ where: { videoId, byClient: true } })) === 1);
ok("the reaction float sits on a white disc (keeps its colours over the video)", burstBg === "rgb(255, 255, 255)", burstBg);
await phone.waitForTimeout(400);
await phone.tap(thumbs);
await waitFor(async () => (await prisma.reaction.count({ where: { videoId, byClient: true } })) === 0, 5000);
ok("second tap takes it back", (await prisma.reaction.count({ where: { videoId, byClient: true } })) === 0 && (await phone.getAttribute(thumbs, "aria-pressed")) === "false");
const fire = "button[aria-label='React 🔥']";
await phone.evaluate((s) => { const b = document.querySelector(s); b.click(); b.click(); b.click(); }, fire);
await phone.waitForTimeout(1500);
const fires = await prisma.reaction.count({ where: { videoId, byClient: true, emoji: "🔥" } });
ok("quick repeated taps never double up", fires <= 1 && (fires === 1) === ((await phone.getAttribute(fire, "aria-pressed")) === "true"), String(fires));

// The conversation: private wording, own messages on the right.
await phone.tap("[data-testid=chat-open]");
await phone.waitForSelector("[data-testid=conversation][data-sheet]");
ok("sheet names the business", (await phone.textContent("[data-testid=conversation-title]")) === "Conversation with Business A");
ok("empty conversation says it's private", (await phone.textContent("[data-testid=conversation-empty]")) === "Only you and Business A can see this conversation.");
await phone.fill('textarea[aria-label="Reply"]', "Hello from Client A");
await phone.tap("button:has-text('Send reply')");
await phone.waitForSelector("[data-testid=conversation] li[data-mine] >> text=Hello from Client A", { timeout: 15000 });
ok("own message on the right", true);
ok("sheet fits 320px", await fits(phone));

// Video reply: review, re-record and discard delete it; Send sends it, with a clear confirmation.
const mediaReplies = () => prisma.reply.count({ where: { videoId, kind: "VIDEO" } });
await phone.tap("role=tab[name='Video']");
await phone.tap("button:has-text('Record video reply'):not([disabled])", { timeout: 15000 });
await phone.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await phone.waitForTimeout(2500);
await phone.tap("button:has-text('Stop recording')");
await phone.waitForSelector("[data-testid=reply-review] video", { timeout: 15000 });
ok("review: plays it back first, with Send, Re-record and Discard", (await Promise.all(["Send video reply", "Re-record", "Discard"].map((t) => phone.isVisible(`[data-testid=reply-review] >> text=${t}`)))).every(Boolean));
ok("review: says an unsent reply is deleted after 7 days", (await phone.textContent("[data-testid=reply-review-expiry]")).includes("7 days"));
ok("review: nothing in the conversation yet", (await phone.locator("[data-testid=conversation] ul video").count()) === 0);
await phone.screenshot({ path: `${shots}/review-320.png` });
await phone.tap("text=Re-record");
await phone.waitForSelector("button:has-text('Record video reply'):not([disabled])", { timeout: 15000 });
ok("Re-record deletes the first take from the server", (await waitFor(async () => (await mediaReplies()) === 0, 5000)) === true);
await phone.tap("button:has-text('Record video reply')");
await phone.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await phone.waitForTimeout(2000);
await phone.tap("button:has-text('Stop recording')");
await phone.waitForSelector("[data-testid=reply-review]", { timeout: 15000 });
await phone.tap("[data-testid=reply-review] >> text=Discard");
await phone.waitForSelector("text=Recording deleted. Nothing was sent.", { timeout: 10000 });
ok("Discard deletes it and says nothing was sent", (await waitFor(async () => (await mediaReplies()) === 0, 5000)) === true);
await phone.tap("role=tab[name='Video']");
await phone.tap("button:has-text('Record video reply'):not([disabled])", { timeout: 15000 });
await phone.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await phone.waitForTimeout(2500);
await phone.tap("button:has-text('Stop recording')");
await phone.tap("button:has-text('Send video reply')");
await phone.waitForSelector("[data-testid=reply-sent]", { timeout: 30000 });
const sentText = await phone.textContent("[data-testid=reply-sent]");
ok("Sent: says who sees it and that they're emailed", sentText.includes("Sent") && sentText.includes("Business A can see it now"), sentText);
ok("Sent: stays on the Video tab", (await phone.getAttribute("role=tab[name='Video']", "aria-selected")) === "true");
ok("video reply in the conversation", !!(await phone.waitForSelector("[data-testid=conversation] ul video", { timeout: 20000 }).catch(() => null)));

// Deleting your own reply removes it for everyone.
phone.once("dialog", (d) => d.accept());
await phone.tap("[data-testid=conversation] li:has-text('Hello from Client A') >> [data-testid=reply-delete]");
await phone.waitForSelector("[data-testid=conversation] >> text=Hello from Client A", { state: "detached", timeout: 10000 });
ok("own reply deleted from the server", (await prisma.reply.count({ where: { videoId, kind: "TEXT" } })) === 0);
const sentVideo = await prisma.reply.findFirst({ where: { videoId, kind: "VIDEO" }, include: { media: true } });
phone.once("dialog", (d) => d.accept());
await phone.tap("[data-testid=conversation] li[data-mine]:has(video) >> [data-testid=reply-delete]");
await waitFor(async () => (await prisma.reply.count({ where: { videoId, kind: "VIDEO" } })) === 0, 10000);
ok("video reply deleted, recording row and all", !(await prisma.video.findUnique({ where: { id: sentVideo.mediaId } })) && (await prisma.reply.count({ where: { videoId } })) === 0);
await phone.tap("[data-testid=chat-close]");

// A reply cut short by a closed browser is never sent by itself: the client is asked.
await phone.tap("[data-testid=chat-open]");
await phone.waitForSelector("[data-testid=conversation][data-sheet]");
await phone.tap("role=tab[name='Video']");
await phone.tap("button:has-text('Record video reply'):not([disabled])", { timeout: 15000 });
await phone.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await phone.waitForTimeout(4500);
await phone.close({ runBeforeUnload: false });
const phone2 = await phoneCtx.newPage();
await phone2.goto(`${BASE}/v/${videoId}`);
await phone2.waitForSelector("[data-testid=held-reply]", { state: "attached", timeout: 30000 });
const heldRow = await prisma.reply.findFirst({ where: { videoId, kind: "VIDEO" } });
ok("recovered reply: uploaded but held, not sent", !!heldRow?.heldAt);
await phone2.tap("[data-testid=chat-open]");
ok("recovered reply: asks to send or delete, with a preview", (await phone2.textContent("[data-testid=held-reply]")).includes("Send or delete your unfinished reply?") && !!(await phone2.waitForSelector("[data-testid=held-reply] video", { timeout: 20000 }).catch(() => null)));
await owner.reload();
await owner.waitForSelector("[data-testid=conversation]", { timeout: 20000 });
await owner.waitForTimeout(1500);
ok("the business never sees an unsent reply", (await owner.locator("aside ul video").count()) === 0 && (await owner.locator("[data-testid=held-reply]").count()) === 0);
const expiry = await phone2.textContent("[data-testid=held-reply-expiry]");
ok("recovered reply: says it's deleted after 7 days, with the date", expiry.includes("deleted after 7 days") && /goes on \w+ \d+, \d{4}/.test(expiry));
// The daily clean-up leaves an unsent reply alone until its 7 days are up, then deletes it with its recording.
const dailyPurge = () => phone2.request.get(`${BASE}/api/cron/purge`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? "test-cron-secret"}` } });
await prisma.reply.update({ where: { id: heldRow.id }, data: { heldAt: new Date(Date.now() - 6 * 86_400_000) } });
const sixDays = await (await dailyPurge()).json();
ok("clean-up: a 6-day-old unsent reply stays", typeof sixDays.unsentReplies === "number" && !!(await prisma.reply.findUnique({ where: { id: heldRow.id } })));
phone2.once("dialog", (d) => d.accept());
await phone2.tap("[data-testid=held-reply] >> button:has-text('Delete it')");
await phone2.waitForSelector("[data-testid=held-reply]", { state: "detached", timeout: 10000 });
ok("recovered reply deleted when asked", (await prisma.reply.count({ where: { videoId } })) === 0);
const sentReply = await prisma.reply.create({ data: { videoId, kind: "TEXT", body: "x", authorName: "Client A", byClient: true, createdAt: new Date(Date.now() - 9 * 86_400_000) } });
const oldHeld = await prisma.reply.create({ data: { videoId, kind: "TEXT", body: "x", authorName: "Client A", byClient: true, heldAt: new Date(Date.now() - 8 * 86_400_000) } });
const newHeld = await prisma.reply.create({ data: { videoId, kind: "TEXT", body: "x", authorName: "Client A", byClient: true, heldAt: new Date(Date.now() - 86_400_000) } });
const eightDays = await (await dailyPurge()).json();
ok(
  "clean-up: deletes only unsent replies older than 7 days",
  eightDays.unsentReplies >= 1 && !(await prisma.reply.findUnique({ where: { id: oldHeld.id } })) && !!(await prisma.reply.findUnique({ where: { id: newHeld.id } })) && !!(await prisma.reply.findUnique({ where: { id: sentReply.id } })),
);
await prisma.reply.deleteMany({ where: { id: { in: [sentReply.id, newHeld.id] } } });
await phone2.tap("[data-testid=chat-close]");

// ---------- Unread counts only the other side ----------
await phone2.tap("[data-testid=chat-open]");
await phone2.fill('textarea[aria-label="Reply"]', "One question");
await phone2.tap("button:has-text('Send reply')");
await phone2.waitForSelector("[data-testid=conversation] ul >> text=One question");
await phone2.tap("[data-testid=chat-close]");
const fresh = await phoneCtx.newPage();
await phone2.close();
await fresh.goto(`${BASE}/v/${videoId}`);
await fresh.waitForSelector("[data-testid=chat-inline]", { timeout: 20000 });
await fresh.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("sureframe:seen-at:")).forEach((k) => localStorage.removeItem(k)));
await fresh.reload();
await fresh.waitForSelector("[data-testid=chat-inline]", { timeout: 20000 });
await fresh.waitForTimeout(800);
ok("own messages never count as new", !(await fresh.isVisible("[data-testid=inline-unread]")));

// The business: their own messages on the right, the client's on the left, the view counted.
await owner.reload();
await owner.waitForSelector("aside ul >> text=One question", { timeout: 20000 });
ok("owner: client's message on the left", await owner.evaluate(() => {
  const li = [...document.querySelectorAll("aside ul li")].find((l) => l.textContent.includes("One question"));
  return !!li && !li.dataset.mine && getComputedStyle(li).alignItems === "flex-start";
}));
ok("owner: sees the view", /[1-9]\d* views?/.test(await owner.textContent("[data-testid=video-meta]")));
await owner.fill('textarea[aria-label="Reply"]', "Answer from Business A");
await owner.click("button:has-text('Send reply')");
await owner.waitForSelector("aside ul li[data-mine] >> text=Answer from Business A");
ok("owner: own message on the right", true);
const panelHeight = await owner.evaluate(() => document.querySelector("[data-testid=conversation]").getBoundingClientRect().height);
ok("desktop panel is tall enough for a video reply", panelHeight >= 480, String(panelHeight));
await owner.screenshot({ path: `${shots}/owner-desktop.png` });
await fresh.reload();
await fresh.waitForSelector("[data-testid=inline-unread]", { timeout: 20000 }).catch(() => null);
ok("the business's reply counts as new for the client", await fresh.isVisible("[data-testid=inline-unread]") && (await fresh.textContent("[data-testid=chat-inline]")).includes("1 new"));
await fresh.tap("[data-testid=chat-open]");
const atEnd = await fresh.waitForFunction(() => {
  const box = document.querySelector("[data-testid=conversation] ul")?.parentElement;
  return box && box.scrollHeight - box.scrollTop - box.clientHeight < 60;
}, null, { timeout: 10000 }).then(() => true, () => false);
ok("conversation opens at the newest message", atEnd);
await fresh.tap("[data-testid=chat-close]");

// The end of the video asks for a reply.
await fresh.evaluate(() => {
  const v = document.querySelector("main video");
  v.muted = true;
  v.currentTime = Math.max(0, v.duration - 0.3);
  return v.play();
});
ok("end of the video: prompt to reply to the business", await shown(fresh, "[data-testid=end-prompt]", 10000) && (await fresh.textContent("[data-testid=end-prompt]")).includes("Reply to Business A"));
await fresh.screenshot({ path: `${shots}/end-prompt-320.png`, fullPage: true });

// ---------- Can't-open pages: one plain card, never the intro ----------
const strangerCtx = await browser.newContext({ viewport: { width: 320, height: 640 } });
const stranger = await strangerCtx.newPage();
await stranger.goto(`${BASE}/v/${videoId}`);
ok("plain address on a new device: private, explains the personal link", (await stranger.textContent("[data-testid=cant-open-title]")) === "This video is private" && (await stranger.textContent("[data-testid=video-private]")).includes("personal link"));
ok("…with only a small 'Are you the business? Sign in'", await stranger.isVisible("text=Are you the business?"));
ok("…and no intro", !(await shown(stranger, "[data-testid=sureframe-promo]", 2000)));
ok("can't-open page fits 320px", await fits(stranger));
await stranger.screenshot({ path: `${shots}/private-320.png`, fullPage: true });
await stranger.goto(`${BASE}/c/not-a-real-token-${Date.now()}`);
ok("mistyped link: says it doesn't look right", (await stranger.textContent("[data-testid=cant-open-title]")) === "This link doesn't look right" && !(await stranger.textContent("body")).includes("no longer active"));
await stranger.screenshot({ path: `${shots}/bad-link-320.png`, fullPage: true });
// The link without its #k= part (as in an email) on a new device.
await stranger.goto(link.split("#")[0]);
await stranger.waitForSelector("[data-testid=lost-key]", { timeout: 20000 });
ok("no key on this device: says what to do", (await stranger.textContent("[data-testid=lost-key]")).includes("Open your personal link on this device once"));
ok("no key: no intro over it", !(await shown(stranger, "[data-testid=sureframe-promo]", 2000)));
await stranger.click("text=Ask for my link again");
ok("Ask again: says who was asked and what happens next", (await stranger.textContent("[data-testid=lost-key-asked]", { timeout: 10000 }).catch(() => "")).includes("emailed Business A"));
await stranger.screenshot({ path: `${shots}/lost-key-320.png`, fullPage: true });

// ---------- All my videos ----------
await fresh.goto(BASE + "/inbox");
await fresh.waitForSelector("[data-testid=inbox-video]");
ok("inbox: replied marker", await fresh.isVisible("[data-testid=inbox-replied]"));
ok("inbox: watched, so not marked new", !(await fresh.isVisible("[data-testid=inbox-new]")));
const emails = await fresh.textContent("[data-testid=inbox-emails]");
ok("inbox: email address not shown in full", emails.includes("c•••@example.com") && !emails.includes("clienta@"), emails);
ok("inbox fits 320px", await fits(fresh));
await fresh.screenshot({ path: `${shots}/inbox-320.png`, fullPage: true });
await prisma.client.update({ where: { id: clientRow.id }, data: { remindersOff: true } });
await fresh.reload();
await fresh.click("[data-testid=inbox-emails] >> text=Turn on");
await fresh.waitForSelector("[data-testid=emails-on]", { timeout: 10000 });
ok("Turn on: one tap, a clear confirmation", (await fresh.textContent("h1")) === "Emails turned back on" && !(await prisma.client.findUnique({ where: { id: clientRow.id } })).remindersOff);
ok("emails page: the logo leads to the client's videos, not the marketing site", (await fresh.getAttribute("header a", "href")) === "/inbox");
await fresh.screenshot({ path: `${shots}/emails-on-320.png`, fullPage: true });
await fresh.goto(BASE + "/inbox");
await fresh.waitForSelector("[data-testid=forget-device]");
fresh.once("dialog", (d) => d.accept());
await fresh.click("[data-testid=forget-device]");
await fresh.waitForSelector("[data-testid=inbox-empty]", { timeout: 10000 });
ok("Remove from this device: forgets the link and key here", !(await phoneCtx.cookies()).some((c) => c.name.startsWith("fc_client_")) && (await fresh.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("framecast.key.client:")))) === false);

// ---------- Team: a staff-style dead end is accurate, not "sign in" ----------
const other = `fxother${Date.now()}@example.com`;
const otherPage = await (await browser.newContext()).newPage();
await otherPage.goto(BASE + "/login");
await agreed(other);
await otherPage.fill('input[name="email"]', other);
await otherPage.click("text=Continue");
await otherPage.waitForURL((u) => !u.pathname.startsWith("/login"));
await otherPage.goto(`${BASE}/v/${videoId}`);
ok("signed in elsewhere: says it isn't in their account, no sign-in button", (await otherPage.textContent("[data-testid=video-private]")).includes("isn't in your account") && !(await otherPage.isVisible("text=Are you the business?")));

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
