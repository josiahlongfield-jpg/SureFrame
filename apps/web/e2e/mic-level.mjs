// The microphone level bar on the recorder: it shows the fake microphone's
// beeps as "working", and warns when the microphone only gives silence.
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
  if (!pass) failed++;
};

/** A few seconds of silent 16-bit mono WAV, for a microphone that hears nothing. */
function silentWav(path, seconds = 10, rate = 16000) {
  const data = rate * seconds * 2;
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0); b.writeUInt32LE(36 + data, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(data, 40);
  writeFileSync(path, b);
}

async function open(extraArgs) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? undefined,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", ...extraArgs],
  });
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1360, height: 900 } });
  // Keep hold of every microphone track, so a test can "switch the mic off".
  await ctx.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__tracks = [];
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await real(c);
      window.__tracks.push(...s.getAudioTracks());
      return s;
    };
  });
  const page = await ctx.newPage();
  await page.goto(BASE + "/record");
  const loginEmail = `mic${Date.now()}@acme.com`;
  await agreed(loginEmail);
  await page.fill('input[name="email"]', loginEmail);
  await page.click("text=Continue");
  await page.waitForURL("**/record");
  await page.click("text=I've saved it");
  return { browser, page };
}

// 1) A working microphone (Chromium's fake device beeps).
{
  const { browser, page } = await open([]);
  await page.waitForSelector("[data-testid=mic-level][data-state=hearing]", { timeout: 15000 });
  ok("working mic: says it's picking up sound", await page.isVisible("text=/Picking up sound/"));
  ok("names the microphone in use", (await page.textContent("[data-testid=mic-in-use]")).startsWith("Listening to: "));
  ok("never just says 'working'", !(await page.isVisible("text=/microphone is working/i")));
  // V73: the browser's own "default" (and "communications") entry is the same microphone again, so it isn't listed
  // twice; "Default microphone" is that choice.
  const listed = await page.locator("label:has(span:text-is('Microphone')) select option").evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent })));
  const browserMics = await page.evaluate(async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput").map((d) => d.deviceId));
  ok("mic list: the browser's default entry isn't listed again", browserMics.includes("default") && !listed.some((o) => o.v === "default" || o.v === "communications"), JSON.stringify({ listed, browserMics }));
  ok("mic list: Default microphone first, then each microphone once", listed[0]?.v === "" && listed[0]?.t === "Default microphone" && listed.length === browserMics.filter((id) => id !== "default" && id !== "communications").length + 1, JSON.stringify(listed));
  const width = await page.$eval("[data-testid=mic-level] div div", (el) => parseFloat(el.style.width) || 0);
  ok("working mic: bar moves", width > 0, `${width}`);
  await page.screenshot({ path: `${shots}/mic-level.png` });
  // Switching the microphone off (the track ends) shows that it stopped.
  await page.evaluate(() => window.__tracks.filter((t) => t.readyState === "live").forEach((t) => { t.stop(); t.dispatchEvent(new Event("ended")); }));
  await page.waitForSelector("[data-testid=mic-level][data-state=stopped]", { timeout: 5000 }).catch(() => {});
  ok("mic switched off: says it stopped", (await page.getAttribute("[data-testid=mic-level]", "data-state")) === "stopped");
  await page.click("text=Camera only");
  await page.click("text=Start recording");
  await page.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
  ok("bar is gone while recording", (await page.locator("[data-testid=mic-level]").count()) === 0);
  await browser.close();
}

// 2) A microphone that only gives silence.
{
  const wav = "/tmp/claude-0/silence.wav";
  silentWav(wav);
  const { browser, page } = await open([`--use-file-for-fake-audio-capture=${wav}`]);
  await page.waitForSelector("[data-testid=mic-level][data-state=listening]", { timeout: 15000 });
  await page.waitForSelector("[data-testid=mic-level][data-state=quiet]", { timeout: 15000 });
  ok("silent mic: warns it can't hear anything", await page.isVisible("text=/We can't hear anything yet/"));
  await page.screenshot({ path: `${shots}/mic-quiet.png` });
  await browser.close();
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
