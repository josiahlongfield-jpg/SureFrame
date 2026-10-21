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
  /** Where the frame sits: its left edge and its distance up from the bottom, in pixels. */
  let place = { left: 24, bottom: 24 };
  let box = { width: 0, height: 0 };
  /** While the bubble is dragged or resized its frame covers the page (see connect). */
  let full = false;
  let staleTimer = 0;

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

  function clamp() {
    if (!frame || full) return;
    const w = document.documentElement.clientWidth || innerWidth;
    const h = document.documentElement.clientHeight || innerHeight;
    const left = Math.max(0, Math.min(place.left, w - box.width));
    const bottom = Math.max(0, Math.min(place.bottom, h - box.height));
    frame.style.left = `${left}px`;
    frame.style.bottom = `${bottom}px`;
    return { left, bottom };
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
    frame.setAttribute("src", chrome.runtime.getURL("bubble.html"));
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

  function connect() {
    const channel = new MessageChannel();
    port?.close();
    port = channel.port1;
    port.onmessage = (e) => {
      const m = e.data;
      if (!m || !frame) return;
      if (m.box) {
        box = { width: Math.ceil(m.box.width), height: Math.ceil(m.box.height) };
        if (full) return;
        frame.style.width = `${box.width}px`;
        frame.style.height = `${box.height}px`;
        clamp();
      } else if (m.drag === "start") {
        // Dragging or resizing: the (see-through) frame covers the page meanwhile, and the bubble moves inside it.
        // Moving the frame itself under the pointer would make it lag, as positions inside a moving frame do.
        const at = clamp() ?? place;
        full = true;
        frame.style.left = frame.style.bottom = "0px";
        const height = document.documentElement.clientHeight || innerHeight;
        frame.style.width = `${document.documentElement.clientWidth || innerWidth}px`;
        frame.style.height = `${height}px`;
        port.postMessage({ full: at, height });
      } else if (m.drag === "end") {
        full = false;
        if (Number.isFinite(m.left) && Number.isFinite(m.bottom)) place = { left: m.left, bottom: m.bottom };
        frame.style.width = `${box.width}px`;
        frame.style.height = `${box.height}px`;
        place = clamp() ?? place;
        // Every other tab's bubble moves here too.
        void chrome.storage.local.get("bubble").then(({ bubble }) => chrome.storage.local.set({ bubble: { ...bubble, ...place } }));
      }
    };
    frame.contentWindow?.postMessage({ sureframe: "port" }, "*", [channel.port2]);
  }

  async function load() {
    const { bubble } = await chrome.storage.local.get("bubble").catch(() => ({}));
    if (bubble && Number.isFinite(bubble.left) && Number.isFinite(bubble.bottom)) place = { left: bubble.left, bottom: bubble.bottom };
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
    if (area === "local" && changes.bubble?.newValue) {
      const b = changes.bubble.newValue;
      if (Number.isFinite(b.left) && Number.isFinite(b.bottom)) {
        place = { left: b.left, bottom: b.bottom };
        clamp();
      }
    }
  }

  const onResize = () => clamp();

  function stop() {
    alive = false;
    unmount();
    removeEventListener("resize", onResize);
    try {
      chrome.storage.onChanged.removeListener(onStorage);
    } catch {}
  }

  chrome.storage.onChanged.addListener(onStorage);
  addEventListener("resize", onResize);
  window.__sureframePage = Object.assign(stop, { alive: () => alive && !!chrome.runtime?.id });
  void load();
})();
