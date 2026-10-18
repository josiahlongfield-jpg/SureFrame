// Draws every SureFrame logo image from the one mark in src/components/LogoMark.tsx, so the favicon, phone icons,
// email mark and link previews always match the site. Usage (with the app running for the link-preview fonts):
//   BASE=http://localhost:3000 node scripts/brand-assets.mjs
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const NAVY = "#0f2747";
// The mark on navy, as in the site's top bar: white corners, light coral lock.
const DARK = { frame: "#ffffff", lock: "#ff7a6e" };
// The mark on light backgrounds: navy corners, coral lock.
const LIGHT = { frame: NAVY, lock: "#ff5d4f" };
const mark = ({ frame, lock }) =>
  `<g fill="none" stroke="${frame}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 22V13a6 6 0 0 1 6-6h9M42 7h9a6 6 0 0 1 6 6v9M57 42v9a6 6 0 0 1-6 6h-9M22 57h-9a6 6 0 0 1-6-6v-9"/></g>` +
  `<path d="M26 30v-4.5a6 6 0 0 1 12 0V30" fill="none" stroke="${lock}" stroke-width="4" stroke-linecap="round"/><rect x="21" y="29" width="22" height="17" rx="4.5" fill="${lock}"/>`;
const scaled = (tone, s) => `<g transform="translate(${32 - 32 * s} ${32 - 32 * s}) scale(${s})">${mark(tone)}</g>`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;

/** A navy rounded tile, like a phone's app icon: shows on light and dark tabs and in dark-mode mail apps. */
const tile = svg(`<rect width="64" height="64" rx="14" fill="${NAVY}"/>${scaled(DARK, 0.74)}`);
/** Square and full-bleed for app icons (the phone rounds the corners itself). */
const square = svg(`<rect width="64" height="64" fill="${NAVY}"/>${scaled(DARK, 0.62)}`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
async function png(markup, size, path, { transparent = true } = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0">${markup.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`);
  await page.screenshot({ path, omitBackground: transparent });
  await page.close();
}

writeFileSync("src/app/icon.svg", tile + "\n");
await png(tile, 256, "/tmp/sureframe-favicon-256.png");
await png(square, 180, "src/app/apple-icon.png", { transparent: false });
await png(tile, 72, "public/brand/email-mark.png");
const mobile = "../mobile/assets";
await png(square, 1024, `${mobile}/icon.png`, { transparent: false });
await png(tile, 48, `${mobile}/favicon.png`);
await png(svg(`<rect width="64" height="64" fill="${NAVY}"/>`), 512, `${mobile}/android-icon-background.png`, { transparent: false });
// Android crops the outer third of an adaptive icon, so the mark sits in the middle half.
await png(svg(scaled(DARK, 0.5)), 512, `${mobile}/android-icon-foreground.png`);
await png(svg(scaled(LIGHT, 0.5)), 1024, `${mobile}/splash-icon.png`);

// Link previews (Open Graph / Twitter): the home page's navy first screen, in the site's own font.
const base = process.env.BASE ?? "http://localhost:3000";
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(`${base}/maintenance`, { waitUntil: "networkidle" });
await page.evaluate(({ markSvg }) => {
  document.body.innerHTML = `
  <div style="position:fixed;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 96px;color:#f4f6fb;
    background:radial-gradient(1200px 700px at 85% -10%, rgb(255 111 97 / 0.16), transparent 60%), linear-gradient(180deg, #0f2747, #0b1e38)">
    <div style="display:flex;align-items:center;gap:16px;font-size:44px;letter-spacing:-0.02em">${markSvg}<span><b style="font-weight:700">Sure</b><span style="font-weight:200">Frame</span></span></div>
    <div style="margin-top:44px;font-size:86px;font-weight:600;line-height:1.02;letter-spacing:-0.04em">One take is<br><span style="color:#ff8f84">all it takes.</span></div>
    <div style="margin-top:34px;font-size:28px;color:#bcc5d8">Crash-safe. Client-ready. Private by design.</div>
  </div>`;
}, { markSvg: svg(mark(DARK)).replace("<svg ", '<svg width="56" height="56" ') });
await page.evaluate(() => document.fonts.ready);
for (const name of ["opengraph-image", "twitter-image"]) await page.screenshot({ path: `src/app/${name}.png` });
await browser.close();
// favicon.ico needs an icon writer; Pillow makes it from the 256px tile.
console.log('Done. Then: python3 -c "from PIL import Image; Image.open(\'/tmp/sureframe-favicon-256.png\').save(\'src/app/favicon.ico\', sizes=[(16,16),(32,32),(48,48),(256,256)])"');
