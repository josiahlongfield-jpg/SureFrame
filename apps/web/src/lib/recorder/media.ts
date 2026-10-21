export type Mode = "screen+camera" | "screen" | "camera";
export type Quality = 720 | 1080 | 2160;

/**
 * H.264/AAC MP4 first (Safari, and Chrome and Edge on most computers): it plays
 * everywhere, including iPhones that can't play WebM. Recordings are encrypted
 * end to end, so the server can never convert them later. Then WebM (Firefox,
 * and Chrome without an H.264 encoder), then any MP4.
 */
const CANDIDATE_TYPES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

export function pickMimeType() {
  return CANDIDATE_TYPES.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "video/webm";
}

export function bitrateFor(q: Quality) {
  return q >= 2160 ? 16_000_000 : q >= 1080 ? 5_000_000 : 2_500_000;
}

const dims = (q: Quality) => ({ width: Math.round((q * 16) / 9), height: q });

/** Front or rear: how a phone or tablet picks its camera. */
export type Facing = "user" | "environment";
/** A camera from the list (computers), the front or rear one (phones and tablets), or none for the browser's default. */
export type CameraPick = { deviceId: string } | { facing: Facing } | undefined;

/**
 * The camera part of a request; every pick gets the same size settings, so the picture is sized the same.
 * A side gets the browser's main camera on that side, not an ultra-wide or zoom lens.
 */
function cameraConstraints(cam: CameraPick, q: Quality): MediaTrackConstraints {
  const { width, height } = dims(Math.min(q, 1080) as Quality);
  const which = !cam ? {} : "deviceId" in cam ? { deviceId: { exact: cam.deviceId } } : { facingMode: { ideal: cam.facing } };
  return { ...which, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 } };
}

export async function getCamera(cam: CameraPick, q: Quality) {
  return navigator.mediaDevices.getUserMedia({ video: cameraConstraints(cam, q), audio: false });
}

/**
 * Camera and microphone in one request. iPhones only allow one capture at a
 * time, and asking for the mic separately while the camera is live can end
 * the camera track or crash the page.
 */
export async function getCameraAndMic(cam: CameraPick, micId: string | undefined, q: Quality) {
  return navigator.mediaDevices.getUserMedia({
    video: cameraConstraints(cam, q),
    audio: { deviceId: micId ? { exact: micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

export async function getMic(deviceId: string | undefined) {
  return navigator.mediaDevices.getUserMedia({
    audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

export async function getScreen(q: Quality) {
  const { width, height } = dims(q);
  return navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30, max: 30 } },
    audio: true, // tab/system audio where the browser supports it
  });
}

/** Mix mic and screen audio into one track so neither is lost. */
export function mixAudio(streams: MediaStream[]): { track?: MediaStreamTrack; close: () => void } {
  const sources = streams.filter((s) => s.getAudioTracks().length > 0);
  if (sources.length === 0) return { close: () => {} };
  if (sources.length === 1) return { track: sources[0].getAudioTracks()[0], close: () => {} };
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  for (const s of sources) ctx.createMediaStreamSource(s).connect(dest);
  return { track: dest.stream.getAudioTracks()[0], close: () => void ctx.close() };
}

/**
 * Float the camera above every app using Document Picture-in-Picture
 * (Chrome/Edge), falling back to classic video PiP. When the user shares
 * their entire screen the bubble is captured in the recording.
 *
 * Browsers only open one straight after a click, so call this before anything
 * else that waits (the screen picker, the server). Resolves to a function that
 * closes it, or null when the browser wouldn't open one. `onClosed` runs if the
 * person closes it themselves.
 */
export async function openCameraBubble(camera: MediaStream | null, onClosed?: () => void, controls?: BubbleControls): Promise<(() => void) | null> {
  const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow(o: object): Promise<Window> } })
    .documentPictureInPicture;
  if (dpip) {
    try {
      // With controls, a bar under the circle; without a camera, just the bar.
      const bar = controls ? 52 : 0;
      const pip = await dpip.requestWindow(camera ? { width: 240, height: 240 + bar } : { width: 280, height: bar });
      pip.document.body.style.cssText =
        "margin:0;height:100vh;background:#000;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;font:600 14px/1 system-ui,-apple-system,sans-serif;color:#fff";
      if (camera) {
        const v = pip.document.createElement("video");
        v.autoplay = true;
        v.muted = true;
        v.playsInline = true;
        v.srcObject = camera;
        // Always a true circle, however the window is sized, showing the middle square of the camera:
        // exactly what the circle in the recording shows (lib/recorder/compose.ts).
        const side = `min(100vw,calc(100vh - ${bar}px))`;
        v.style.cssText = `width:${side};height:${side};flex:none;object-fit:cover;object-position:center;border-radius:50%;transform:scaleX(-1)`;
        pip.document.body.append(v);
      }
      const stopTicking = controls ? addControls(pip, controls, bar) : () => {};
      let closing = false;
      pip.addEventListener("pagehide", () => {
        stopTicking();
        if (!closing) onClosed?.();
      });
      return () => {
        closing = true;
        stopTicking();
        pip.close();
      };
    } catch {
      /* fall through */
    }
  }
  // Classic video picture-in-picture can't hold buttons, and there's nothing to float without a camera.
  if (!camera) return null;
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.srcObject = camera;
  try {
    await v.play();
    await v.requestPictureInPicture();
  } catch {
    return null;
  }
  let closing = false;
  v.addEventListener("leavepictureinpicture", () => !closing && onClosed?.());
  return () => {
    closing = true;
    void document.exitPictureInPicture().catch(() => {});
  };
}

/** What the floating bubble's buttons do: the recorder's own Pause, Resume and Stop, and where it's at. */
export type BubbleControls = {
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Null until the recording has started (the bubble opens before the screen picker). */
  state: () => { paused: boolean; ms: number } | null;
};

/**
 * Pause/Resume and Stop with the time, in a bar at the bottom of the floating window, so a recording can be run
 * without going back to its tab. Returns a function that stops the clock.
 */
function addControls(pip: Window, controls: BubbleControls, height: number) {
  const doc = pip.document;
  const bar = doc.createElement("div");
  bar.dataset.testid = "bubble-controls";
  bar.style.cssText = `height:${height}px;flex:none;align-self:stretch;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 8px;background:#0f2747`;
  const time = doc.createElement("span");
  time.dataset.testid = "bubble-time";
  time.style.cssText = "display:flex;align-items:center;gap:6px;min-width:64px;font-variant-numeric:tabular-nums";
  const dot = doc.createElement("span");
  dot.style.cssText = "width:9px;height:9px;border-radius:50%;background:#ef4444;flex:none";
  const clock = doc.createElement("span");
  time.append(dot, clock);
  const button = (label: string, bg: string, fg: string) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = `border:0;border-radius:8px;padding:8px 12px;font:inherit;cursor:pointer;background:${bg};color:${fg}`;
    bar.append(b);
    return b;
  };
  bar.append(time);
  const pauseButton = button("Pause", "rgba(255,255,255,.15)", "#fff");
  pauseButton.dataset.testid = "bubble-pause";
  const stopButton = button("Stop", "#ff6f61", "#0f2747");
  stopButton.dataset.testid = "bubble-stop";
  pauseButton.onclick = () => (controls.state()?.paused ? controls.resume() : controls.pause());
  stopButton.onclick = () => controls.stop();
  doc.body.append(bar);
  const draw = () => {
    const now = controls.state();
    bar.style.visibility = now ? "visible" : "hidden";
    if (!now) return;
    const sec = Math.floor(now.ms / 1000);
    clock.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    dot.style.background = now.paused ? "#f59e0b" : "#ef4444";
    pauseButton.textContent = now.paused ? "Resume" : "Pause";
  };
  draw();
  const tick = setInterval(draw, 250);
  return () => clearInterval(tick);
}

export function stopAll(...streams: (MediaStream | null | undefined)[]) {
  for (const s of streams) s?.getTracks().forEach((t) => t.stop());
}
