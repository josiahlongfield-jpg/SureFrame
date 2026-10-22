// SureFrame extension: the background worker.
//
// The extension never records, encrypts or uploads anything. All of that stays in the SureFrame tab, which keeps
// recording whatever happens here. The extension only shows the camera bubble and the Pause/Stop bar on web pages,
// and tells the SureFrame tab whether the bubble is on screen, so the tab can draw the camera into the video
// itself whenever it isn't (another app in front, or a page that won't allow it).
//
// State lives in chrome.storage.session (cleared when the browser closes):
//   rec  - the recording the SureFrame tab is running (written by bridge.js)
//   cmd  - a button pressed on a bubble (read by bridge.js)
// and in chrome.storage.local the bubble's place ("bubblePlace", page.js) and, for the recording it was set in, its
// size and tucked-away state ("bubbleLook", bubble.js; each new recording starts at the default size with its bar).

// Let the content scripts read and watch the session state. Runs every time this worker starts.
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => {});

const START = "https://sureframe.app/record";

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: START }));

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // Pages that were already open get the bubble without a reload.
  const tabs = await chrome.tabs.query({ url: ["https://*/*", "http://*/*"] });
  for (const tab of tabs) {
    if (tab.id === undefined || tab.discarded) continue;
    const files = /^https:\/\/sureframe\.app\//.test(tab.url ?? "") ? ["bridge.js", "page.js"] : ["page.js"];
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files }).catch(() => {});
  }
  // The camera is allowed once, on our own welcome page, so the bubble never has to ask on each website.
  if (reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});

chrome.runtime.onStartup.addListener(() => chrome.storage.session.remove(["rec", "cmd"]));

// The SureFrame tab closing ends its recording's bubbles straight away.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { rec } = await chrome.storage.session.get("rec");
  if (rec?.tabId === tabId) await chrome.storage.session.remove("rec");
});

/** When each tab's bubble last had its camera showing, by tab. */
const showing = new Map();

/**
 * Is the camera bubble on screen right now? Only if a browser window has focus (not another app) and the tab in
 * front has a bubble that showed its camera in the last moment.
 */
async function bubbleOnScreen() {
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (!win?.focused) return false;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  return !!tab && Date.now() - (showing.get(tab.id) ?? 0) < 2500;
}

/**
 * Tells the SureFrame tab whether its camera bubble is on screen. Sent on every change that could alter it (a
 * bubble reporting in, another tab or app brought to the front) and twice a second while this worker is awake.
 */
let last = "";
async function pushHealth(force = false) {
  const { rec } = await chrome.storage.session.get("rec");
  if (!rec?.tabId) return;
  const now = Date.now();
  const health = { type: "health", id: rec.id, onScreen: await bubbleOnScreen(), anywhere: [...showing.values()].some((t) => now - t < 2500) };
  const key = JSON.stringify(health);
  if (!force && key === last) return;
  last = key;
  chrome.tabs.sendMessage(rec.tabId, health).catch(() => {});
}
setInterval(() => void pushHealth(true), 500);
chrome.windows.onFocusChanged.addListener(() => void pushHealth());
chrome.tabs.onActivated.addListener(() => void pushHealth());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.rec?.newValue && !changes.rec.oldValue) void pushHealth(true);
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;
  switch (msg?.type) {
    case "whoami":
      reply({ tabId, windowId: sender.tab?.windowId });
      return;
    case "camera": {
      // A bubble reporting in, about once a second while its page is showing.
      if (tabId === undefined) return;
      const was = showing.has(tabId);
      if (msg.ok) showing.set(tabId, Date.now());
      else showing.delete(tabId);
      if (was !== !!msg.ok) void pushHealth();
      return;
    }
    case "show-recorder":
      // Stop pressed on a bubble: back to the SureFrame tab, where the finished video opens.
      void chrome.storage.session.get("rec").then(({ rec }) => {
        if (!rec?.tabId) return;
        chrome.tabs.update(rec.tabId, { active: true }).catch(() => {});
        if (rec.windowId !== undefined) chrome.windows.update(rec.windowId, { focused: true }).catch(() => {});
      });
      return;
    case "welcome":
      chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
      return;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => showing.delete(tabId));
