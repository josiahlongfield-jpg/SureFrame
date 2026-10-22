# Store listing: Chrome Web Store and Edge Add-ons

Upload `dist/sureframe-extension-store-<version>.zip`. The same answers fit both stores.

**Name:** SureFrame

**Summary (up to 132 characters):**
Your camera in a floating bubble, with Pause and Stop, on any web page while you record your screen with SureFrame.

**Category:** Productivity (Chrome: Workflow & Planning; Edge: Productivity)

**Language:** English

**Description:**

Record your screen with SureFrame and keep your camera and controls with you on every tab.

While you record your screen at sureframe.app, the SureFrame extension shows:
- your camera in a round bubble over the web pages you visit, which you can drag anywhere and make bigger or smaller with its size dial;
- a small bar with the time, Pause and Stop, so you can run your recording without going back to the SureFrame tab.

Your camera bubble appears in the video wherever you place it. Whenever the bubble can't be on screen, for example when another app is in front, SureFrame puts your camera into the video in a corner circle instead, so you still appear in it.

The extension itself doesn't record, save or send anything, and doesn't read or collect the pages you visit. Your screen recording is made by the SureFrame tab and shows only what you choose to share, encrypted on your device before it's uploaded, exactly as without the extension.

Allow your camera once on the welcome page after installing, and the bubble never has to ask again on each website.

Needs a SureFrame account (sureframe.app). Works in Chrome, Edge, Brave and other Chromium browsers on a computer.

**Single purpose:** Show the person's camera and recording controls (Pause, Stop, time) on web pages while they record their screen with SureFrame.

**Permission reasons:**
- `storage`: remembers the bubble's place, and its size and whether its controls are tucked away during a recording, and passes the recording's state (time, paused) between the SureFrame tab and the bubbles. It also holds a one-off code each bubble checks, so only the extension itself can move the bubble.
- `scripting`: adds the bubble to tabs that were already open when the extension was installed or updated, without reloading them.
- Host permissions (all http and https sites): the bubble and controls have to appear on whatever web page the person is on while recording. The extension never reads page content.
- Remote code: none. All code is in the package.

**Data use (privacy practices):** The extension does not collect or transmit any user data. Tick none of the data types. Certify: not sold, not used for unrelated purposes, not used for creditworthiness.

**Privacy policy URL:** https://sureframe.app/legal/privacy#extension

**Homepage URL:** https://sureframe.app · **Support URL:** https://sureframe.app/help

**Images:** icon 128×128 (`icons/128.png`); screenshots 1280×800 (`store/`); small promo tile 440×280 (`store/promo-440x280.png`).

After both stores approve it, put their ids in the site's `EXTENSION_IDS` and the Chrome Web Store page in `NEXT_PUBLIC_EXTENSION_URL` (see README).
