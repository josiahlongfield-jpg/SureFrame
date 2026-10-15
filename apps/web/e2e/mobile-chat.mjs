// The video page's AI section and the phone conversation sheet.
// The AI summary and transcript start collapsed to one labelled bar (team and
// client) and open on click or keyboard. On a phone-sized screen the
// conversation sits behind a floating chat bubble that opens a full-screen
// sheet (a text reply sends, Escape/Back/close shut it, the page doesn't
// scroll behind it, and it can't be closed mid-recording). On a computer
// there's no bubble and the conversation sits beside the video as before.
//
// Needs the app running with ANTHROPIC_API_KEY=test and
// ANTHROPIC_BASE_URL=http://localhost:12112 (a fake Claude is started here).
// Screenshots go to the first argument (default /tmp/claude-0/mobile-chat-shots).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { startFakeAnthropic } from "./fake-anthropic.mjs";
import { agreed } from "./agree.mjs";
import { chooseClients, sendByLink } from "./send.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp/claude-0/mobile-chat-shots";
mkdirSync(shots, { recursive: true });
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};
const prisma = new PrismaClient();
const anthropic = await startFakeAnthropic();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const perms = ["camera", "microphone", "clipboard-read", "clipboard-write"];
const SPOKEN = "Here is the plan for the kitchen";
const stub = `window.__sureframeTranscribe = async (blob, onProgress) => {
  onProgress({ stage: "transcribe", fraction: 0.5 });
  await new Promise((r) => setTimeout(r, 300));
  return { v: 1, segments: [{ start: 0, end: 2.5, text: ${JSON.stringify(SPOKEN)} }] };
};`;

// ---------- Owner on a computer: records, AI bar collapsed, makes a summary ----------
const ownerCtx = await browser.newContext({ permissions: perms, viewport: { width: 1360, height: 900 } });
await ownerCtx.addInitScript(stub);
const owner = await ownerCtx.newPage();
const email = `mobilechat${Date.now()}@acme.com`;
await owner.goto(BASE + "/record");
await agreed(email);
await owner.fill('input[name="email"]', email);
await owner.click("text=Continue");
await owner.waitForURL("**/record");
await owner.click("text=I've saved it");
// A paid plan with the AI add-on, so the team can make a summary.
await prisma.workspace.updateMany({ where: { members: { some: { user: { email } } } }, data: { plan: "SOLO", aiAssist: true } });
await owner.click("text=Camera only");
await owner.click("text=Start recording");
await owner.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await owner.waitForTimeout(3000);
await owner.click("button:has-text('Stop')");
await owner.waitForURL("**/v/**", { timeout: 30000 });
const videoId = owner.url().split("/v/")[1].split("?")[0];
for (let i = 0; i < 100 && (await prisma.video.findUnique({ where: { id: videoId } })).status === "RECORDING"; i++) await owner.waitForTimeout(200);
await owner.reload();

const toggle = "[data-testid=ai-toggle]";
await owner.waitForSelector(toggle, { timeout: 20000 });
ok("AI bar is labelled", (await owner.textContent(toggle)).includes("AI summary and transcript"));
ok("AI bar starts collapsed", (await owner.getAttribute(toggle, "aria-expanded")) === "false");
ok("AI bar hints what's inside", (await owner.textContent("[data-testid=ai-hint]")) === "Make a transcript");
ok("collapsed: the make button is out of sight", !(await owner.isVisible("text=Make transcript and summary")));
const controls = await owner.getAttribute(toggle, "aria-controls");
ok("AI bar controls its panel", !!controls && (await owner.locator(`[id="${controls}"]`).count()) === 1);
await owner.waitForTimeout(1000);
ok("doesn't open by itself", (await owner.getAttribute(toggle, "aria-expanded")) === "false");

// The conversation sits beside the video on a computer, with no chat bubble.
ok("1360px: conversation visible beside the video", await owner.isVisible("[data-testid=conversation]"));
ok("1360px: no chat bubble", !(await owner.isVisible("[data-testid=chat-bubble]")));
ok("1360px: larger-view button still there", await owner.isVisible("button[aria-label='Open conversation in a larger view']"));
const sideBySide = await owner.evaluate(() => {
  const aside = document.querySelector("[data-testid=conversation]").getBoundingClientRect();
  const video = document.querySelector("main video").getBoundingClientRect();
  return aside.left > video.right && Math.abs(aside.top - video.top) < 4;
});
ok("1360px: conversation to the right of the video", sideBySide);
await owner.screenshot({ path: `${shots}/desktop-1360-collapsed.png`, fullPage: true });

// Keyboard opens it.
await owner.focus(toggle);
await owner.keyboard.press("Enter");
ok("Enter expands the AI bar", (await owner.getAttribute(toggle, "aria-expanded")) === "true");
await owner.waitForSelector("text=Make transcript and summary", { timeout: 20000 });
await owner.click("text=Make transcript and summary");
await owner.waitForSelector("[data-testid=ai-summary]", { timeout: 30000 });
ok("summary shows once made", (await owner.textContent("[data-testid=ai-summary]")).includes(SPOKEN));
ok("hint says the summary is ready", (await owner.textContent("[data-testid=ai-hint]")) === "Summary ready");
await owner.screenshot({ path: `${shots}/desktop-1360-ai-open.png`, fullPage: true });
await owner.click(toggle);
ok("click collapses it again", (await owner.getAttribute(toggle, "aria-expanded")) === "false" && !(await owner.isVisible("[data-testid=ai-summary]")));

// Send to a client and copy their personal link.
await owner.goto(BASE + "/clients");
await owner.fill('input[aria-label="Client name"]', "Pia Phone");
await owner.click("button:has-text('Add client')");
await owner.waitForSelector("text=Pia Phone");
await owner.goto(`${BASE}/v/${videoId}`);
await sendByLink(owner, "Pia Phone");
const link = await owner.evaluate(() => navigator.clipboard.readText());
// One reply waiting for her.
await owner.fill('textarea[aria-label="Reply"]', "Have a look when you can");
await owner.click("button:has-text('Send reply')");
await owner.waitForSelector("aside ul >> text=Have a look when you can");

// ---------- Client on a 390px phone ----------
const phoneCtx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const phone = await phoneCtx.newPage();
await phone.addLocatorHandler(phone.getByTestId("sureframe-promo"), async () => {
  await phone.click("text=/^Watch your video$/", { timeout: 15000 });
});
await phone.goto(link);
await phone.waitForURL("**/v/**");
await phone.waitForSelector("main video", { timeout: 20000 });
await phone.waitForSelector(toggle, { timeout: 20000 });
ok("client: AI bar starts collapsed", (await phone.getAttribute(toggle, "aria-expanded")) === "false" && !(await phone.isVisible("[data-testid=ai-summary]")));
ok("client: hint says the summary is ready", (await phone.textContent("[data-testid=ai-hint]")) === "Summary ready");
ok("390px: conversation not stuck at the bottom of the page", !(await phone.isVisible("[data-testid=conversation]")));
const bubble = "[data-testid=chat-bubble]";
ok("390px: chat bubble shown", await phone.isVisible(bubble));
ok("390px: bubble counts the reply", (await phone.getAttribute(bubble, "aria-label")).includes("1 reply"));
ok("390px: unread dot for the new reply", await phone.isVisible("[data-testid=chat-unread]"));

// Both floating buttons fit and can be tapped at 390px.
const help = phone.locator("button:has-text('Help')");
const helpShown = (await help.count()) > 0 && (await help.isVisible());
const boxes = await phone.evaluate(() => {
  const r = (el) => el && (({ left, right, top, bottom }) => ({ left, right, top, bottom }))(el.getBoundingClientRect());
  const help = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Help");
  return { bubble: r(document.querySelector("[data-testid=chat-bubble]")), help: r(help), width: innerWidth };
});
const overlap = boxes.help && !(boxes.bubble.right <= boxes.help.left || boxes.help.right <= boxes.bubble.left || boxes.bubble.bottom <= boxes.help.top || boxes.help.bottom <= boxes.bubble.top);
ok("390px: bubble and Help don't overlap", !overlap, JSON.stringify(boxes));
ok("390px: bubble is on screen", boxes.bubble.left >= 0 && boxes.bubble.right <= boxes.width, JSON.stringify(boxes));
ok("390px: no sideways scrolling", await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await phone.screenshot({ path: `${shots}/phone-390-page.png`, fullPage: true });

await phone.tap(toggle);
await phone.waitForSelector("[data-testid=ai-summary]", { timeout: 15000 });
ok("client: tapping the AI bar shows the summary", (await phone.textContent("[data-testid=ai-summary]")).includes(SPOKEN));
await phone.screenshot({ path: `${shots}/phone-390-ai-open.png`, fullPage: true });
await phone.tap(toggle);

if (helpShown) {
  await help.tap();
  ok("390px: Help is tappable", await phone.isVisible("[role=dialog][aria-label='SureFrame help']"));
  await phone.tap("button[aria-label='Close help']");
} else console.log("note: no Help button on this page for clients");

await phone.tap(bubble);
await phone.waitForSelector("[data-testid=conversation][data-sheet]", { timeout: 5000 });
ok("bubble opens the conversation as a sheet", await phone.isVisible("[data-testid=conversation] >> text=Have a look when you can"));
ok("sheet is a modal dialog", (await phone.getAttribute("[data-testid=conversation]", "role")) === "dialog");
const sheetBox = await phone.evaluate(() => {
  const r = document.querySelector("[data-testid=conversation]").getBoundingClientRect();
  return { top: r.top, height: r.height, h: innerHeight, overflow: getComputedStyle(document.body).overflow };
});
ok("sheet fills the screen", sheetBox.top === 0 && Math.abs(sheetBox.height - sheetBox.h) <= 1, JSON.stringify(sheetBox));
ok("page behind doesn't scroll", sheetBox.overflow === "hidden");
ok("bubble hidden while open", !(await phone.isVisible(bubble)));
ok("unread cleared once seen", (await phone.locator("[data-testid=chat-unread]").count()) === 0 || !(await phone.isVisible("[data-testid=chat-unread]")));
await phone.fill('textarea[aria-label="Reply"]', "Looks good from my phone");
await phone.tap("button:has-text('Send reply')");
await phone.waitForSelector("[data-testid=conversation] ul >> text=Looks good from my phone", { timeout: 15000 });
ok("text reply sends from the sheet", true);
await phone.screenshot({ path: `${shots}/phone-390-sheet.png` });

await phone.tap("[data-testid=chat-close]");
await phone.waitForSelector("[data-testid=conversation]:not([data-sheet])", { state: "attached", timeout: 5000 });
ok("close button shuts the sheet", !(await phone.isVisible("[data-testid=conversation]")) && (await phone.isVisible(bubble)));
ok("page scrolls again", (await phone.evaluate(() => getComputedStyle(document.body).overflow)) !== "hidden");
ok("bubble now counts 2 replies", (await phone.getAttribute(bubble, "aria-label")).includes("2 replies"));
ok("still on the video page", phone.url().includes(`/v/${videoId}`));

await phone.tap(bubble);
await phone.waitForSelector("[data-testid=conversation][data-sheet]");
await phone.keyboard.press("Escape");
await phone.waitForSelector("[data-testid=conversation]:not([data-sheet])", { state: "attached", timeout: 5000 });
ok("Escape closes the sheet", true);

await phone.tap(bubble);
await phone.waitForSelector("[data-testid=conversation][data-sheet]");
await phone.goBack();
await phone.waitForSelector("[data-testid=conversation]:not([data-sheet])", { state: "attached", timeout: 5000 });
ok("Back closes the sheet and stays on the video", phone.url().includes(`/v/${videoId}`) && (await phone.isVisible("main video")));

// A voice reply in progress can't be closed away, and still sends.
await phone.tap(bubble);
await phone.waitForSelector("[data-testid=conversation][data-sheet]");
await phone.tap("role=tab[name='Voice']");
await phone.tap("button:has-text('Record voice reply')");
await phone.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await phone.tap("[data-testid=chat-close]");
await phone.waitForTimeout(300);
ok("can't close while recording", (await phone.getAttribute("[data-testid=conversation]", "data-sheet")) === "true");
ok("says why", (await phone.textContent("[data-testid=conversation] [role=alert]")).includes("still recording"));
await phone.keyboard.press("Escape");
await phone.goBack();
await phone.waitForTimeout(500);
ok("Escape and Back don't close it mid-recording either", (await phone.getAttribute("[data-testid=conversation]", "data-sheet")) === "true" && (await phone.isVisible("text=/Recording · \\d/")));
await phone.waitForTimeout(1500);
await phone.tap("button:has-text('Stop and send')");
await phone.waitForSelector("[data-testid=conversation] ul audio", { timeout: 30000 });
ok("the voice reply still sends", true);
await phone.tap("[data-testid=chat-close]");
await phone.waitForSelector("[data-testid=conversation]:not([data-sheet])", { state: "attached", timeout: 5000 });
ok("closes once sent", true);

// Closing with only the camera preview open lets go of the camera; a draft text survives.
await phone.tap(bubble);
await phone.waitForSelector("[data-testid=conversation][data-sheet]");
await phone.fill('textarea[aria-label="Reply"]', "half-written thought");
await phone.tap("[data-testid=chat-close]");
await phone.tap(bubble);
ok("a text draft survives closing the sheet", (await phone.inputValue('textarea[aria-label="Reply"]')) === "half-written thought");
await phone.tap("role=tab[name='Video']");
await phone.waitForSelector("button:has-text('Record video reply'):not([disabled])", { timeout: 15000 });
await phone.tap("[data-testid=chat-close]");
await phone.tap(bubble);
ok("closing with the camera preview open goes back to text", (await phone.getAttribute("role=tab[name='Text']", "aria-selected")) === "true");
await phone.tap("[data-testid=chat-close]");

// ---------- Team member on a phone sees the same ----------
await owner.setViewportSize({ width: 390, height: 844 });
await owner.reload();
await owner.waitForSelector(bubble, { timeout: 20000 });
ok("team on a phone: bubble shown, conversation tucked away", !(await owner.isVisible("[data-testid=conversation]")));
ok("team on a phone: AI bar collapsed", (await owner.getAttribute(toggle, "aria-expanded")) === "false");
await owner.screenshot({ path: `${shots}/phone-390-team.png`, fullPage: true });
// The team page has the Help button too (bottom-right): both fit and both open.
const teamBoxes = await owner.evaluate(() => {
  const r = (el) => el && (({ left, right, top, bottom }) => ({ left, right, top, bottom }))(el.getBoundingClientRect());
  const help = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Help");
  return { bubble: r(document.querySelector("[data-testid=chat-bubble]")), help: r(help) };
});
ok("team at 390px: Help button shown", !!teamBoxes.help);
ok(
  "team at 390px: bubble and Help side by side, not overlapping",
  !!teamBoxes.help && teamBoxes.bubble.right <= teamBoxes.help.left,
  JSON.stringify(teamBoxes),
);
await owner.click("button:has-text('Help')");
ok("team at 390px: Help opens", await owner.isVisible("[role=dialog][aria-label='SureFrame help']"));
await owner.click("button[aria-label='Close help']");
await owner.click("[data-testid=chat-bubble]");
await owner.waitForSelector("[data-testid=conversation][data-sheet]");
ok("team at 390px: bubble opens the sheet", await owner.isVisible("[data-testid=conversation] >> text=Looks good from my phone").catch(() => false) || !!(await owner.waitForSelector("[data-testid=conversation] >> text=Looks good from my phone", { timeout: 20000 }).catch(() => null)));
await owner.click("[data-testid=chat-close]");
await owner.waitForSelector("[data-testid=conversation]:not([data-sheet])", { state: "attached", timeout: 5000 });
// Widening back to a computer shows the conversation in place, no bubble.
await owner.setViewportSize({ width: 1360, height: 900 });
await owner.waitForTimeout(300);
ok("back at 1360px: conversation beside the video, no bubble", (await owner.isVisible("[data-testid=conversation]")) && !(await owner.isVisible(bubble)));
ok("1360px: replies from the phone are there", await owner.isVisible("aside ul >> text=Looks good from my phone").catch(() => false) || !!(await owner.waitForSelector("aside ul >> text=Looks good from my phone", { timeout: 20000 }).catch(() => null)));
await owner.screenshot({ path: `${shots}/desktop-1360.png`, fullPage: true });

await browser.close();
anthropic.close?.();
await prisma.$disconnect();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
