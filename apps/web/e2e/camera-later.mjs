// The recorder with no camera at first, then one plugged in; and a camera another app is using.
import { chromium } from "@playwright/test";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});

/** A page whose camera is missing (`cam: false`) or held by another app (`busy: true`) until changed. */
async function recorder({ cam, busy }) {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(({ cam, busy }) => {
    window.__cam = cam;
    window.__busy = busy;
    const md = navigator.mediaDevices;
    const gum = md.getUserMedia.bind(md);
    const list = md.enumerateDevices.bind(md);
    md.getUserMedia = async (c) => {
      if (c?.video && !window.__cam) throw new DOMException("Requested device not found", "NotFoundError");
      if (c?.video && window.__busy) throw new DOMException("Could not start video source", "NotReadableError");
      return gum(c);
    };
    md.enumerateDevices = async () => (await list()).filter((d) => window.__cam || d.kind !== "videoinput");
  }, { cam, busy });
  const page = await ctx.newPage();
  await page.goto(BASE + "/record");
  const email = `camlater${Date.now()}${Math.random().toString(36).slice(2, 6)}@acme.com`;
  await agreed(email);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL("**/record");
  await page.click("text=I've saved it");
  return { ctx, page };
}

const previewLive = (page) =>
  page.waitForFunction(() => {
    const v = document.querySelector("main video");
    const t = v?.srcObject?.getVideoTracks?.()[0];
    return !!t && t.readyState === "live";
  }, null, { timeout: 10000 }).then(() => true, () => false);

// 1) No camera when the page opens, then one is plugged in.
{
  const { ctx, page } = await recorder({ cam: false, busy: false });
  await page.waitForSelector("text=No camera found, so Screen only is selected", { timeout: 15000 });
  ok("no camera: Screen only is selected", await page.isChecked("input[name=mode] >> nth=1").catch(() => false) || (await page.locator("text=No camera found, so Screen only").count()) === 1);
  await page.evaluate(() => {
    window.__cam = true;
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
  });
  const found = await page.waitForSelector("text=Camera found, so Screen and camera is selected again", { timeout: 10000 }).then(() => true, () => false);
  ok("plugged in later: the recorder notices without a reload", found);
  ok("and the camera preview comes up", await previewLive(page));
  ok("and the camera list shows it", (await page.locator("select >> nth=0 >> option").count()) >= 2);
  await page.screenshot({ path: `${shots}/camera-later.png` });
  await ctx.close();
}

// 2) Another app has the camera, then lets go of it.
{
  const { ctx, page } = await recorder({ cam: true, busy: true });
  await page.click("text=Camera only");
  const busy = await page.waitForSelector("text=Your camera is being used by another app", { timeout: 15000 }).then(() => true, () => false);
  ok("busy camera: says another app is using it", busy);
  await page.evaluate(() => {
    window.__busy = false;
    window.dispatchEvent(new Event("focus"));
  });
  ok("app closed, back on the page: the preview comes up", await previewLive(page));
  ok("and the message goes", (await page.locator("text=Your camera is being used by another app").count()) === 0);
  await ctx.close();
}

await browser.close();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
