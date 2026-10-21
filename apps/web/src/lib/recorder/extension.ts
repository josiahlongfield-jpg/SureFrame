/**
 * The SureFrame browser extension (Chrome, Edge, Brave and other Chromium browsers), when it's installed: it shows
 * the camera bubble and a Pause/Stop bar on every web page while this tab records the screen. It never records
 * anything itself. This tab keeps doing all the recording, encrypting and uploading, and keeps working the same if
 * the extension is missing, turned off or stops answering.
 *
 * Messages go through window.postMessage to the extension's script on this page (apps/extension/src/bridge.js).
 */

const TO = "to-extension";
const FROM = "from-extension";

type FromExtension =
  | { type: "hello"; version: string }
  | { type: "command"; id: string; action: "pause" | "resume" | "stop" }
  | { type: "health"; id: string; onScreen: boolean; anywhere: boolean };

const post = (msg: object) => window.postMessage({ sureframe: TO, ...msg }, location.origin);

function listen(on: (msg: FromExtension) => void) {
  const handler = (e: MessageEvent) => {
    if (e.source !== window || e.origin !== location.origin || e.data?.sureframe !== FROM) return;
    on(e.data as FromExtension);
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

/**
 * Calls `onVersion` with the extension's version when it's here (now, or later if it's installed or updated while
 * the page is open). Returns a function that stops listening.
 */
export function watchExtension(onVersion: (version: string) => void) {
  const stop = listen((m) => m.type === "hello" && typeof m.version === "string" && onVersion(m.version));
  post({ type: "hello" });
  return stop;
}

export type ExtensionMode = "screen+camera" | "screen";
export type Phase = "starting" | "recording" | "paused";

/** Whether the camera bubble is on screen: in the browser window in front, or anywhere at all (for a shared tab). */
export type BubbleHealth = { onScreen: boolean; anywhere: boolean };

/**
 * One recording's bubble. `update()` tells the extension where the recording is up to (call it on every change and
 * with every saved piece, as a heartbeat); `end()` takes the bubble away.
 */
export function bubbleRecording(
  rec: { id: string; mode: ExtensionMode; cameraLabel?: string },
  on: { command: (action: "pause" | "resume" | "stop") => void; health?: (h: BubbleHealth) => void; hello?: () => void },
) {
  let last: { phase: Phase; ms: number } = { phase: "starting", ms: 0 };
  let ended = false;
  const send = () =>
    !ended &&
    post({
      type: "recording",
      rec: { id: rec.id, mode: rec.mode, camera: rec.cameraLabel ? { label: rec.cameraLabel } : null, phase: last.phase, ms: last.ms, at: Date.now() },
    });
  const stop = listen((m) => {
    if (ended) return;
    if (m.type === "command" && m.id === rec.id) on.command(m.action);
    else if (m.type === "health" && m.id === rec.id) on.health?.({ onScreen: !!m.onScreen, anywhere: !!m.anywhere });
    // The extension was updated or reinstalled mid-recording: tell its new copy about this recording.
    else if (m.type === "hello") {
      send();
      on.hello?.();
    }
  });
  send();
  return {
    update(phase: Phase, ms: number) {
      last = { phase, ms };
      send();
    },
    end() {
      if (ended) return;
      ended = true;
      stop();
      post({ type: "end" });
    },
  };
}
