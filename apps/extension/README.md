# SureFrame browser extension

For Chrome, Edge, Brave, Arc and other Chromium browsers. While someone records their screen on sureframe.app, it shows:

- their camera in a round bubble on every web page, which they can drag anywhere and resize from its corner grip;
- a bar with the time, Pause/Resume and Stop, which they can tuck away.

The extension never records, saves or sends anything. The SureFrame tab does all of that, exactly as it does
without the extension. On a screen recording the bubble on the screen is the camera in the video. Whenever the
bubble isn't on screen (another app in front, or a page where the browser won't allow extensions or cameras), the
SureFrame tab draws the camera into the video as a corner circle instead. It does the same if the extension stops
answering (`lib/recorder/compose.ts`).

## How it fits together

| File | Runs | Does |
| --- | --- | --- |
| `src/bridge.js` | on sureframe.app | passes messages between the recorder page (`apps/web/src/lib/recorder/extension.ts`) and the extension |
| `src/page.js` | on every web page | adds and places the bubble's frame while a recording is on |
| `src/bubble.html`, `bubble.js` | inside that frame | the camera, the bar, dragging and resizing |
| `src/background.js` | the extension's worker | tells the SureFrame tab whether the bubble is on screen, opens the welcome page |
| `src/welcome.html` | once, on install | asks for the camera for the extension itself, so websites never ask |

## Building

`node build.mjs` writes `dist/`:

- `dist/store` and its zip: upload this zip to the Chrome Web Store and to Edge Add-ons.
- `dist/unpacked` and its zip: load it by hand (`chrome://extensions`, Developer mode, Load unpacked). It has the
  fixed id `ojanfkhiedeaimfopnodgkhjgkdapmnb`, which the site already allows (`apps/web/next.config.ts`).
- `dist/test`: also runs on localhost, used by `apps/web/e2e/extension.mjs`.

Once the stores give the extension its ids, add them to the site's `EXTENSION_IDS` setting (comma separated), so
the bubble can show its camera on sureframe.app's own pages too. Set `NEXT_PUBLIC_EXTENSION_URL` to the store page
to show the recorder's "Get the extension" link.

Change `version` in `src/manifest.json` for every store upload.
