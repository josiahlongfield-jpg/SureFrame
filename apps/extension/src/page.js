// SureFrame extension: on every web page. While the SureFrame tab is recording the screen it adds the camera
// bubble and the Pause/Stop bar, in their own sealed frame (bubble.html) so the page can't affect them and they
// can't affect the page. Otherwise it does nothing.
(() => {
  const ID = "sureframe-bubble-frame";
  if (window.top !== window) return;
  // Already running here and still connected (the extension adds itself to open tabs when installed or updated).
  if (window.__sureframePage?.alive()) return;
  window.__sureframePage?.();

  let alive = true;
  let frame = null;
  let port = null;
  let recId = null;
  /**
   * Where the bubble is: the middle of its bar across (cx), and its distance up from the bottom. Placed by the bar's
   * middle, the bar and dial stay put while the circle above changes size. Until the bubble's outline is first known
   * (or when kept by version 1.0.2, which stored the left edge) it goes by its left edge.
   */
  let cx = null;
  let bottom = 24;
  let leftEdge = 24;
  /** The bubble's outline, and where the bar's middle is in it (from bubble.js). */
  let box = { width: 0, height: 0, anchor: 0 };
  /** Where the bubble was last shown while held, in case its let-go never arrives. */
  let held = null;
  let told = "";
  /** While the bubble is dragged or resized its frame covers the page (see connect). */
  let full = false;
  let staleTimer = 0;
  /** This frame's name in the extension's storage, where each connection's one-off code is kept (see connect). */
  let slot = "";

  const ok = () => {
    // Cut off by an update or removal: take the bubble away and step aside.
    if (alive && chrome.runtime?.id) return true;
    stop();
    return false;
  };

  /** Session storage needs the worker to have opened it to pages; waking it does that. */
  async function readRec() {
    try {
      return (await chrome.storage.session.get("rec")).rec;
    } catch {
      await chrome.runtime.sendMessage({ type: "whoami" }).catch(() => {});
      return (await chrome.storage.session.get("rec").catch(() => ({}))).rec;
    }
  }

  /**
   * A recording that stopped saving for this long (its tab crashed or froze) loses its bubble. Paused, or still
   * picking what to share, nothing is being saved, so only the tab closing ends it then.
   */
  const fresh = (rec) => !!rec?.id && (rec.phase !== "recording" || Date.now() - (rec.beat ?? 0) < 30_000);

  const viewport = () => ({ w: document.documentElement.clientWidth || innerWidth, h: document.documentElement.clientHeight || innerHeight });

  /** Puts the frame where the bubble goes, kept on the window, and tells the bubble the window and its place. */
  function clamp() {
    if (!frame || full) return;
    const { w, h } = viewport();
    const left = Math.max(0, Math.min(cx == null ? leftEdge : cx - box.anchor, w - box.width));
    const shownBottom = Math.max(0, Math.min(bottom, h - box.height));
    frame.style.left = `${left}px`;
    frame.style.bottom = `${shownBottom}px`;
    const view = { w, h, cx, bottom };
    const key = JSON.stringify(view);
    if (port && key !== told) {
      told = key;
      port.postMessage({ view });
    }
    return { cx: left + box.anchor, bottom: shownBottom };
  }

  function mount(rec) {
    recId = rec.id;
    if (frame?.isConnected) return;
    document.getElementById(ID)?.remove();
    frame = document.createElement("iframe");
    frame.id = ID;
    frame.title = "SureFrame camera and recording controls";
    // The camera is allowed for the extension once (welcome page); "*" because the frame's address is a
    // one-off alias of the extension's own.
    frame.setAttribute("allow", "camera *");
    frame.setAttribute("scrolling", "no");
    // Fixed, above everything, and see-through around the circle (the colour scheme must match for that).
    frame.style.cssText =
      "all:initial;position:fixed;z-index:2147483647;border:0;margin:0;padding:0;width:0;height:0;display:block;" +
      "background:transparent;color-scheme:light;overflow:hidden;visibility:visible;opacity:1;pointer-events:auto";
    frame.addEventListener("load", connect);
    // A frame the page took away leaves its code behind: clear it before naming the new one.
    if (slot) void chrome.storage.session.remove(`bubble:${slot}`).catch(() => {});
    slot = crypto.randomUUID();
    frame.setAttribute("src", `${chrome.runtime.getURL("bubble.html")}#${slot}`);
    document.documentElement.append(frame);
    clamp();
    clearInterval(staleTimer);
    staleTimer = setInterval(check, 2000);
  }

  function unmount() {
    recId = null;
    clearInterval(staleTimer);
    port?.close();
    port = null;
    frame?.remove();
    frame = null;
    if (slot) void chrome.storage.session.remove(`bubble:${slot}`).catch(() => {});
    slot = "";
  }

  async function check() {
    if (!ok()) return;
    // Something on the page removed it: put it back.
    if (frame && !frame.isConnected) {
      frame = null;
      const rec = await readRec();
      if (fresh(rec)) mount(rec);
      return;
    }
    const rec = await readRec();
    if (!fresh(rec)) unmount();
  }

  /**
   * Hands the bubble its private channel. The web page can post to the bubble's frame as well, so the bubble only
   * takes a channel that comes with this one-off code, kept where web pages can't read it (B20).
   */
  async function connect() {
    const target = frame;
    const key = `bubble:${slot}`;
    const nonce = crypto.randomUUID();
    try {
      await chrome.storage.session.set({ [key]: nonce });
    } catch {
      // Session storage needs the worker to have opened it to pages; waking it does that.
      await chrome.runtime.sendMessage({ type: "whoami" }).catch(() => {});
      if (!(await chrome.storage.session.set({ [key]: nonce }).then(() => true, () => false))) return;
    }
    // Taken away, or loaded again, meanwhile.
    if (!target || target !== frame || !ok()) return;
    const channel = new MessageChannel();
    port?.close();
    port = channel.port1;
    port.onmessage = (e) => {
      const m = e.data;
      if (!m || !frame) return;
      if (m.at) {
        held = m.at;
      } else if (m.pin) {
        if (cx == null && !full) {
          const shown = clamp();
          if (shown) {
            cx = shown.cx;
            void chrome.storage.local.set({ bubblePlace: { cx, bottom } }).catch(() => {});
          }
        }
      } else if (m.box) {
        const next = { width: Math.ceil(m.box.width), height: Math.ceil(m.box.height), anchor: m.box.anchor ?? m.box.width / 2 };
        const { w, h } = viewport();
        // The bubble is never as big as the whole window: an outline that size can only be left over from a gesture
        // that went wrong, so the gesture is ended and the frame keeps its last real size.
        if (next.width >= w && next.height >= h) {
          port.postMessage({ cancel: true });
          if (full) settle(held);
          return;
        }
        box = next;
        // The bubble only reports its outline when it isn't being held: covering the page now would be a let-go
        // that never arrived (released outside the window), so the frame shrinks back around the bubble.
        if (full) return settle(held);
        fit();
        clamp();
      } else if (m.drag === "start") {
        // Dragging or resizing: the (see-through) frame covers the page meanwhile, and the bubble moves inside it.
        // Moving the frame itself under the pointer would make it lag, as positions inside a moving frame do.
        // Already covering the page means the last let-go never came: carry on from where the bubble was last shown.
        if (full && held) settle(held);
        const at = clamp() ?? { cx: cx ?? leftEdge + box.anchor, bottom };
        full = true;
        held = at;
        const { w, h } = viewport();
        frame.style.left = frame.style.bottom = "0px";
        frame.style.width = `${w}px`;
        frame.style.height = `${h}px`;
        port.postMessage({ full: at, height: h });
      } else if (m.drag === "end") {
        settle(Number.isFinite(m.cx) && Number.isFinite(m.bottom) ? { cx: m.cx, bottom: m.bottom } : held);
      }
    };
    frame.contentWindow?.postMessage({ sureframe: "port", nonce }, "*", [channel.port2]);
    told = "";
  }

  /** The frame around the bubble, never bigger than the window. */
  function fit() {
    const { w, h } = viewport();
    frame.style.width = `${Math.min(box.width, w)}px`;
    frame.style.height = `${Math.min(box.height, h)}px`;
  }

  /** Let go: the frame shrinks back around the bubble where it now is, and every other tab's bubble goes there too. */
  function settle(at) {
    full = false;
    held = null;
    if (at && Number.isFinite(at.cx) && Number.isFinite(at.bottom)) {
      cx = at.cx;
      bottom = at.bottom;
    }
    fit();
    clamp();
    // Written whole, never merged with what's stored: the bubble's size is kept under its own name by bubble.js, so a
    // move and a resize ending together can't undo each other.
    if (cx != null) void chrome.storage.local.set({ bubblePlace: { cx, bottom } }).catch(() => {});
  }

  function takePlace(b) {
    if (!b || !Number.isFinite(b.bottom)) return;
    if (Number.isFinite(b.cx)) cx = b.cx;
    else if (Number.isFinite(b.left)) {
      cx = null;
      leftEdge = b.left;
    } else return;
    bottom = b.bottom;
  }

  async function load() {
    // "bubble" is where 1.0.0 kept it.
    const { bubblePlace, bubble } = await chrome.storage.local.get(["bubblePlace", "bubble"]).catch(() => ({}));
    takePlace(bubblePlace ?? bubble);
    const rec = await readRec();
    if (fresh(rec)) mount(rec);
  }

  function onStorage(changes, area) {
    if (!ok()) return;
    if (area === "session" && changes.rec) {
      const rec = changes.rec.newValue;
      if (fresh(rec)) mount(rec);
      else unmount();
    }
    if (area === "local" && changes.bubblePlace?.newValue) {
      takePlace(changes.bubblePlace.newValue);
      clamp();
    }
  }

  const onResize = () => clamp();

  // Leaving the tab mid-gesture: its let-go can't be heard from there, so the frame goes back around the bubble now.
  const onHidden = () => {
    if (document.visibilityState !== "hidden" || !full || !frame) return;
    port?.postMessage({ cancel: true });
    settle(held);
  };

  function stop() {
    alive = false;
    unmount();
    removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onHidden);
    try {
      chrome.storage.onChanged.removeListener(onStorage);
    } catch {}
  }

  chrome.storage.onChanged.addListener(onStorage);
  addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onHidden);
  window.__sureframePage = Object.assign(stop, { alive: () => alive && !!chrome.runtime?.id });
  void load();
})();
