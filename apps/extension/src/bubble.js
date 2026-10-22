// SureFrame extension: the camera bubble and Pause/Stop bar, shown on web pages while the SureFrame tab records
// the screen. Runs in its own frame. Buttons only send a request to the SureFrame tab, which does the pausing and
// stopping itself: if anything here fails, the recording carries on and the tab's own buttons still work.

const MIN = 120;
const MAX = 440;
const GAP = 8;
const RING = 3; // the white ring drawn around the circle
const $ = (id) => document.getElementById(id);
const circle = $("circle");
const video = $("video");
const note = $("camera-note");
const bar = $("bar");
const mini = $("mini");
const sizer = $("sizer");
const scale = $("scale");
const STEP = 20;

let rec = null;
/** Every recording starts with the bubble at this size and its bar showing; changes last until it ends. */
const DEFAULT = { size: 200, collapsed: false };
let prefs = { ...DEFAULT };
/** The size dial under the circle, opened from the bar. Not remembered: it closes on other pages. */
let dialOpen = false;
/**
 * The bubble's outline, which its frame is sized to, and where in it the middle of the bar is (anchor): the bubble is
 * placed by that middle, so the bar and dial stay where they were put while the circle changes size around them.
 */
let shape = { width: 0, height: 0, anchor: 0 };
/** The page's window and where the bubble is placed on it, from the page script: the middle of the bar, and its bottom. */
let view = { w: 0, h: 0, cx: null, bottom: 24 };
/** The dial's slider is held down on this tab. */
let sliding = false;
/** How far the dial is moved in from where the bubble is placed (held still while sliding). */
let dialOff = 0;
let port = null;
let stream = null;
let opening = null;
let cameraProblem = null;
let hiddenSince = 0;
let triedAt = 0;

// ---------- The frame's size, sent to the page script that holds the frame ----------

/** Where the bubble is right now: while it's held, wherever the hold has taken it; otherwise as the page script says. */
const here = () => gesture?.pos ?? view;

function layout() {
  const camera = rec?.mode === "screen+camera";
  const pos = here();
  const w = gesture ? innerWidth : view.w;
  const h = gesture ? innerHeight : view.h;
  bar.hidden = prefs.collapsed;
  mini.hidden = !prefs.collapsed || camera;
  $("expand").hidden = !prefs.collapsed;
  $("size").hidden = !camera;
  const dialShown = camera && dialOpen && !prefs.collapsed;
  sizer.hidden = !dialShown;
  $("size").setAttribute("aria-expanded", String(dialShown));
  const barWidth = prefs.collapsed ? 0 : bar.offsetWidth || 196;
  // The dial is as wide as the bar under it.
  sizer.style.width = `${barWidth}px`;
  const below = (dialShown ? 34 + GAP : 0) + (!prefs.collapsed || !camera ? 40 + GAP : 0);
  // Never taller than the room above where it's placed (it's moved, never squashed, while it's being dragged).
  let size = Math.max(MIN, Math.min(MAX, prefs.size));
  const room = h && gesture?.kind !== "move" ? h - pos.bottom - below - RING * 2 : Infinity;
  if (camera) size = Math.max(MIN, Math.min(size, Math.floor(room)));
  circle.hidden = !camera;
  circle.style.width = circle.style.height = `${size}px`;
  if (!sliding) scale.value = String(size);
  $("smaller").disabled = size <= MIN;
  $("bigger").disabled = size >= Math.min(MAX, room);
  // Across, from where the bubble is placed: how far something this wide, centred there, moves in to stay inside the
  // window's sides.
  const across = (width) => {
    if (pos.cx == null || !w) return 0;
    if (pos.cx - width / 2 < 0) return width / 2 - pos.cx;
    if (pos.cx + width / 2 > w) return w - width / 2 - pos.cx;
    return 0;
  };
  const outer = size + RING * 2;
  // The circle, bar and dial share one centre line, and move in together where the widest of them meets a side. While
  // the dial's slider is held it stays where it was (moving under the pointer would change the size again), and
  // lines up again on letting go.
  const off = across(Math.max(camera ? outer : 0, barWidth, prefs.collapsed && !camera ? 40 : 0));
  if (!sliding) dialOff = off;
  // With the dial open, the frame already has room for the biggest bubble that fits, so sliding only redraws inside
  // it: nothing waits on the frame, and the dial never moves under the pointer.
  const roomy = dialShown ? Math.max(size, Math.min(MAX, Math.floor(room))) + RING * 2 : outer;
  const items = [];
  if (camera && roomy > outer) items.push([null, across(roomy) - roomy / 2, roomy, 0]);
  if (camera) items.push([circle, off - outer / 2, outer, RING]);
  if (dialShown) items.push([sizer, dialOff - barWidth / 2, barWidth, 0]);
  if (!prefs.collapsed) items.push([bar, off - barWidth / 2, barWidth, 0]);
  if (prefs.collapsed && !camera) items.push([mini, off - 20, 40, 0]);
  const from = Math.min(...items.map(([, l]) => l));
  const to = Math.max(...items.map(([, l, wd]) => l + wd));
  for (const [el, l, , pad] of items) if (el) el.style.marginLeft = `${l - from + pad}px`;
  const height = (camera ? roomy : 0) + below - (camera ? 0 : GAP);
  shape = { width: to - from, height, anchor: -from };
  if (gesture?.pos) place(pos);
  else if (!gesture) port?.postMessage({ box: shape });
}

/**
 * The page script hands over a private channel once; only moves and sizes go through it. The web page around this
 * frame can post here too, so the channel is taken only with the one-off code the page script wrote for this frame
 * (named in its address) in the extension's own storage, which web pages can't read (B20).
 */
const slot = location.hash.slice(1);
window.addEventListener("message", (e) => {
  if (e.data?.sureframe !== "port" || !e.ports[0] || port) return;
  const offered = e.ports[0];
  const nonce = e.data.nonce;
  void (async () => {
    const key = `bubble:${slot}`;
    const want = slot && typeof nonce === "string" && nonce ? (await chrome.storage.session.get(key).catch(() => ({})))[key] : null;
    if (port || !want || want !== nonce) return offered.close();
    // Used once: a code seen by anything else is no good afterwards.
    void chrome.storage.session.remove(key).catch(() => {});
    takePort(offered);
  })();
});

function takePort(offered) {
  port = offered;
  port.onmessage = (m) => {
    if (m.data?.view) {
      view = m.data.view;
      if (!gesture) layout();
      return;
    }
    // The page script put the frame back around the bubble (its tab was left mid-gesture): the gesture is over.
    if (m.data?.cancel) {
      gesture?.end();
      return;
    }
    // The frame now covers the page: the bubble stays where it was until the pointer moves.
    const g = gesture;
    if (m.data?.full && g) {
      g.pos = m.data.full;
      const left = g.pos.cx - shape.anchor;
      // Where the pointer went down, on the page.
      g.from = { x: left + g.down.x, y: m.data.height - g.pos.bottom - g.down.h + g.down.y, left, cx: g.pos.cx, bottom: g.pos.bottom, size: prefs.size };
      layout();
      // A move made before this arrived is taken now, and a quick flick already let go is finished.
      if (g.last) g.take(g.last);
      if (g.letGo) g.finish();
    }
  };
  layout();
}

// ---------- Recording state, from the SureFrame tab ----------

function elapsed() {
  if (!rec) return 0;
  const running = rec.phase === "recording" ? Date.now() - (rec.at ?? Date.now()) : 0;
  return Math.max(0, (rec.ms ?? 0) + running);
}

function draw() {
  if (!rec) return;
  const started = rec.phase === "recording" || rec.phase === "paused";
  const sec = Math.floor(elapsed() / 1000);
  $("clock").textContent = started ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : "Starting";
  for (const d of [$("dot"), $("mini-dot")]) {
    d.classList.toggle("paused", rec.phase === "paused");
    d.classList.toggle("waiting", !started);
  }
  const paused = rec.phase === "paused";
  $("pause").setAttribute("aria-label", paused ? "Resume" : "Pause");
  $("pause").title = paused ? "Resume" : "Pause";
  $("pause").firstElementChild.classList.toggle("play", paused);
  $("pause").disabled = !started;
  $("stop").disabled = !started;
}

async function command(action) {
  if (!rec) return;
  await chrome.storage.session.set({ cmd: { id: rec.id, action, n: crypto.randomUUID() } });
  // Stop: back to the SureFrame tab, where the finished video opens.
  if (action === "stop") chrome.runtime.sendMessage({ type: "show-recorder" }).catch(() => {});
}

$("pause").addEventListener("click", () => void command(rec?.phase === "paused" ? "resume" : "pause"));
$("stop").addEventListener("click", () => void command("stop"));
$("collapse").addEventListener("click", () => {
  dialOpen = false;
  setPrefs({ collapsed: true });
});
$("size").addEventListener("click", () => {
  if (dragged) return;
  dialOpen = !dialOpen;
  // From here on the bubble is placed by the bar's middle (until now it may have been going by its left edge), so
  // the frame making room for the dial leaves the bar where it is.
  if (dialOpen) port?.postMessage({ pin: true });
  layout();
});
// The dial: the circle follows while sliding, and the size is kept (and shown on every tab) once let go.
const sized = (n) => Math.max(MIN, Math.min(MAX, Math.round(n)));
scale.addEventListener("pointerdown", () => (sliding = true));
scale.addEventListener("input", () => {
  prefs.size = sized(Number(scale.value));
  layout();
});
scale.addEventListener("change", () => {
  sliding = false;
  setPrefs({ size: sized(Number(scale.value)) });
  layout();
});
for (const ev of ["pointerup", "pointercancel", "blur"])
  scale.addEventListener(ev, () => {
    if (!sliding) return;
    sliding = false;
    layout();
  });
// From the size it's shown at (which can be less than asked for, where there isn't room above it).
const shownSize = () => Number.parseFloat(circle.style.width) || prefs.size;
$("smaller").addEventListener("click", () => setPrefs({ size: sized(shownSize() - STEP) }));
$("bigger").addEventListener("click", () => setPrefs({ size: sized(shownSize() + STEP) }));
for (const b of [$("expand"), mini]) b.addEventListener("click", () => !dragged && setPrefs({ collapsed: false }));

/**
 * Changes the bubble here and on every other tab. The size and tucked-away state are written whole under their own
 * name (the page script keeps the place separately), so two writes landing together can't leave tabs disagreeing.
 * They're kept with the recording they were made in: the next recording starts afresh (see lookFor).
 */
function setPrefs(change) {
  prefs = { ...prefs, ...change };
  layout();
  if (rec?.id) void chrome.storage.local.set({ bubbleLook: { size: prefs.size, collapsed: prefs.collapsed, rec: rec.id } }).catch(() => {});
}

/** The size and tucked-away state kept for this recording, or the defaults for a new one. */
function lookFor(look) {
  if (!look || !rec?.id || look.rec !== rec.id) return { ...DEFAULT };
  return { size: Number(look.size) || DEFAULT.size, collapsed: !!look.collapsed };
}

// ---------- The camera ----------

/** The same camera the SureFrame tab is using, found by its name (each site gets different device ids). */
async function openCamera() {
  if (stream || opening || rec?.mode !== "screen+camera") return;
  triedAt = Date.now();
  opening = (async () => {
    try {
      let deviceId;
      const wanted = rec?.camera?.label;
      if (wanted) {
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        deviceId = cams.find((d) => d.label === wanted)?.deviceId;
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      // Ended or switched to just the bar while the camera was opening.
      if (rec?.mode !== "screen+camera") return closeCamera();
      cameraProblem = null;
      video.srcObject = stream;
      await video.play().catch(() => {});
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        closeCamera();
        cameraProblem = "ended";
        showProblem();
        report();
      });
    } catch (err) {
      // The website itself can forbid cameras on its pages (nothing to allow then), or the camera hasn't been
      // allowed for the extension yet.
      const site = document.featurePolicy && !document.featurePolicy.allowsFeature("camera");
      cameraProblem = site ? "site" : err?.name === "NotAllowedError" || err?.name === "SecurityError" ? "blocked" : "busy";
    } finally {
      opening = null;
      showProblem();
      report();
    }
  })();
  await opening;
}

function closeCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}

function showProblem() {
  note.hidden = !cameraProblem;
  note.replaceChildren();
  if (!cameraProblem) return;
  const text = document.createElement("span");
  // Whatever the reason, the SureFrame tab puts the camera into the video meanwhile.
  text.textContent =
    cameraProblem === "site"
      ? "This website doesn't allow cameras, so your bubble can't show here. You're still in your video."
      : cameraProblem === "blocked"
        ? "Your camera isn't allowed for the bubble yet. You're still in your video."
        : "Your camera isn't available right now. You're still in your video.";
  note.append(text);
  if (cameraProblem === "blocked") {
    const allow = document.createElement("button");
    allow.type = "button";
    allow.textContent = "Allow camera";
    allow.addEventListener("click", () => chrome.runtime.sendMessage({ type: "welcome" }).catch(() => {}));
    note.append(allow);
  }
}

/** Tells the extension whether this bubble's camera is showing, so the SureFrame tab knows to leave it out of the video. */
function report() {
  if (!chrome.runtime?.id) return;
  const track = stream?.getVideoTracks()[0];
  const ok = document.visibilityState === "visible" && rec?.mode === "screen+camera" && track?.readyState === "live" && video.videoWidth > 0 && !video.paused;
  chrome.runtime.sendMessage({ type: "camera", ok }).catch(() => {});
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    hiddenSince = 0;
    // Shown again (perhaps after allowing the camera on the welcome page): try afresh.
    cameraProblem = null;
    showProblem();
    void openCamera();
  } else hiddenSince = Date.now();
  report();
});
video.addEventListener("playing", report);

setInterval(() => {
  draw();
}, 250);
setInterval(() => {
  // A tab left in the background lets its camera go after a minute; it comes back when the tab is shown.
  if (hiddenSince && Date.now() - hiddenSince > 60_000) closeCamera();
  // A busy or unplugged camera is tried again every few seconds; a blocked one when the tab is shown again.
  else if (document.visibilityState === "visible" && !stream && cameraProblem !== "blocked" && cameraProblem !== "site" && Date.now() - triedAt > (cameraProblem ? 5000 : 0)) void openCamera();
  report();
}, 1000);

// ---------- Dragging and resizing ----------
// On pressing the circle, the bar or the grip, the page script makes this frame cover the page (see-through) and says
// where the bubble was; the bubble then follows the pointer inside it, and the frame shrinks back around it on
// letting go. Positions inside a frame that moves under the pointer lag behind, so the frame stays still meanwhile.

let dragged = false;
let gesture = null;
/** A gesture with no pointer news for this long is over (see gesture.still). */
const IDLE = 8000;
const wrap = document.body;

function drag(el, kind) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !port || (e.target !== el && e.target.closest("button") && e.target.closest("button") !== el)) return;
    e.preventDefault();
    e.stopPropagation();
    // A gesture whose let-go was never heard ends where it was before this one starts.
    gesture?.end();
    el.setPointerCapture(e.pointerId);
    dragged = false;
    el.classList.add("dragging");
    // Where the pointer went down, inside this frame at its own size.
    gesture = { kind, el, id: e.pointerId, down: { x: e.clientX, y: e.clientY, h: innerHeight }, from: null, at: null, last: null, take: null };
    port.postMessage({ drag: "start" });
    const move = (m) => {
      const g = gesture;
      if (!g || m.pointerId !== g.id) return;
      // Let go outside the window, where this frame can't hear it: the pointer is back with no button held.
      if (m.type === "pointermove" && m.buttons === 0) return up(m);
      g.still();
      if (!g.from) {
        g.last = { clientX: m.clientX, clientY: m.clientY, pointerId: m.pointerId };
        return;
      }
      // Just after pressing, positions can still be inside the frame at its own size rather than on the page. The
      // frame doesn't move during the gesture, so those convert exactly. The pointer moves smoothly, so whichever
      // reading is nearer to its last place is the right one; once one is on the page, all the rest are.
      let x = m.clientX;
      let y = m.clientY;
      if (!g.onPage) {
        const lx = x + g.from.left;
        const ly = y + (g.from.y - g.down.y);
        const prev = g.prev ?? g.from;
        if (Math.hypot(lx - prev.x, ly - prev.y) < Math.hypot(x - prev.x, y - prev.y)) {
          x = lx;
          y = ly;
        } else g.onPage = true;
      }
      g.prev = { x, y };
      // Taken as at the window's edge when the pointer goes past it: the bubble and its frame never reach beyond.
      x = Math.max(0, Math.min(innerWidth, x));
      y = Math.max(0, Math.min(innerHeight, y));
      const dx = x - g.from.x;
      const dy = y - g.from.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
      if (g.kind === "move") {
        // Kept on the window: the widest of the circle and bar stops at its sides, and the other with it.
        const circleHalf = rec?.mode === "screen+camera" ? (Number.parseFloat(circle.style.width) + RING * 2) / 2 : 0;
        const half = Math.max(circleHalf, !prefs.collapsed ? bar.offsetWidth / 2 : circleHalf ? 0 : 20);
        const cx = Math.max(half, Math.min(innerWidth - half, g.from.cx + dx));
        g.pos = { cx, bottom: Math.max(0, Math.min(innerHeight - shape.height, g.from.bottom - dy)) };
      } else {
        // The grip at the circle's top right: bigger up and right, smaller down and left, around the bar's middle
        // (twice as much across, so the grip keeps up with the pointer). Never bigger than fits above it (layout).
        const grow = Math.abs(dx) > Math.abs(dy) ? dx * 2 : -dy;
        prefs.size = Math.max(MIN, Math.min(MAX, g.from.size + grow));
      }
      layout();
    };
    const finish = () => {
      const g = gesture;
      gesture = null;
      if (g?.kind === "size") setPrefs({ size: prefs.size });
      if (g?.pos) port?.postMessage({ drag: "end", cx: g.pos.cx, bottom: g.pos.bottom });
      else port?.postMessage({ drag: "end" });
    };
    const up = (u) => {
      if (u && u.pointerId !== gesture?.id) return;
      clearTimeout(gesture?.idle);
      // Where it was let go counts too: a quick flick can end before any move was taken.
      if (u?.type === "pointerup") move(u);
      el.classList.remove("dragging");
      for (const t of ["pointermove", "pointerup", "pointercancel"]) document.removeEventListener(t, t === "pointermove" ? move : up, true);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
      // Let go before the frame covered the page: finished once it has (see the port's messages).
      if (gesture && !gesture.from) gesture.letGo = true;
      else finish();
      // A drag that ends over a button isn't a click on it.
      setTimeout(() => (dragged = false), 0);
    };
    gesture.take = move;
    gesture.finish = finish;
    gesture.end = () => up(null);
    // Nothing heard for a while: most likely let go outside the window and not back yet. Ended where it is, so the
    // page underneath works again.
    const self = gesture;
    self.still = () => {
      clearTimeout(self.idle);
      self.idle = setTimeout(() => gesture === self && self.end(), IDLE);
    };
    gesture.still();
    // Heard on the whole frame, not just what was pressed, so a pointer that lost its capture still ends the gesture.
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
  });
}

// A press anywhere on the frame while it still covers the page means the last let-go was never heard: finish that one.
document.addEventListener("pointerdown", () => gesture?.end(), true);
// Leaving the tab (another tab, another app) ends a gesture too: its let-go can't be heard from there.
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && gesture?.end());

/**
 * Inside the page-covering frame: the bubble with the middle of its bar at cx, its bottom this far up. Null: back to
 * normal. The page script hears where it is each time, so it can carry on from there if a let-go never arrives.
 */
function place(at) {
  if (!at) {
    wrap.style.position = wrap.style.left = wrap.style.bottom = wrap.style.width = wrap.style.minHeight = "";
    return;
  }
  wrap.style.position = "absolute";
  wrap.style.minHeight = "0";
  // As wide as its frame would be, so the circle's ring keeps its room and nothing shifts sideways.
  wrap.style.width = `${shape.width}px`;
  wrap.style.left = `${at.cx - shape.anchor}px`;
  wrap.style.bottom = `${at.bottom}px`;
  port?.postMessage({ at: { cx: at.cx, bottom: at.bottom } });
}

// The bar's width changes with what it shows ("Starting", then the time): the outline follows.
new ResizeObserver(() => !bar.hidden && layout()).observe(bar);

drag(circle, "move");
drag(bar, "move");
drag(mini, "move");
drag($("grow"), "size");

// Back to its own size: drawn normally again, in the same moment the frame shrinks.
window.addEventListener("resize", () => !gesture && place(null));

// ---------- Start ----------

async function start() {
  const [{ rec: r }, { bubbleLook }] = await Promise.all([chrome.storage.session.get("rec"), chrome.storage.local.get("bubbleLook")]);
  rec = r ?? null;
  prefs = lookFor(bubbleLook);
  layout();
  draw();
  if (document.visibilityState === "visible") void openCamera();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.rec) {
    const was = rec?.mode;
    const wasId = rec?.id;
    rec = changes.rec.newValue ?? null;
    // A new recording: the default size with the bar showing, whatever the last one was left at.
    if (rec?.id && rec.id !== wasId) {
      prefs = { ...DEFAULT };
      dialOpen = false;
      layout();
    }
    // Ended, or switched to just Pause and Stop (one window shared: the camera goes in the video's corner instead).
    if (rec?.mode !== "screen+camera") closeCamera();
    if (rec?.mode !== was) layout();
    if (rec?.mode === "screen+camera" && document.visibilityState === "visible") void openCamera();
    draw();
  }
  // Changed on another tab (or this one): the same here, unless this bubble is being resized right now.
  if (area === "local" && changes.bubbleLook?.newValue?.rec === rec?.id && rec?.id && gesture?.kind !== "size" && !sliding) {
    const next = lookFor(changes.bubbleLook.newValue);
    if (next.size !== prefs.size || next.collapsed !== prefs.collapsed) {
      prefs = next;
      layout();
    }
  }
});

void start();
