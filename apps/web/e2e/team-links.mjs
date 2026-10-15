// Links in team emails (?team=1) open the team's own view of a video, even in
// a browser that is signed out and has the client's personal link saved.
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";
import { chooseClients, sendByLink } from "./send.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const prisma = new PrismaClient();
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};
const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args });
const perms = { permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"] };
const stamp = Date.now();
const ownerEmail = `tl-owner${stamp}@example.com`;

const owner = await (await browser.newContext(perms)).newPage();
await owner.goto(`${BASE}/login?next=/record`);
await agreed(ownerEmail);
await owner.fill('input[name="email"]', ownerEmail);
await owner.click("text=Continue");
await owner.waitForURL((u) => u.pathname === "/record");
await owner.click("text=I've saved it");
const recoveryKey = await owner.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith("framecast.key.team:"))?.[1]);
await owner.goto(BASE + "/clients");
await owner.fill('input[aria-label="Client name"]', "Lee");
await owner.click("button:has-text('Add client')");
await owner.waitForSelector("a:has-text('Lee')");
const lee = await prisma.client.findFirst({ where: { name: "Lee", workspace: { members: { some: { user: { email: ownerEmail } } } } } });
await owner.goto(BASE + "/record");
await owner.click("text=Camera only");
await owner.click("text=Start recording");
await owner.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await owner.waitForTimeout(2500);
await owner.click("button:has-text('Stop')");
await owner.waitForURL("**/v/**", { timeout: 30000 });
const id = owner.url().split("/v/")[1].split("?")[0];
await sendByLink(owner, lee.name);
const link = await owner.evaluate(() => navigator.clipboard.readText());

// Another browser: signed out, but it has opened Lee's personal link (as when testing as a client).
const other = await (await browser.newContext(perms)).newPage();
await other.goto(link);
await other.waitForSelector("main video", { timeout: 30000 });
ok("plain link in that browser shows the client view", !(await other.isVisible("[data-testid=send-panel]")));

await other.goto(`${BASE}/v/${id}?team=1`);
await other.waitForURL("**/login**", { timeout: 15000 }).catch(() => {});
ok("team email link asks to sign in", new URL(other.url()).pathname === "/login", other.url());
await other.fill('input[name="email"]', ownerEmail);
await other.click("text=Continue");
await other.waitForURL((u) => u.pathname === `/v/${id}`, { timeout: 20000 }).catch(() => {});
ok("after sign-in, back on the video", new URL(other.url()).pathname === `/v/${id}`, other.url());
// New browser for the team: unlock with the recovery key, then the team view.
const unlock = await other.waitForSelector("text=Unlock your videos in this browser", { timeout: 15000 }).catch(() => null);
if (unlock && recoveryKey) {
  await other.fill("input", recoveryKey);
  await other.keyboard.press("Enter");
}
const teamView = await other.waitForSelector("[data-testid=send-panel]", { timeout: 20000 }).catch(() => null);
ok("opens the team's view (Send to box), not the client's", !!teamView);
ok("no client AI note on the team view", !(await other.isVisible("text=Your replies aren't included")));

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
