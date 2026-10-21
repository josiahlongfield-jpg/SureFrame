// Builds the SureFrame browser extension (Chrome, Edge, Brave, Arc and other Chromium browsers).
//   node build.mjs            -> dist/store (for the Chrome Web Store and Edge Add-ons) and its .zip,
//                                dist/unpacked (to load by hand with a fixed id) and its .zip,
//                                dist/test (also runs on localhost, for e2e tests)
// Icons are drawn from the site's own icon (apps/web/src/app/icon.svg); needs Playwright's Chromium.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "src");
const dist = join(here, "dist");
const icons = join(here, "icons");

if (!existsSync(join(icons, "128.png"))) {
  const { chromium } = await import(join(here, "../web/node_modules/playwright/index.mjs"));
  const svg = readFileSync(join(here, "../web/src/app/icon.svg"), "utf8");
  mkdirSync(icons, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<html><body style="margin:0">${svg.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`);
    await page.screenshot({ path: join(icons, `${size}.png`), omitBackground: true });
    await page.close();
  }
  await browser.close();
}

const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));
const variants = {
  // The stores give the extension its own id, and don't accept a key.
  store: (m) => {
    delete m.key;
    return m;
  },
  unpacked: (m) => m,
  test: (m) => {
    m.content_scripts[0].matches.push("http://localhost/*");
    return m;
  },
};

rmSync(dist, { recursive: true, force: true });
for (const [name, change] of Object.entries(variants)) {
  const out = join(dist, name);
  cpSync(src, out, { recursive: true });
  cpSync(icons, join(out, "icons"), { recursive: true });
  writeFileSync(join(out, "manifest.json"), JSON.stringify(change(structuredClone(manifest)), null, 2) + "\n");
  if (name !== "test") {
    const zip = join(dist, `sureframe-extension-${name}-${manifest.version}.zip`);
    execFileSync("python3", ["-c", `import shutil,sys; shutil.make_archive(sys.argv[1][:-4], "zip", sys.argv[2])`, zip, out]);
  }
}
console.log(`Built SureFrame extension ${manifest.version} in ${dist}`);
