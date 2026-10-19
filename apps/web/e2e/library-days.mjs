// The library (src/app/library/page.tsx):
// - videos are grouped into one folder per day something was recorded, newest day first,
//   the newest day open and the rest closed until clicked; a day you opened or closed stays that way
//   when you come back from a video;
// - every recording shows a real still: taken while recording (src/components/Recorder.tsx),
//   or, for one without a still yet, made in the library from the start of the recording.
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
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

const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args });
const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
const owner = await ctx.newPage();
const stamp = Date.now();
const email = `days${stamp}@example.com`;

await owner.goto(`${BASE}/login`);
await agreed(email);
await owner.fill('input[name="email"]', email);
await owner.click("text=Continue");
await owner.waitForURL((u) => u.pathname === "/library");
const ws = (await waitFor(() => prisma.membership.findFirst({ where: { user: { email } } }))).workspaceId;

// Records a few seconds; `check` runs while it's still recording.
async function record(check) {
  await owner.goto(BASE + "/record");
  await owner.waitForSelector("text=I've saved it", { timeout: 5000 }).then((b) => b.click()).catch(() => {});
  await owner.click("text=Camera only");
  await owner.click("text=Start recording");
  await owner.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
  const id = (await waitFor(() => prisma.video.findFirst({ where: { workspaceId: ws, status: "RECORDING" }, orderBy: { createdAt: "desc" } }), 10000))?.id;
  await check?.(id);
  await owner.waitForTimeout(1000);
  await owner.click("button:has-text('Stop')");
  await owner.waitForURL("**/v/**", { timeout: 30000 });
  return owner.url().split("/v/")[1].split("?")[0];
}

let stillWhileRecording = false;
const first = await record(async (id) => {
  stillWhileRecording = !!(await waitFor(() => prisma.videoThumb.findUnique({ where: { videoId: id } }), 8000));
});
ok("the still is saved while recording, before the video is opened", stillWhileRecording);
const second = await record();

// A recording from before stills (or never opened): no still saved, and one from three days ago.
await prisma.videoThumb.deleteMany({ where: { videoId: { in: [first, second] } } });
const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
await prisma.video.update({ where: { id: first }, data: { createdAt: threeDaysAgo } });

await owner.goto(BASE + "/library");
const labels = await owner.$$eval("[data-testid=day-label]", (els) => els.map((e) => e.textContent));
const expected = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(threeDaysAgo);
ok("one folder per day, newest first", labels.length === 2 && labels[0] === "Today" && labels[1] === expected, JSON.stringify(labels));
ok("each folder counts its videos", (await owner.textContent("[data-testid=day-folder] >> nth=0 >> [data-testid=day-count]")) === "1 video");
ok("the newest day starts open", !!(await owner.waitForSelector(`main a[href="/v/${second}"]`, { state: "visible", timeout: 10000 }).catch(() => null)));
ok("older days start closed", !(await owner.isVisible(`main a[href="/v/${first}"]`)));
ok("the folder shows the day's newest still", !!(await owner.waitForSelector("[data-testid=day-folder] >> nth=0 >> summary [data-testid=library-thumb]", { timeout: 30000 }).catch(() => null)));
ok("the missing still is made in the library and saved", !!(await waitFor(() => prisma.videoThumb.findUnique({ where: { videoId: second } }), 15000)));
await owner.screenshot({ path: `${shots}/library-days-closed.png`, fullPage: true });

await owner.click("[data-testid=day-folder] >> nth=1 >> summary");
ok("clicking a folder shows that day's videos", await owner.isVisible(`main a[href="/v/${first}"]`));
ok("an older recording without a still gets one too", !!(await owner.waitForSelector(`a[href="/v/${first}"] [data-testid=library-thumb]`, { timeout: 30000 }).catch(() => null)));
ok("both stills saved once", (await prisma.videoThumb.count({ where: { videoId: { in: [first, second] } } })) === 2);
const time = (await owner.textContent(`a[href="/v/${first}"] p`)) ?? "";
ok("inside a day, each video shows its time", /\d{1,2}:\d{2} (AM|PM)/.test(time), time);
await owner.screenshot({ path: `${shots}/library-days-open.png`, fullPage: true });

await owner.click(`a[href="/v/${first}"]`);
await owner.waitForURL(`**/v/${first}`);
// Back once the video page is on screen, as a person would (going back mid-navigation can leave Next showing the video).
await owner.waitForSelector("video", { timeout: 30000 });
await owner.goBack();
await owner.waitForURL("**/library");
ok("an opened day stays open after coming back from a video", !!(await owner.waitForSelector(`main a[href="/v/${first}"]`, { timeout: 10000 }).catch(() => null)));
await owner.waitForSelector("[data-testid=day-folder]", { timeout: 30000 });
ok("the newest day is still open too", !!(await owner.waitForSelector(`main a[href="/v/${second}"]`, { state: "visible", timeout: 10000 }).catch(() => null)));

// Closing the newest day is remembered as well.
await owner.click("[data-testid=day-folder] >> nth=0 >> summary");
await owner.reload();
await owner.waitForSelector("[data-testid=day-folder]");
await owner.waitForTimeout(500);
ok("a closed newest day stays closed", !(await owner.isVisible(`main a[href="/v/${second}"]`)) && (await owner.isVisible(`main a[href="/v/${first}"]`)));

// Phones: nothing wider than the screen.
await owner.setViewportSize({ width: 320, height: 700 });
await owner.reload();
await owner.waitForSelector(`main a[href="/v/${first}"] [data-testid=library-thumb]`, { timeout: 20000 }).catch(() => null);
const wide = await owner.evaluate(() => document.documentElement.scrollWidth);
ok("fits a 320px screen", wide <= 320, String(wide));
await owner.screenshot({ path: `${shots}/library-days-phone.png`, fullPage: true });

await browser.close();
await prisma.$disconnect();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
