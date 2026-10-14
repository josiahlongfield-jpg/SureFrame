/**
 * Screen + camera: draws the camera as a circle in the bottom-left corner of
 * the screen recording, so it's in the video whatever is shared (a tab, a
 * window or the whole screen). Runs in a worker, which keeps drawing while the
 * SureFrame tab is in the background.
 *
 * Needs Chrome, Edge or Brave (MediaStreamTrackProcessor and
 * MediaStreamTrackGenerator). Elsewhere `canComposeCamera()` is false and the
 * recording is the screen alone: the camera is only in it when the floating
 * bubble is on a shared screen.
 */

type Processor = { readable: ReadableStream };
type Generator = MediaStreamTrack & { writable: WritableStream };
type Globals = {
  MediaStreamTrackProcessor?: new (o: { track: MediaStreamTrack }) => Processor;
  MediaStreamTrackGenerator?: new (o: { kind: "video" }) => Generator;
};

export function canComposeCamera() {
  const g = globalThis as unknown as Globals;
  return !!g.MediaStreamTrackProcessor && !!g.MediaStreamTrackGenerator && typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined";
}

// The worker keeps the latest screen picture and camera frame, and sends out a
// combined frame 30 times a second, so the camera keeps moving on a still
// screen and the screen keeps going if the camera drops out.
const WORKER = `
let screen = null, cam = null, canvas = null, ctx = null, writer = null, timer = null;
const keep = (frame, old) => { if (old) old.close(); return frame; };
async function pump(readable, set) {
  const reader = readable.getReader();
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; set(value); } } catch {}
}
function draw() {
  if (!screen || !writer) return;
  const sw = screen.displayWidth, sh = screen.displayHeight;
  if (!canvas) {
    canvas = new OffscreenCanvas(sw - (sw % 2), sh - (sh % 2));
    ctx = canvas.getContext("2d");
  }
  const W = canvas.width, H = canvas.height;
  // The screen fills the frame; a window resized mid-recording is letterboxed, not stretched.
  const s = Math.min(W / sw, H / sh), dw = sw * s, dh = sh * s;
  ctx.fillStyle = "#000";
  if (dw < W || dh < H) ctx.fillRect(0, 0, W, H);
  ctx.drawImage(screen, (W - dw) / 2, (H - dh) / 2, dw, dh);
  if (cam) {
    const d = Math.round(Math.min(W, H) * 0.24), m = Math.round(Math.min(W, H) * 0.035);
    const x = m, y = H - m - d, r = d / 2;
    const cw = cam.displayWidth, ch = cam.displayHeight, side = Math.min(cw, ch);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
    ctx.clip();
    // Mirrored, like the preview, and cropped to the middle square.
    ctx.translate(x + d, y);
    ctx.scale(-1, 1);
    ctx.drawImage(cam, (cw - side) / 2, (ch - side) / 2, side, side, 0, 0, d, d);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, Math.round(d * 0.025));
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
  }
  const out = new VideoFrame(canvas, { timestamp: Math.round(performance.now() * 1000) });
  if (writer.desiredSize !== null && writer.desiredSize <= 0) { out.close(); return; }
  writer.write(out).catch(() => {});
}
onmessage = (e) => {
  if (e.data.stop) {
    clearInterval(timer);
    screen = keep(null, screen); cam = keep(null, cam);
    writer?.close().catch(() => {});
    close();
    return;
  }
  writer = e.data.out.getWriter();
  pump(e.data.screen, (f) => (screen = keep(f, screen)));
  // A camera that stops (unplugged, or it drops out) takes the circle away rather than freezing it.
  pump(e.data.camera, (f) => (cam = keep(f, cam))).then(() => {
    cam = keep(null, cam);
    postMessage({ cameraEnded: true });
  });
  timer = setInterval(draw, 1000 / 30);
};
`;

/**
 * A video track of `screen` with `camera` in a circle in the bottom-left
 * corner. `close()` stops it; the screen and camera tracks are left running.
 */
export function composeCamera(
  screen: MediaStreamTrack,
  camera: MediaStreamTrack,
  onCameraEnded?: () => void,
): { track: MediaStreamTrack; close: () => void } {
  const g = globalThis as unknown as Required<Globals>;
  // A copy of the camera, so stopping this doesn't stop the preview or the bubble.
  const cam = camera.clone();
  const screenIn = new g.MediaStreamTrackProcessor({ track: screen });
  const camIn = new g.MediaStreamTrackProcessor({ track: cam });
  const out = new g.MediaStreamTrackGenerator({ kind: "video" });
  let closed = false;
  const url = URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  worker.onmessage = (e) => e.data?.cameraEnded && !closed && onCameraEnded?.();
  worker.postMessage({ screen: screenIn.readable, camera: camIn.readable, out: out.writable }, [
    screenIn.readable as unknown as Transferable,
    camIn.readable as unknown as Transferable,
    out.writable as unknown as Transferable,
  ]);
  return {
    track: out,
    close: () => {
      if (closed) return;
      closed = true;
      worker.postMessage({ stop: true });
      cam.stop();
      out.stop();
      setTimeout(() => worker.terminate(), 1000);
    },
  };
}
