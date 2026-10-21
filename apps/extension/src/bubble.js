// SureFrame extension: the camera bubble and Pause/Stop bar, shown on web pages while the SureFrame tab records
// the screen. Runs in its own frame. Buttons only send a request to the SureFrame tab, which does the pausing and
// stopping itself: if anything here fails, the recording carries on and the tab's own buttons still work.

const MIN = 120;
const MAX = 360;
const GAP = 8;
const RING = 3; // the white ring drawn around the circle
const $ = (id) => document.getElementById(id);
const circle = $("circle");
const video = $("video");
const note = $("camera-note");
const bar = $("bar");
const mini = $("mini");

let rec = null;
let prefs = { size: 200, collapsed: false };
let port = null;
let stream = null;
let opening = null;
let cameraProblem = null;
let hiddenSince = 0;
let triedAt = 0;

// ---------- The frame's size, sent to the page script that holds the frame ----------

function layout() {
  const camera = rec?.mode === "screen+camera";
  const size = Math.max(MIN, Math.min(MAX, prefs.size));
  circle.hidden = !camera;
  circle.style.width = circle.style.height = `${size}px`;
  bar.hidden = prefs.collapsed;
  mini.hidden = !prefs.collapsed || camera;
  $("expand").hidden = !prefs.collapsed;
  const barWidth = prefs.collapsed ? 0 : bar.offsetWidth || 196;
  const parts = [];
  if (camera) parts.push(size + RING * 2);
  if (!prefs.collapsed) parts.push(40);
  else if (!camera) parts.push(40);
  const width = Math.max(camera ? size + RING * 2 : 0, barWidth, prefs.collapsed && !camera ? 40 : 0);
  const height = parts.reduce((a, b) => a + b, 0) + GAP * (parts.length - 1);
  port?.postMessage({ box: { width, height } });
}

window.addEventListener("message", (e) => {
  // The page script hands over a private channel once; only moves and sizes go through it.
  if (e.data?.sureframe !== "port" || !e.ports[0] || port) return;
  port = e.ports[0];
  port.onmessage = (m) => {
    // The frame now covers the page: the bubble stays where it was until the pointer moves.
    const g = gesture;
    if (m.data?.full && g) {
      g.at = m.data.full;
      // Where the pointer went down, on the page: the frame's bottom left is at the place given.
      g.from = { x: g.at.left + g.down.x, y: m.data.height - g.at.bottom - g.down.h + g.down.y, left: g.at.left, bottom: g.at.bottom, size: prefs.size };
      place(g.at);
      // A move made before this arrived is taken now, and a quick flick already let go is finished.
      if (g.last) g.take(g.last);
      if (g.letGo) g.finish();
    }
  };
  layout();
});

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
$("collapse").addEventListener("click", () => setPrefs({ collapsed: true }));
for (const b of [$("expand"), mini]) b.addEventListener("click", () => !dragged && setPrefs({ collapsed: false }));

function setPrefs(change) {
  prefs = { ...prefs, ...change };
  layout();
  void chrome.storage.local.get("bubble").then(({ bubble }) => chrome.storage.local.set({ bubble: { ...bubble, ...change } }));
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
const wrap = document.body;

function drag(el, kind) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !port || (e.target !== el && e.target.closest("button") && e.target.closest("button") !== el)) return;
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    dragged = false;
    el.classList.add("dragging");
    // Where the pointer went down, inside this frame at its own size.
    gesture = { kind, el, down: { x: e.clientX, y: e.clientY, h: innerHeight }, from: null, at: null, last: null, take: null };
    port.postMessage({ drag: "start" });
    const move = (m) => {
      const g = gesture;
      if (!g) return;
      if (!g.from) {
        g.last = { clientX: m.clientX, clientY: m.clientY };
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
      const dx = x - g.from.x;
      const dy = y - g.from.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
      if (g.kind === "move") {
        const w = innerWidth - wrap.offsetWidth;
        const h = innerHeight - wrap.offsetHeight;
        g.at = { left: Math.max(0, Math.min(w, g.from.left + dx)), bottom: Math.max(0, Math.min(h, g.from.bottom - dy)) };
      } else {
        // The grip at the circle's top right: bigger up and right, smaller down and left. The bottom left stays put.
        const grow = Math.abs(dx) > Math.abs(dy) ? dx : -dy;
        prefs.size = Math.max(MIN, Math.min(MAX, g.from.size + grow));
        layout();
      }
      place(g.at);
    };
    const finish = () => {
      const g = gesture;
      gesture = null;
      port?.postMessage({ drag: "end", ...(g?.at ?? {}) });
      if (g?.kind === "size") setPrefs({ size: prefs.size });
    };
    const up = (u) => {
      // Where it was let go counts too: a quick flick can end before any move was taken.
      if (u.type === "pointerup") move(u);
      el.classList.remove("dragging");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      // Let go before the frame covered the page: finished once it has (see the port's messages).
      if (gesture && !gesture.from) gesture.letGo = true;
      else finish();
      // A drag that ends over a button isn't a click on it.
      setTimeout(() => (dragged = false), 0);
    };
    gesture.take = move;
    gesture.finish = finish;
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });
}

/** Inside the page-covering frame: the bubble at this place (left, and up from the bottom). Null: back to normal. */
function place(at) {
  if (!at) {
    wrap.style.position = wrap.style.left = wrap.style.bottom = wrap.style.width = "";
    return;
  }
  wrap.style.position = "absolute";
  wrap.style.left = `${at.left}px`;
  wrap.style.bottom = `${at.bottom}px`;
}

drag(circle, "move");
drag(bar, "move");
drag(mini, "move");
drag($("grow"), "size");

// Back to its own size: drawn normally again, in the same moment the frame shrinks.
window.addEventListener("resize", () => !gesture && place(null));

// ---------- Start ----------

async function start() {
  const [{ rec: r }, { bubble }] = await Promise.all([chrome.storage.session.get("rec"), chrome.storage.local.get("bubble")]);
  rec = r ?? null;
  if (bubble) prefs = { size: Number(bubble.size) || 200, collapsed: !!bubble.collapsed };
  layout();
  draw();
  if (document.visibilityState === "visible") void openCamera();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.rec) {
    const was = rec?.mode;
    rec = changes.rec.newValue ?? null;
    if (!rec) closeCamera();
    if (rec?.mode !== was) layout();
    if (rec?.mode === "screen+camera" && document.visibilityState === "visible") void openCamera();
    draw();
  }
  if (area === "local" && changes.bubble?.newValue) {
    const b = changes.bubble.newValue;
    const next = { size: Number(b.size) || prefs.size, collapsed: !!b.collapsed };
    if (next.size !== prefs.size || next.collapsed !== prefs.collapsed) {
      prefs = next;
      layout();
    }
  }
});

void start();
