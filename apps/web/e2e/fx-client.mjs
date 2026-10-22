// The client's watch page and the conversation (src/components/WatchView.tsx, ReplyComposer.tsx):
// - the Free plan's intro names the sender, shows once per device per business, can be skipped after a
//   few seconds, starts the video, and never covers a page that can't open;
// - video and voice replies are reviewed before sending (Send, Re-record, Discard), one cut short by a
//   closed browser is never sent by itself (and is deleted after 7 days unsent, which both screens say),
//   and anyone can delete their own replies (file included);
// - unread counts only the other side's messages; own messages sit on the right; the panel names who
//   the conversation is with; clients don't see a view count, and a client opening the video counts;
// - one reaction at a time, which says it reached the business, toggles and never doubles up (and fits one
//   row at 320px); the team's own row says whose it is; the business's message (encrypted) shows above the video;
// - deleting a reply or unsent reply, discarding a recording and "Remove from this device" ask in the page,
//   with wording true to who's affected; a text reply says Sent; Enter sends only on a computer (each says which in a hint);
//   keyboard focus follows Record / Stop / Send / Discard / Delete; Escape closes the larger view;
// - one plain "can't open" card for every dead end (a replaced link says so, the private page can ask for the
//   link again, an unknown /v/ address stays in the client frame); a device without the key lists nothing;
//   the inbox marks new and replied videos, can forget this device and turns emails back on in one tap;
//   clients never get the view count; and everything fits a 320px phone.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
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

ok("after Stop: says it's saved and what's next", (await owner.textContent("[data-testid=just-saved]")).includes("Saved. Give it a title and choose who it's for below."));

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
// Fix-first 10 (O52, O64): a title typed and left without Enter or clicking away is still saved, both after a
// pause and when the page is left straight away.
await owner.fill("textarea[aria-label='Video title']", "Week 1 plan, typed and paused");
ok("title: saved after a pause in typing, no Enter needed", !!(await waitFor(async () => (await prisma.video.findUnique({ where: { id: videoId } })).title === "Week 1 plan, typed and paused", 5000)));
await owner.fill("textarea[aria-label='Video title']", "Week 1 plan, typed then left");
await owner.goto(`${BASE}/library`);
ok("title: saved when the page is left straight after typing", !!(await waitFor(async () => (await prisma.video.findUnique({ where: { id: videoId } })).title === "Week 1 plan, typed then left", 5000)));
await owner.goto(`${BASE}/v/${videoId}`);
await owner.waitForSelector("textarea[aria-label='Video title']", { timeout: 20000 });
ok("title: the left-behind title is shown when back", (await owner.inputValue("textarea[aria-label='Video title']")) === "Week 1 plan, typed then left");
await owner.fill("textarea[aria-label='Video title']", "");
await owner.click("[data-testid=conversation-empty]");
ok("title: an emptied box goes back to the saved title, nothing blank saved", (await owner.inputValue("textarea[aria-label='Video title']")) === "Week 1 plan, typed then left" && (await prisma.video.findUnique({ where: { id: videoId } })).title === "Week 1 plan, typed then left");
ok("title: the just-saved line only shows straight after Stop", (await owner.locator("[data-testid=just-saved]").count()) === 0);
await owner.fill("textarea[aria-label='Video title']", "Week 1 plan for a long title that keeps going so it has to wrap on a small phone screen");
await owner.keyboard.press("Enter");
await waitFor(async () => (await prisma.video.findUnique({ where: { id: videoId } })).title.endsWith("small phone screen"), 5000);

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
ok("intro: can't be skipped straight away", await phone.isDisabled("[data-testid=sureframe-promo] button:has-text('Watch now')"));
ok("intro: the short wait is said in words, not a countdown on the button", /You can start watching in \d seconds?\. This short intro only shows once on this device\./.test(await phone.textContent("[data-testid=promo-wait]")) && !/\(\d\)/.test(await phone.textContent("[data-testid=sureframe-promo] button")));
ok("intro: keyboard focus starts in the card", await phone.evaluate(() => !!document.activeElement?.closest("[data-testid=sureframe-promo]")));
ok("intro fits 320px", await fits(phone));
await phone.screenshot({ path: `${shots}/intro-320.png` });
await phone.waitForSelector("button:has-text('Watch now'):not([disabled])", { timeout: 6000 });
ok("intro: skippable within a few seconds", true);
ok("intro: focus moves to Watch now once it can be pressed", (await phone.evaluate(() => document.activeElement?.textContent)) === "Watch now");
await phone.keyboard.press("Tab");
await phone.keyboard.press("Tab");
ok("intro: Tab stays inside the card", await phone.evaluate(() => !!document.activeElement?.closest("[data-testid=sureframe-promo]")));
await phone.tap("text=/^Watch now$/");
ok("intro closes", !(await phone.isVisible("[data-testid=sureframe-promo]")));
ok("Watch now starts the video", !!(await phone.waitForFunction(() => { const v = document.querySelector("main video"); return v && !v.paused && v.currentTime > 0; }, null, { timeout: 20000 }).catch(() => null)));
await phone.reload();
await phone.waitForSelector("main video", { timeout: 20000 });
ok("intro: once per device per business", !(await shown(phone, "[data-testid=sureframe-promo]", 2500)));

ok("client: the business's message above the video", (await phone.textContent("[data-testid=business-message]")).includes("Here's your plan. Start Monday."));
const meta = await phone.textContent("[data-testid=video-meta]");
ok("client: no view count", !/view/.test(meta), meta);
ok("client: the tab names the video and who it's from", (await phone.title()).startsWith("Week 1 plan") && (await phone.title()).includes("from Business A"), await phone.title());
const apiVideo = await (await phone.request.get(`${BASE}/api/videos/${videoId}`)).json();
ok("client: the video API doesn't send the view count", apiVideo.video && !("viewCount" in apiVideo.video), JSON.stringify(apiVideo).slice(0, 120));
ok("opening it counts as a view (no play needed)", (await waitFor(async () => (await prisma.video.findUnique({ where: { id: videoId } })).viewCount >= 1, 5000)) === true);
// O39: reloading (or coming back soon after) is the same view, not another one.
const viewsBefore = (await prisma.video.findUnique({ where: { id: videoId } })).viewCount;
await phone.reload();
await phone.waitForSelector("main video", { timeout: 30000 }).catch(() => {});
await phone.waitForTimeout(2000);
ok("a reload doesn't count as another view", (await prisma.video.findUnique({ where: { id: videoId } })).viewCount === viewsBefore, String(viewsBefore));
ok("client: How this works answers", (await phone.textContent("[data-testid=how-this-works]")).includes("How this works"));
await phone.click("[data-testid=how-this-works] summary");
const how = await phone.textContent("[data-testid=how-this-works]");
ok("How this works: who sees replies, notifications, deleting, devices, views", ["Only you and Business A", "emailed that you replied", "tap Delete", "another device", "how many times you've opened"].every((t) => how.includes(t)), how);
ok("How this works: there's no deadline to reply, and when replies go", how.includes("no deadline to reply") && how.includes("Written replies stay until Business A deletes this video"), how);
const purgeNote = (await phone.textContent("[data-testid=purge-note]")).trim();
ok("deletion note: one short line, the detail in How this works (C13)", /^End-to-end encrypted\. Deleted from SureFrame on \w+ \d+, \d{4}, so save a copy if you want to keep it\.$/.test(purgeNote), purgeNote);
ok("How this works: keeping a copy, and replying after the date", how.includes("Can I keep a copy?") && how.includes("You can still reply after that date."), how);
ok("How this works: no '#k=' for clients (C47)", !how.includes("#k=") && how.includes("the whole link from their message"), how);
ok("client: the page says who it's for (S17)", (await phone.textContent("[data-testid=video-for]")) === "For Client A");
ok("client: download names the business and title", (await phone.getAttribute("a:has-text('Save to device')", "download"))?.startsWith("Business A - Week 1 plan"));
ok("no floating button over the video, title or reactions", !(await phone.isVisible("[data-testid=chat-bubble]")));
ok("the reply card is in the page, right under the reactions", await phone.isVisible("[data-testid=chat-inline] >> text=Reply to Business A"));
ok("client page fits 320px", await fits(phone));
await phone.screenshot({ path: `${shots}/client-320.png`, fullPage: true });

// Reactions: one at a time, highlighted, says it reached the business; a second tap takes it back; quick taps never double up.
const rowTops = await phone.$$eval("[data-testid=reactions] button", (bs) => bs.map((b) => Math.round(b.getBoundingClientRect().top)));
ok("320px: the six reactions sit on one row", rowTops.length === 6 && new Set(rowTops).size === 1, rowTops.join(","));
ok("reactions: says who sees the one you pick", (await phone.textContent("[data-testid=reactions-label]")).includes("Business A sees the one you pick"));
const thumbs = "button[aria-label='React 👍']";
await phone.tap(thumbs);
const burstBg = await phone.waitForSelector("[data-testid=reaction-burst]", { timeout: 2000 }).then((e) => e.evaluate((el) => getComputedStyle(el).backgroundColor), () => "");
await phone.waitForFunction((s) => document.querySelector(s)?.getAttribute("aria-pressed") === "true", thumbs);
await waitFor(async () => (await prisma.reaction.count({ where: { videoId, byClient: true } })) === 1, 5000);
ok("reaction highlighted and saved once", (await prisma.reaction.count({ where: { videoId, byClient: true } })) === 1);
ok("reaction: says which it is and who can see it (C9)", (await phone.textContent("[data-testid=reaction-note]", { timeout: 5000 })) === "Your reaction: 👍. Business A can see it. Tap it again to take it back.");
// A later visit, in another tab (a second reload of this page loses the phone emulation in Playwright's Chromium).
const later = await phoneCtx.newPage();
await later.goto(`${BASE}/v/${videoId}`);
await later.waitForSelector("[data-testid=reactions]", { timeout: 20000 });
await later.waitForFunction(() => document.querySelector("[data-testid=reaction-note]")?.textContent, null, { timeout: 10000 }).catch(() => {});
const lasting = await later.textContent("[data-testid=reaction-note]");
await later.close();
ok("reaction: the same lasting line on a later visit, never a stale 'Sent.' (C9)", lasting === "Your reaction: 👍. Business A can see it. Tap it again to take it back." && !lasting.includes("Sent"), lasting);
await phone.tap("button[aria-label='React 🎉']");
await phone.waitForFunction(() => document.querySelector("button[aria-label='React 🎉']")?.getAttribute("aria-pressed") === "true" && document.querySelector("button[aria-label='React 👍']")?.getAttribute("aria-pressed") === "false");
await waitFor(async () => (await prisma.reaction.findMany({ where: { videoId, byClient: true } })).map((r) => r.emoji).join() === "🎉", 5000);
ok("picking another reaction replaces the first", (await prisma.reaction.findMany({ where: { videoId, byClient: true } })).map((r) => r.emoji).join() === "🎉");
await phone.waitForTimeout(400);
await phone.tap("button[aria-label='React 🎉']");
await waitFor(async () => (await prisma.reaction.count({ where: { videoId, byClient: true } })) === 0, 5000);
await phone.waitForTimeout(400);
await phone.tap(thumbs);
await waitFor(async () => (await prisma.reaction.count({ where: { videoId, byClient: true } })) === 1, 5000);
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
ok("phone: the hint says Enter is a new line there, not that it sends (C51)", (await phone.textContent("[data-testid=enter-hint]")) === "Enter starts a new line. Tap Send reply to send.");
await phone.fill('textarea[aria-label="Reply"]', "Hello from Client A");
await phone.press('textarea[aria-label="Reply"]', "Enter");
ok("phone: Enter makes a new line rather than sending", (await phone.inputValue('textarea[aria-label="Reply"]')) === "Hello from Client A\n" && (await prisma.reply.count({ where: { videoId } })) === 0);
await phone.fill('textarea[aria-label="Reply"]', "Hello from Client A");
await phone.tap("button:has-text('Send reply')");
await phone.waitForSelector("[data-testid=conversation] li[data-mine] >> text=Hello from Client A", { timeout: 15000 });
ok("own message on the right", true);
ok("text reply: says Sent, and who sees it", (await phone.textContent("[data-testid=text-sent]", { timeout: 5000 })).includes("Sent. Business A can see it now"));
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
ok("review: nothing in the conversation yet", (await phone.locator("[data-testid=conversation] ul [data-testid=reply-video-still]").count()) === 0);
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
ok("Discard asks first, in the page, that nobody has seen it", (await phone.textContent("[data-testid=discard-confirm]", { timeout: 5000 })).includes("never sent, so nobody else has seen it") && (await mediaReplies()) === 1);
await phone.tap("[data-testid=discard-yes]");
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
ok("video reply in the conversation", !!(await phone.waitForSelector("[data-testid=conversation] ul [data-testid=reply-video-still]", { timeout: 20000 }).catch(() => null)));

// Deleting your own reply removes it for everyone, after a question in the page (no browser pop-up).
let popups = 0;
phone.on("dialog", (d) => (popups++, d.dismiss()));
await phone.tap("[data-testid=conversation] li:has-text('Hello from Client A') >> [data-testid=reply-delete]");
ok("Delete asks in the page: removed for the business too", (await phone.textContent("[data-testid=reply-delete-confirm]", { timeout: 5000 })).includes("removed for Business A too"));
await phone.tap("[data-testid=reply-delete-confirm] >> text=Keep it");
ok("Keep it leaves the message", (await phone.locator("[data-testid=conversation] li:has-text('Hello from Client A')").count()) === 1 && (await prisma.reply.count({ where: { videoId, kind: "TEXT" } })) === 1);
await phone.tap("[data-testid=conversation] li:has-text('Hello from Client A') >> [data-testid=reply-delete]");
await phone.tap("[data-testid=reply-delete-yes]");
await phone.waitForSelector("[data-testid=conversation] >> text=Hello from Client A", { state: "detached", timeout: 10000 });
ok("own reply deleted from the server", (await prisma.reply.count({ where: { videoId, kind: "TEXT" } })) === 0);
const sentVideo = await prisma.reply.findFirst({ where: { videoId, kind: "VIDEO" }, include: { media: true } });
await phone.tap("[data-testid=conversation] li[data-mine]:has([data-testid=reply-video-chip]) >> [data-testid=reply-delete]");
await phone.tap("[data-testid=reply-delete-yes]");
await waitFor(async () => (await prisma.reply.count({ where: { videoId, kind: "VIDEO" } })) === 0, 10000);
ok("video reply deleted, recording row and all", !(await prisma.video.findUnique({ where: { id: sentVideo.mediaId } })) && (await prisma.reply.count({ where: { videoId } })) === 0);
ok("no browser pop-ups for deleting or discarding", popups === 0, String(popups));
// Escape closes the sheet and puts keyboard focus back on "Reply to …", not the top of the page (C66).
await phone.keyboard.press("Escape");
await phone.waitForSelector("[data-testid=conversation][data-sheet]", { state: "detached", timeout: 5000 });
ok("Escape: focus back on Reply to Business A (C66)", (await waitFor(() => phone.evaluate(() => document.activeElement?.dataset.testid === "chat-open"), 3000)) === true, await phone.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));

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
ok("the video page says an unsent reply is waiting", (await phone2.textContent("[data-testid=inline-unsent]", { timeout: 10000 }).catch(() => "")).includes("You have an unsent reply"));
const inboxUnsent = await phoneCtx.newPage();
await inboxUnsent.goto(`${BASE}/inbox`);
await inboxUnsent.waitForSelector("[data-testid=inbox-video]", { timeout: 20000 });
ok("inbox: the video's tile says there's an unsent reply (C33)", (await inboxUnsent.textContent(`a[href="/v/${videoId}"] [data-testid=inbox-unsent]`).catch(() => "")) === "Unsent reply");
await inboxUnsent.close();
await phone2.tap("[data-testid=chat-open]");
ok("recovered reply: asks to send or delete, with a preview", (await phone2.textContent("[data-testid=held-reply]")).includes("Send or delete your unfinished reply?") && !!(await phone2.waitForSelector("[data-testid=held-reply] [data-testid=reply-video-still]", { timeout: 20000 }).catch(() => null)));
await owner.reload();
await owner.waitForSelector("[data-testid=conversation]", { timeout: 20000 });
await owner.waitForTimeout(1500);
ok("the business never sees an unsent reply", (await owner.locator("aside ul [data-testid=reply-video-chip]").count()) === 0 && (await owner.locator("[data-testid=held-reply]").count()) === 0);
const expiry = await phone2.textContent("[data-testid=held-reply-expiry]");
ok("recovered reply: says it's deleted after 7 days, with the date", expiry.includes("deleted after 7 days") && /goes on \w+ \d+, \d{4}/.test(expiry));
// The daily clean-up leaves an unsent reply alone until its 7 days are up, then deletes it with its recording.
const dailyPurge = () => phone2.request.get(`${BASE}/api/cron/purge`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? "test-cron-secret"}` } });
await prisma.reply.update({ where: { id: heldRow.id }, data: { heldAt: new Date(Date.now() - 6 * 86_400_000) } });
const sixDays = await (await dailyPurge()).json();
ok("clean-up: a 6-day-old unsent reply stays", typeof sixDays.unsentReplies === "number" && !!(await prisma.reply.findUnique({ where: { id: heldRow.id } })));
await phone2.tap("[data-testid=held-reply] >> button:has-text('Delete it')");
const heldAsk = await phone2.textContent("[data-testid=held-delete-confirm]", { timeout: 5000 });
ok("unsent reply: Delete it says it was never sent, not 'removed for Business A too'", heldAsk.includes("never sent, so nobody else has seen it") && !heldAsk.includes("Business A too"), heldAsk);
await phone2.tap("[data-testid=held-delete-yes]");
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

// A text reply written mid-video says where ("at 0:06"), and its web address is a link (C52, C24); a to-do the
// business shared shows under the video (C61). Sealed with the client's key from the link, as the app does.
const linkKey = await globalThis.crypto.subtle.importKey("raw", Buffer.from(link.split("#k=")[1], "base64url"), { name: "AES-GCM" }, false, ["encrypt"]);
const sealFor = async (text) => {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, linkKey, new TextEncoder().encode(text)));
  return Buffer.concat([iv, ct]).toString("base64url");
};
const momentReply = await prisma.reply.create({ data: { videoId, kind: "TEXT", body: "See https://example.com/plan.", encrypted: false, timestampMs: 6000, authorName: "Client A", byClient: true } });
const sharedTodo = await prisma.item.create({ data: { kind: "TASK", body: await sealFor("Stretch every morning"), shared: true, authorName: "Owner", workspaceId: ws, clientId: clientRow.id } });
const mom = await phoneCtx.newPage();
await mom.goto(`${BASE}/v/${videoId}`);
await mom.waitForSelector("[data-testid=reply-moment]", { state: "attached", timeout: 20000 });
ok("a reply's moment is labelled 'at 0:06' (C52)", (await mom.textContent("[data-testid=reply-moment]")).trim() === "at 0:06" && (await mom.getAttribute("[data-testid=reply-moment]", "aria-label")).startsWith("Written at 0:06 in the video"));
ok("a web address in a text reply is a link, without the full stop (C24)", (await mom.getAttribute("[data-testid=reply-link]", "href")) === "https://example.com/plan" && (await mom.getAttribute("[data-testid=reply-link]", "target")) === "_blank" && (await mom.getAttribute("[data-testid=reply-link]", "rel")).includes("noopener"));
ok("a shared to-do shows under the video (C61)", !!(await mom.waitForSelector("[data-testid=planner] >> text=Stretch every morning", { timeout: 15000 }).catch(() => null)) && (await mom.textContent("[data-testid=planner] h2")) === "Your to-dos & notes from Business A");
await prisma.reply.delete({ where: { id: momentReply.id } });
await prisma.item.delete({ where: { id: sharedTodo.id } });
await mom.reload();
await mom.waitForSelector("[data-testid=chat-inline]", { timeout: 20000 });
await mom.waitForTimeout(1500);
ok("nothing shared: no to-do card under the video", (await mom.locator("[data-testid=planner]").count()) === 0);
await mom.close();

// The business: their own messages on the right, the client's on the left, the view counted.
await owner.reload();
await owner.waitForSelector("aside ul >> text=One question", { timeout: 20000 });
ok("owner: client's message on the left", await owner.evaluate(() => {
  const li = [...document.querySelectorAll("aside ul li")].find((l) => l.textContent.includes("One question"));
  return !!li && !li.dataset.mine && getComputedStyle(li).alignItems === "flex-start";
}));
ok("owner: sees the view", /[1-9]\d* views?/.test(await owner.textContent("[data-testid=video-meta]")));
ok("owner: no reaction buttons for the team", (await owner.locator("[data-testid=reactions]").count()) === 0);
ok("owner: the team can't react through the API", (await owner.request.post(owner.url().replace(/\/v\/([^/?#]+).*/, "/api/videos/$1/reactions"), { data: { emoji: "👍" } })).status() === 403);
ok("owner: the client's reaction is labelled with their name", (await owner.textContent("[data-testid=reaction-summary]")).startsWith("Client A reacted:"));
ok("computer: the reply box says Enter sends", (await owner.textContent("[data-testid=enter-hint]")) === "Enter sends. Shift+Enter starts a new line.");
await owner.focus('textarea[aria-label="Reply"]');
ok("the reply box shows a focus ring", await owner.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== "none" && parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 1));
await owner.fill('textarea[aria-label="Reply"]', "Answer from Business A");
await owner.click("button:has-text('Send reply')");
await owner.waitForSelector("aside ul li[data-mine] >> text=Answer from Business A");
ok("owner: own message on the right", true);
ok("after Send, focus is back in the reply box", await owner.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Reply"));

// Keyboard: focus follows each step of a voice reply, and the tabs move with the arrow keys.
await owner.focus("role=tab[name='Text']");
await owner.keyboard.press("ArrowRight");
await owner.keyboard.press("ArrowRight");
ok("arrow keys move between the reply tabs", (await owner.getAttribute("role=tab[name='Voice']", "aria-selected")) === "true" && (await owner.evaluate(() => document.activeElement?.textContent)) === "Voice");
await owner.waitForSelector("button:has-text('Record voice reply'):not([disabled])", { timeout: 15000 });
await owner.focus("button:has-text('Record voice reply')");
await owner.keyboard.press("Enter");
await owner.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
ok("Record: focus moves to Stop recording", (await waitFor(() => owner.evaluate(() => document.activeElement?.textContent === "Stop recording"), 3000)) === true);
// A real tap still reaches a tab that's only marked unavailable (Playwright won't click it unforced).
await owner.click("role=tab[name='Text']", { force: true });
ok("tapping another tab mid-recording says why nothing happens", (await owner.textContent("[data-testid=reply-composer] [role=status]")).includes("Stop the recording first"));
await owner.waitForTimeout(1500);
await owner.focus("button:has-text('Stop recording')");
await owner.keyboard.press("Enter");
await owner.waitForSelector("[data-testid=reply-review]", { timeout: 15000 });
ok("Stop: focus moves to Send", (await waitFor(() => owner.evaluate(() => document.activeElement?.textContent === "Send voice reply"), 3000)) === true);
await owner.click("[data-testid=reply-review] >> text=Discard");
ok("Discard: focus moves to Keep it", (await waitFor(() => owner.evaluate(() => document.activeElement?.textContent === "Keep it"), 3000)) === true);
// One question at a time (C31): asking to delete a sent message closes "Discard this reply?", and the other way round.
await owner.click("aside ul li[data-mine]:has-text('Answer from Business A') >> [data-testid=reply-delete]");
ok("one question at a time: Delete closes the Discard question", (await owner.locator("[data-testid=reply-delete-confirm]").count()) === 1 && (await owner.locator("[data-testid=discard-confirm]").count()) === 0);
await owner.click("[data-testid=reply-review] >> text=Discard");
ok("one question at a time: Discard closes the Delete question", (await owner.locator("[data-testid=discard-confirm]").count()) === 1 && (await owner.locator("[data-testid=reply-delete-confirm]").count()) === 0);
await owner.click("[data-testid=discard-yes]");
await owner.waitForSelector("text=Recording deleted. Nothing was sent.", { timeout: 10000 });
ok("Discard: focus moves to the text box", (await waitFor(() => owner.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Reply"), 3000)) === true);
await owner.click("aside ul li[data-mine]:has-text('Answer from Business A') >> [data-testid=reply-delete]");
ok("Delete: focus moves to Keep it", (await waitFor(() => owner.evaluate(() => document.activeElement?.textContent === "Keep it"), 3000)) === true);
ok("owner: Delete names the client it's removed for", (await owner.textContent("[data-testid=reply-delete-confirm]")).includes("removed for Client A too"));
await owner.keyboard.press("Enter");
ok("Keep it: focus back on Delete", (await waitFor(() => owner.evaluate(() => document.activeElement?.dataset.testid === "reply-delete"), 3000)) === true);

// The larger view closes with Escape, back to where it was opened.
await owner.click("button[aria-label='Open conversation in a larger view']");
await owner.waitForSelector("[data-testid=conversation][data-expanded]");
await owner.click("[data-testid=conversation-title]");
await owner.keyboard.press("Escape");
ok("Escape closes the larger view", await owner.waitForSelector("[data-testid=conversation][data-expanded]", { state: "detached", timeout: 3000 }).then(() => true, () => false));
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
ok("…and Ask for my link again, without naming the business", await stranger.isVisible("[data-testid=video-private] >> [data-testid=ask-link]") && !(await stranger.textContent("[data-testid=video-private]")).includes("Business A"));
await stranger.click("[data-testid=video-private] >> [data-testid=ask-link]");
ok("private page: asking says it was passed on", (await stranger.textContent("[data-testid=lost-key-asked]", { timeout: 10000 }).catch(() => "")).includes("emailed the business that sent it"));
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
ok("no key: the same heading as the private page (C60)", (await stranger.textContent("[data-testid=lost-key] [data-testid=cant-open-title]")) === "This video is private");
ok("no key: no '#k=', and a link cut short is explained (C47, C58)", !(await stranger.textContent("[data-testid=lost-key]")).includes("#k=") && (await stranger.textContent("[data-testid=lost-key]")).includes("it may have been cut short: open it again from the original message"));
ok("no key: no intro over it", !(await shown(stranger, "[data-testid=sureframe-promo]", 2000)));
ok("no key: the tab doesn't show the title", (await stranger.title()).startsWith("Private video"));
const lockedAbout = await stranger.textContent("[data-testid=lost-key-about]").catch(() => "");
ok("no key: says which video, by business and date, not title (C48)", /^A video from Business A, sent \w+ \d+, \d{4}\.$/.test(lockedAbout), lockedAbout);
ok("no key: says how the link comes back before asking (C48)", (await stranger.textContent("[data-testid=ask-link-how]")).includes("they send you the link themselves"));
await stranger.click("text=Ask for my link again");
const askedText = await stranger.textContent("[data-testid=lost-key-asked]", { timeout: 10000 }).catch(() => "");
ok("Ask again: says who was asked and what happens next", askedText.includes("emailed Business A"));
ok("and suggests looking for the link they were sent before (C48)", askedText.includes("look in your texts, chats and email for the link you were sent before"), askedText);
await stranger.screenshot({ path: `${shots}/lost-key-320.png`, fullPage: true });
// Decision 1: a device that only opened the email link lists nothing of the client's.
await stranger.goto(BASE + "/inbox");
await stranger.waitForSelector("[data-testid=inbox-keyless] [data-testid=lost-key]", { timeout: 15000 });
const keylessInbox = await stranger.textContent("main");
ok("no key: All my videos lists no titles, email or marks", !keylessInbox.includes("Week 1 plan") && !keylessInbox.includes("@example.com") && !keylessInbox.includes("•••") && (await stranger.locator("[data-testid=inbox-video], [data-testid=forget-device], [data-testid=inbox-emails]").count()) === 0, keylessInbox.slice(0, 200));
ok("no key: All my videos shows only how to get the key, with Ask for my link again", keylessInbox.includes("Your videos are private") && (await stranger.isVisible("[data-testid=inbox-keyless] >> [data-testid=ask-link]")));
ok("no key: the inbox fits 320px", await fits(stranger));
await stranger.screenshot({ path: `${shots}/inbox-keyless-320.png`, fullPage: true });
// Opening the personal link on that device then lists everything.
await stranger.goto(link.replace(/\?v=[^#]*/, ""));
await stranger.waitForSelector("[data-testid=inbox-video]", { timeout: 20000 }).catch(() => {});
ok("with the key: the same device lists the videos", (await stranger.textContent("main")).includes("Week 1 plan"));

// ---------- A link with a wrong key never wipes the key this device has (C57, C58) ----------
// One character changed in the middle of the key (the last one can be padding), and one cut short.
const goodKey = link.split("#k=")[1];
const flip = (k, i) => k.slice(0, i) + (k[i] === "A" ? "B" : "A") + k.slice(i + 1);
const misTyped = `${link.split("#k=")[0]}#k=${flip(goodKey, 10)}`;
const cutShort = `${link.split("#k=")[0]}#k=${goodKey.slice(0, 30)}`;
const savedKey = () => stranger.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith("framecast.key.client:"))?.[1] ?? null);
const keyBefore = await savedKey();
await stranger.goto(misTyped);
await stranger.waitForURL("**/v/**");
await stranger.waitForSelector("[data-testid=bad-link-note]", { timeout: 20000 });
ok("wrong key on a device with the right one: the video still opens", !!(await stranger.waitForSelector("main video", { timeout: 20000 }).catch(() => null)) && (await stranger.locator("[data-testid=lost-key], [data-testid=bad-link-key]").count()) === 0);
ok("…says the link is incomplete or mistyped and the device kept its key", (await stranger.textContent("[data-testid=bad-link-note]")).includes("incomplete or mistyped, so this device kept the key it already had"));
ok("…and the saved key is unchanged", (await savedKey()) === keyBefore && !!keyBefore);
ok("…and the key part leaves the address bar", !(await stranger.evaluate(() => location.hash)));
await stranger.goto(`${BASE}/v/${videoId}`);
ok("afterwards the plain address still opens the video", !!(await stranger.waitForSelector("main video", { timeout: 20000 }).catch(() => null)) && (await stranger.locator("[data-testid=lost-key]").count()) === 0);
await stranger.goto(`${BASE}/inbox`);
ok("…and All my videos agrees", !!(await stranger.waitForSelector("[data-testid=inbox-video]", { timeout: 20000 }).catch(() => null)) && (await stranger.locator("[data-testid=inbox-keyless]").count()) === 0);
await stranger.goto(cutShort.replace(/\?v=[^#]*/, ""));
await stranger.waitForURL("**/inbox**");
ok("a cut-short key opening the inbox: videos still listed, with the note", !!(await stranger.waitForSelector("[data-testid=bad-link-note]", { timeout: 20000 }).catch(() => null)) && (await stranger.locator("[data-testid=inbox-video]").count()) > 0 && (await savedKey()) === keyBefore);
// A device that never had the key: the wrong link says so, instead of "needs your personal link".
const newDevice = await (await browser.newContext({ viewport: { width: 320, height: 640 } })).newPage();
await newDevice.goto(misTyped);
await newDevice.waitForSelector("[data-testid=bad-link-key]", { timeout: 20000 });
ok("wrong key on a new device: 'This link is incomplete or mistyped'", (await newDevice.textContent("[data-testid=bad-link-key] [data-testid=cant-open-title]")) === "This link is incomplete or mistyped" && (await newDevice.textContent("[data-testid=bad-link-key]")).includes("Open it again from the original message"));
ok("…nothing was saved", (await newDevice.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("framecast.key.client:")))) === false);
ok("…and All my videos agrees (nothing listed)", await newDevice.goto(`${BASE}/inbox`).then(() => newDevice.waitForSelector("[data-testid=inbox-keyless]", { timeout: 20000 })).then(() => true, () => false) && (await newDevice.locator("[data-testid=inbox-video]").count()) === 0);
await newDevice.screenshot({ path: `${shots}/bad-key-320.png`, fullPage: true });
await newDevice.goto(link);
ok("the right link afterwards opens it on that device", !!(await newDevice.waitForSelector("main video", { timeout: 20000 }).catch(() => null)));
await newDevice.context().close();

// A sole trader working under their own name: "Business A", never "Business A from Business A" (D3), and the
// message above the video reads "Message from Owner, Business" rather than "from … from" (O38).
const ownerUser = await prisma.user.findUnique({ where: { email } });
await prisma.user.update({ where: { id: ownerUser.id }, data: { name: "Owner A" } });
await stranger.goto(`${BASE}/v/${videoId}`);
await stranger.waitForSelector("[data-testid=business-message]", { timeout: 20000 });
ok("message label: 'Owner A, Business A' (O38)", (await stranger.textContent("[data-testid=business-message] p")) === "Message from Owner A, Business A");
ok("byline: 'Owner A from Business A'", (await stranger.textContent("[data-testid=video-meta]")).startsWith("Owner A from Business A ·"));
await prisma.user.update({ where: { id: ownerUser.id }, data: { name: "business a" } });
await stranger.reload();
await stranger.waitForSelector("[data-testid=business-message]", { timeout: 20000 });
const soleMeta = await stranger.textContent("[data-testid=video-meta]");
ok("name = business: said once (D3)", soleMeta.startsWith("Business A ·") && !soleMeta.includes(" from "), soleMeta);
ok("name = business: message label said once (D3)", (await stranger.textContent("[data-testid=business-message] p")) === "Message from Business A");
await prisma.user.update({ where: { id: ownerUser.id }, data: { name: ownerUser.name } });

// An unknown /v/ address: the client frame and a plain card, not the marketing site.
const missing = await stranger.goto(`${BASE}/v/abc`);
ok("unknown /v/ address: a real 404", missing.status() === 404, String(missing.status()));
ok("unknown /v/ address: a can't-find card in the client frame", (await stranger.textContent("[data-testid=cant-open-title]")) === "Page not found" && (await stranger.locator("[data-testid=video-not-found]").count()) === 1 && (await stranger.locator("header >> text=All my videos").count()) === 1 && (await stranger.locator("text=Pricing").count()) === 0);
ok("unknown /v/ address: tab title says so", (await stranger.title()).startsWith("Page not found"));

// A link a key reset replaced says so (not "mistyped"), on a new device and on one that had it.
const oldToken = `fx-replaced-${Date.now()}-${"x".repeat(12)}`;
const clientB = await prisma.client.create({ data: { name: "Client B", email: "clientb@example.com", token: oldToken, workspaceId: ws, linkOpenedAt: new Date() } });
const bVideo = await prisma.video.create({ data: { id: `fxr${Date.now().toString(36)}`, mimeType: "video/webm", storageKey: `test/fx/${Date.now()}`, status: "UPLOADED", workspaceId: ws, ownerId: (await prisma.user.findUnique({ where: { email } })).id, clientId: clientB.id, title: "For Client B" } });
const bDevice = await (await browser.newContext({ viewport: { width: 320, height: 640 } })).newPage();
await bDevice.goto(`${BASE}/c/${oldToken}`);
await prisma.client.update({ where: { id: clientB.id }, data: { token: `fx-new-${Date.now()}-${"y".repeat(12)}` } });
await prisma.replacedClientLink.create({ data: { tokenHash: createHash("sha256").update(oldToken).digest("hex"), clientId: clientB.id, emailed: true } });
await stranger.goto(`${BASE}/c/${oldToken}#k=abc`);
await stranger.waitForSelector("[data-testid=client-replaced]", { timeout: 10000 });
const replacedText = await stranger.textContent("[data-testid=client-replaced]");
ok("replaced link: says it was replaced and the new one emailed", replacedText.includes("Your link was replaced") && replacedText.includes("Business A replaced your personal link") && replacedText.includes("emailed you your new link") && !replacedText.includes("mistyped"), replacedText);
ok("replaced link: the key part leaves the address bar", !(await stranger.evaluate(() => location.hash)));
await stranger.screenshot({ path: `${shots}/replaced-320.png`, fullPage: true });
await bDevice.goto(BASE + "/inbox");
ok("device with the replaced link: the inbox says why, not 'no videos'", (await bDevice.textContent("main")).includes("Your link was replaced") && !(await bDevice.isVisible("[data-testid=inbox-empty]")));
await bDevice.click("[data-testid=client-replaced] >> [data-testid=ask-link]");
ok("replaced: Ask for my link again works from the inbox", !!(await bDevice.waitForSelector("[data-testid=lost-key-asked]", { timeout: 10000 }).catch(() => null)));
await bDevice.goto(`${BASE}/v/${bVideo.id}`);
ok("device with the replaced link: the video page says the link was replaced", (await bDevice.textContent("[data-testid=cant-open-title]")) === "Your link was replaced");
await bDevice.context().close();
await prisma.video.delete({ where: { id: bVideo.id } });
await prisma.client.delete({ where: { id: clientB.id } });

// ---------- All my videos ----------
await fresh.goto(BASE + "/inbox");
await fresh.waitForSelector("[data-testid=inbox-video]");
ok("inbox: replied marker", await fresh.isVisible("[data-testid=inbox-replied]"));
ok("inbox: watched, so not marked new", !(await fresh.isVisible("[data-testid=inbox-new]")));
const emails = await fresh.textContent("[data-testid=inbox-emails]");
ok("inbox: email address not shown in full, but enough to recognise (C44)", emails.includes("cli•••@example.com") && !emails.includes("clienta@"), emails);
ok("inbox: says who the videos are for (S17)", (await fresh.textContent("[data-testid=inbox-for]")) === "For Client A");
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
await fresh.click("[data-testid=forget-device]");
ok("Remove from this device asks in the page", (await fresh.textContent("[data-testid=forget-confirm]", { timeout: 5000 })).includes("Nothing is deleted"));
await fresh.click("[data-testid=forget-confirm-yes]");
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
