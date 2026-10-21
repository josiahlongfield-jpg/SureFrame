// SureFrame extension: runs on sureframe.app only, and passes messages between the SureFrame recorder page and
// the extension. The page talks to it with window.postMessage({ sureframe: "to-extension", ... }) and hears back
// { sureframe: "from-extension", ... }. Nothing here touches the recording itself.
(() => {
  // Already running here and still connected (the extension adds itself to open tabs when installed or updated).
  if (window.__sureframeBridge?.alive()) return;
  window.__sureframeBridge?.();
  const TO = "to-extension";
  const FROM = "from-extension";
  let alive = true;
  let me = null;
  /** The recording this tab is running, as last told by the page. */
  let current = null;

  const send = (msg) => window.postMessage({ sureframe: FROM, ...msg }, location.origin);
  const ok = () => {
    // After an update or removal this copy is cut off from the extension: it steps aside quietly.
    if (alive && chrome.runtime?.id) return true;
    stop();
    return false;
  };
  const session = chrome.storage.session;

  async function whoami() {
    if (!me) me = await chrome.runtime.sendMessage({ type: "whoami" }).catch(() => null);
    return me;
  }

  /** Writes the recording for the bubbles to show. The page sends it again with every saved piece, as a heartbeat. */
  async function publish(rec) {
    const tab = await whoami();
    if (!tab || !ok()) return;
    current = rec;
    await session.set({ rec: { ...rec, tabId: tab.tabId, windowId: tab.windowId, beat: Date.now() } }).catch(async () => {
      // The worker hadn't opened session storage to pages yet: waking it does, then try again.
      await chrome.runtime.sendMessage({ type: "whoami" }).catch(() => {});
      await session.set({ rec: { ...rec, tabId: tab.tabId, windowId: tab.windowId, beat: Date.now() } }).catch(() => {});
    });
  }

  async function end() {
    current = null;
    if (!ok()) return;
    const { rec } = await session.get("rec").catch(() => ({}));
    const tab = await whoami();
    // Only this tab's own recording.
    if (rec && tab && rec.tabId === tab.tabId) await session.remove(["rec", "cmd"]).catch(() => {});
  }

  /**
   * The worker telling this tab whether the bubble is on screen (if not, the page draws the camera into the video).
   * Pushed on every change rather than asked for: a tab in the background has its timers slowed right down.
   */
  function onWorker(msg) {
    if (!ok() || msg?.type !== "health" || !current || msg.id !== current.id) return;
    send({ type: "health", id: msg.id, onScreen: msg.onScreen, anywhere: msg.anywhere });
  }

  function onPage(e) {
    if (e.source !== window || e.origin !== location.origin) return;
    const msg = e.data;
    if (!msg || msg.sureframe !== TO || !ok()) return;
    if (msg.type === "hello") send({ type: "hello", version: chrome.runtime.getManifest().version });
    else if (msg.type === "recording" && msg.rec?.id) void publish(msg.rec);
    else if (msg.type === "end") void end();
  }

  function onStorage(changes, area) {
    if (area !== "session" || !changes.cmd?.newValue || !ok()) return;
    const cmd = changes.cmd.newValue;
    // A button pressed on a bubble, for this tab's recording.
    if (current && cmd.id === current.id) send({ type: "command", id: cmd.id, action: cmd.action });
  }

  function stop() {
    alive = false;
    window.removeEventListener("message", onPage);
    try {
      chrome.storage.onChanged.removeListener(onStorage);
      chrome.runtime.onMessage.removeListener(onWorker);
    } catch {}
  }

  window.addEventListener("message", onPage);
  chrome.storage.onChanged.addListener(onStorage);
  chrome.runtime.onMessage.addListener(onWorker);
  window.__sureframeBridge = Object.assign(stop, { alive: () => alive && !!chrome.runtime?.id });
  // A page just loading can't be running a recording: one this tab left behind (reloaded while paused or while
  // picking what to share) would otherwise keep its frozen bubble on every website until the tab closes. Not when
  // added to a page that's already open (installed or updated mid-recording): that page may still be recording.
  if (document.readyState === "loading") void end();
  // Tells a page that's already open (the extension was just installed or updated) that it's here.
  send({ type: "hello", version: chrome.runtime.getManifest().version });
})();
