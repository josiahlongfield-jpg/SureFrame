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

export async function getCamera(deviceId: string | undefined, q: Quality) {
  const { width, height } = dims(Math.min(q, 1080) as Quality);
  return navigator.mediaDevices.getUserMedia({
    video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 } },
    audio: false,
  });
}

/**
 * Camera and microphone in one request. iPhones only allow one capture at a
 * time, and asking for the mic separately while the camera is live can end
 * the camera track or crash the page.
 */
export async function getCameraAndMic(camId: string | undefined, micId: string | undefined, q: Quality) {
  const { width, height } = dims(Math.min(q, 1080) as Quality);
  return navigator.mediaDevices.getUserMedia({
    video: { deviceId: camId ? { exact: camId } : undefined, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 } },
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
export async function openCameraBubble(camera: MediaStream, onClosed?: () => void): Promise<(() => void) | null> {
  const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow(o: object): Promise<Window> } })
    .documentPictureInPicture;
  if (dpip) {
    try {
      const pip = await dpip.requestWindow({ width: 240, height: 240 });
      pip.document.body.style.cssText = "margin:0;background:#000;overflow:hidden";
      const v = pip.document.createElement("video");
      v.autoplay = true;
      v.muted = true;
      v.playsInline = true;
      v.srcObject = camera;
      v.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;transform:scaleX(-1)";
      pip.document.body.append(v);
      let closing = false;
      pip.addEventListener("pagehide", () => !closing && onClosed?.());
      return () => {
        closing = true;
        pip.close();
      };
    } catch {
      /* fall through */
    }
  }
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

export function stopAll(...streams: (MediaStream | null | undefined)[]) {
  for (const s of streams) s?.getTracks().forEach((t) => t.stop());
}
