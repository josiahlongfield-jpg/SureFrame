"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useVideoFrame } from "@/lib/videoFrame";
import { useRouter } from "next/navigation";
import MicLevel from "./MicLevel";
import ConfirmDialog from "./ConfirmDialog";
import * as store from "@/lib/recorder/store";
import { encryptFrame, fingerprint, generateKey, wrapKey } from "@/lib/e2e/crypto";
import { browserTimeZone } from "@/lib/schedule";
import { thumbFromTrack } from "@/lib/thumb";
import { ChunkedUploader, FatalUploadError, lockName, mayRecover, PART_BYTES, recoverInterrupted, type UploadState } from "@/lib/recorder/uploader";
import {
  bitrateFor,
  getCamera,
  getCameraAndMic,
  getMic,
  getScreen,
  mixAudio,
  openCameraBubble,
  pickMimeType,
  stopAll,
  type Mode,
  type Quality,
} from "@/lib/recorder/media";
import { CAMERA_CORNERS, CIRCLE, canComposeCamera, composeCamera, type CameraCorner } from "@/lib/recorder/compose";

type Phase = "setup" | "countdown" | "recording" | "paused" | "finishing";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "screen+camera", label: "Screen + Camera", hint: "Your screen, with your camera in a circle in the corner" },
  { id: "screen", label: "Screen only", hint: "Just your screen and voice" },
  { id: "camera", label: "Camera only", hint: "A face-to-camera message" },
];

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const NO_CAMERA = "No camera found on this device. If you've just plugged one in, it will appear here once your computer finds it.";
const CAMERA_BUSY = "Your camera is being used by another app, such as the Camera app, Zoom or Teams. Close that app and come back to this page.";
const CAMERA_PERMISSION = "Camera permission is needed for this mode. Allow it in your browser's address bar, or choose Screen only.";
const CAMERA_ERRORS = [NO_CAMERA, CAMERA_BUSY, CAMERA_PERMISSION];

export default function Recorder({
  maxResolution,
  maxDurationMin,
  freeVideos,
  teamKey,
}: {
  maxResolution: Quality;
  maxDurationMin: number;
  /** Free: how many of the plan's videos in total are left. */
  freeVideos: { left: number; limit: number } | null;
  teamKey: CryptoKey;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("screen+camera");
  const [quality, setQuality] = useState<Quality>(Math.min(1080, maxResolution) as Quality);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState<string>();
  const [micId, setMicId] = useState<string>();
  const [phase, setPhase] = useState<Phase>("setup");
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [upload, setUpload] = useState<UploadState>({ uploadedBytes: 0, bufferedBytes: 0, retrying: false });
  const [error, setError] = useState<string>();
  // The plan's videos are used up: the error links to the plans.
  const [upgrade, setUpgrade] = useState(false);
  // A recording holds a place from the moment it starts; one deleted before it finished gives it back.
  const [freeLeft, setFreeLeft] = useState(freeVideos?.left ?? null);
  const placeBack = () => setFreeLeft((n) => (n === null ? n : n + 1));
  const [notice, setNotice] = useState<string>();
  // Set once we know there's no camera: camera options then flash the notice instead of retrying.
  const [noCamera, setNoCamera] = useState(false);
  // Bumped to ask for the camera again (one was plugged in, or another app let go of it).
  const [camRetry, setCamRetry] = useState(0);
  const [flash, setFlash] = useState(0);
  const [recovered, setRecovered] = useState<string[]>([]);
  // "Discard and start over" asks first; the recording is paused meanwhile, and carries on if they keep it.
  const [confirmDiscard, setConfirmDiscard] = useState<{ wasRecording: boolean } | null>(null);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  // Recording the whole screen with the camera drawn in: no floating window, it would be recorded too.
  const [wholeScreen, setWholeScreen] = useState(false);
  // Phones and tablets can't share their screen from a browser, so they only get camera mode.
  const [canShareScreen, setCanShareScreen] = useState(true);
  // On a phone the screen modes are shown greyed, with why, even where the browser claims it could.
  const [phone, setPhone] = useState(false);
  // Firefox can neither draw the camera into the video nor float it over other windows.
  const [cameraWithScreen, setCameraWithScreen] = useState(true);
  // Where the camera circle sits in a Screen + camera recording (Josiah, 18 October 2026): bottom left unless the
  // person drags it or picks another corner, before or while recording. Remembered in this browser.
  const [corner, setCorner] = useState<CameraCorner>("bottom-left");
  const cornerNow = useRef(corner);
  const composer = useRef<{ move: (c: CameraCorner) => void } | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CORNER_KEY) as CameraCorner | null;
      if (saved && CAMERA_CORNERS.includes(saved)) setCorner(saved);
    } catch {}
  }, []);
  useEffect(() => {
    cornerNow.current = corner;
    composer.current?.move(corner);
    try {
      localStorage.setItem(CORNER_KEY, corner);
    } catch {}
  }, [corner]);
  useEffect(() => {
    setCameraWithScreen(canComposeCamera() || "documentPictureInPicture" in window || document.pictureInPictureEnabled === true);
  }, []);
  useEffect(() => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setCanShareScreen(false);
      setMode("camera");
      // Phones record 720p: lighter on memory and battery, and plenty for a phone screen.
      setQuality(720);
    } else if (isPhone()) {
      // A phone whose browser offers screen sharing still records with the camera: phone browsers can't record the screen in practice.
      setMode("camera");
      setPhone(true);
    }
  }, []);

  const preview = useRef<HTMLVideoElement>(null);
  // The camera preview takes the camera's own shape (portrait on most phones), so it fills its frame.
  const frame = useVideoFrame("70vh");
  const frameRef = frame.ref;
  const previewRef = useCallback(
    (v: HTMLVideoElement | null) => {
      preview.current = v;
      // The preview moves between the big frame and the small circle while recording.
      if (v && camStream.current && !v.srcObject) v.srcObject = camStream.current;
      frameRef(v);
    },
    [frameRef],
  );
  const camStream = useRef<MediaStream | null>(null);
  /** Why a recording ended on its own, if it did. */
  const failure = useRef<string>(undefined);
  /** Cancel pressed during the countdown. */
  const cancelled = useRef(false);
  const live = useRef<{
    recorder: MediaRecorder;
    uploader: ChunkedUploader;
    streams: MediaStream[];
    closeAudio: () => void;
    closeBubble: () => void;
    releaseLock: () => void;
    videoId: string;
    startedAt: number;
    accumulated: number;
    /** Chunks are encrypted in order before they are saved or uploaded. */
    sealing: Promise<void>;
    /** The recorder has been started (after the countdown). */
    started?: boolean;
    /** stop() has begun, so it runs once. */
    finishing?: boolean;
  } | null>(null);

  // Finish anything a previous crash left behind.
  useEffect(() => {
    recoverInterrupted((id, s) => setRecovered((r) => [...r, s.replyTo ?? id])).catch(() => {});
  }, []);

  const loadDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    setCams(all.filter((d) => d.kind === "videoinput"));
    setMics(all.filter((d) => d.kind === "audioinput"));
  }, []);

  // Camera preview while setting up.
  useEffect(() => {
    if (phase !== "setup" || mode === "screen") {
      if (phase === "setup") {
        setError(undefined);
        stopAll(camStream.current);
        camStream.current = null;
      }
      return;
    }
    let cancelled = false;
    getCamera(camId, quality)
      .then(async (s) => {
        if (cancelled) return stopAll(s);
        stopAll(camStream.current);
        camStream.current = s;
        if (preview.current) preview.current.srcObject = s;
        setError((e) => (e && CAMERA_ERRORS.includes(e) ? undefined : e));
        await loadDevices();
      })
      .catch((err: Error) => {
        if (cancelled) return;
        // No camera at all (common on desktop computers): fall back to recording the screen.
        if (err.name === "NotFoundError" && canShareScreen) {
          setMode("screen");
          setNoCamera(true);
          setNotice("No camera found, so Screen only is selected. You can still talk over your screen.");
          return;
        }
        setError(
          err.name === "NotFoundError"
            ? NO_CAMERA
            : err.name === "NotReadableError" || err.name === "AbortError"
              ? CAMERA_BUSY
              : CAMERA_PERMISSION,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [mode, camId, quality, phase, loadDevices, canShareScreen, camRetry]);

  // A camera plugged in (or freed by another app) after the page opened: pick it up without a reload.
  useEffect(() => {
    if (phase !== "setup") return;
    const cameraDown = () => {
      const track = camStream.current?.getVideoTracks()[0];
      return !track || track.readyState === "ended";
    };
    const onDeviceChange = async () => {
      const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const found = all.filter((d) => d.kind === "videoinput");
      setCams(found);
      setMics(all.filter((d) => d.kind === "audioinput"));
      setCamId((id) => (id && !found.some((d) => d.deviceId === id) ? undefined : id));
      if (found.length > 0 && noCamera) {
        setNoCamera(false);
        setMode("screen+camera");
        setNotice("Camera found, so Screen and camera is selected again.");
      } else if (mode !== "screen" && cameraDown()) {
        setCamRetry((n) => n + 1);
      }
    };
    // Coming back to the tab after closing another app that had the camera.
    const onFocus = () => {
      if (mode !== "screen" && cameraDown()) setCamRetry((n) => n + 1);
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    window.addEventListener("focus", onFocus);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [phase, mode, noCamera]);

  useEffect(() => {
    getMic(undefined)
      .then((s) => {
        stopAll(s);
        return loadDevices();
      })
      .catch(() => setError("Microphone permission is needed to record. Allow it in your browser's address bar."));
    return () => stopAll(camStream.current);
  }, [loadDevices]);

  // Timer + plan duration limit.
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      const l = live.current;
      if (!l) return;
      const ms = l.accumulated + (performance.now() - l.startedAt);
      setElapsed(ms);
      if (ms >= maxDurationMin * 60_000) void stop();
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, maxDurationMin]);

  // Warn before closing the tab mid-recording (recovery still has the data).
  useEffect(() => {
    if (phase === "setup") return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [phase]);

  function durationNow() {
    const l = live.current;
    if (!l) return 0;
    return Math.round(l.accumulated + (l.recorder.state === "recording" ? performance.now() - l.startedAt : 0));
  }

  async function start() {
    setError(undefined);
    // The "finished uploading" note is from before; it doesn't stay up during the next recording.
    setRecovered([]);
    setWholeScreen(false);
    // Setup notices (no camera, camera found) don't carry into the recording.
    if (!noCamera) setNotice(undefined);
    setUpgrade(false);
    failure.current = undefined;
    cancelled.current = false;
    const streams: MediaStream[] = [];
    let bubble: (() => void) | null = null;
    let composed: { close: () => void } | null = null;
    // The shared screen itself: sharing stopped before recording begins means there's nothing to record.
    let shared: MediaStreamTrack | undefined;
    // Set once the server has a video for this take, so a failed start can remove it again.
    let made: { videoId: string; releaseLock: () => void } | undefined;
    try {
      let video: MediaStreamTrack;
      if (mode === "camera") {
        // One request for both, replacing the preview (see getCameraAndMic).
        stopAll(camStream.current);
        const both = await getCameraAndMic(camId, micId, quality);
        camStream.current = both;
        if (preview.current) preview.current.srcObject = new MediaStream(both.getVideoTracks());
        streams.push(new MediaStream(both.getAudioTracks()));
        video = both.getVideoTracks()[0];
      } else {
        // The bubble first, while the click still counts: browsers won't open one after the screen picker.
        if (mode === "screen+camera" && camStream.current) {
          bubble = await openCameraBubble(camStream.current, () => setBubbleOpen(false));
          setBubbleOpen(!!bubble);
        }
        streams.push(await getMic(micId));
        const screen = await getScreen(quality);
        streams.push(screen);
        video = screen.getVideoTracks()[0];
        shared = video;
        // The browser's own "Stop sharing" button ends the recording cleanly.
        video.addEventListener("ended", () => void stop());
        // The camera goes into the video as a circle in the chosen corner, whatever was shared.
        const camTrack = camStream.current?.getVideoTracks()[0];
        if (mode === "screen+camera" && camTrack && canComposeCamera()) {
          const c = composeCamera(video, camTrack, cornerNow.current, () =>
            setNotice("Your camera stopped, so the recording carries on with your screen only."),
          );
          composed = c;
          composer.current = c;
          video = c.track;
          // A whole-screen share would also record the floating window, title bar and all, so the camera
          // showed twice. The circle drawn into the video is the camera then, and you see yourself on this tab.
          if ((shared.getSettings() as { displaySurface?: string }).displaySurface === "monitor") {
            bubble?.();
            bubble = null;
            setBubbleOpen(false);
            setWholeScreen(true);
          }
        }
      }
      const audio = mixAudio(streams);
      const tracks = [video, ...(audio.track ? [audio.track] : [])];
      const mimeType = pickMimeType();
      // A fresh key for this recording; the server only gets it wrapped with the team key.
      const videoKey = await generateKey();

      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mimeType,
          // Named in the recorder's own time, not the server's.
          title: `Recording ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
          timeZone: browserTimeZone(),
          teamKeyWrap: await wrapKey(videoKey, teamKey),
          keyFingerprint: await fingerprint(teamKey),
        }),
      });
      const data = await res.json();
      if (res.status === 402) {
        setUpgrade(true);
        setFreeLeft((n) => (n === null ? n : 0));
      }
      if (!res.ok) throw new Error(data.error ?? "Could not start recording");
      const videoId: string = data.video.id;
      setFreeLeft((n) => (n === null ? n : Math.max(0, n - 1)));

      made = { videoId, releaseLock: () => {} };
      await store.putSession({ videoId, title: data.video.title, mimeType, startedAt: Date.now(), nextPart: 1, durationMs: 0, stopped: false });

      let releaseLock = () => {};
      await new Promise<void>((held) => {
        navigator.locks.request(lockName(videoId), () => new Promise<void>((release) => {
          releaseLock = release;
          held();
        }));
      });
      made.releaseLock = releaseLock;

      const closeBubble = bubble ?? (() => {});

      const uploader = new ChunkedUploader(videoId, {}, setUpload);
      const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: bitrateFor(quality) });
      recorder.ondataavailable = (e) => {
        const l = live.current;
        if (!l || e.data.size === 0) return;
        // Encrypt on this device before the chunk is stored or sent anywhere.
        l.sealing = l.sealing
          .then(() => encryptFrame(e.data, videoKey))
          .then((frame) => uploader.push(new Blob([frame as BlobPart])))
          .then(() => store.updateSession(videoId, { durationMs: durationNow() }).catch(() => {}))
          .catch((err) => {
            // A chunk that can't be sealed would leave a gap, so the recording ends here and what came before is kept.
            console.error("Recording chunk failed", err);
            failure.current = "This browser hit a problem, so the recording stopped. What was recorded before that has been kept.";
            void stop();
          });
      };
      recorder.onerror = () => {
        failure.current = "The browser stopped the recorder. What was recorded before that has been kept.";
        void stop();
      };

      live.current = { recorder, uploader, streams, closeAudio: () => {
        audio.close();
        composed?.close();
        composer.current = null;
      }, closeBubble, releaseLock, videoId, startedAt: 0, accumulated: 0, sealing: Promise.resolve() };

      setPhase("countdown");
      for (let n = 3; n > 0; n--) {
        setCount(n);
        await new Promise((r) => setTimeout(r, 1000));
        if (cancelled.current || shared?.readyState === "ended") throw new DOMException("Cancelled during the countdown", "AbortError");
      }
      recorder.start(2000);
      live.current.started = true;
      live.current.startedAt = performance.now();
      setPhase("recording");
      // The library still, from a moment into the recording; if this misses, opening the video makes one.
      const still = video;
      setTimeout(() => {
        if (still.readyState === "live") void thumbFromTrack(videoId, still, videoKey).catch(() => {});
      }, 1500);
    } catch (err) {
      stopAll(...streams);
      composed?.close();
      composer.current = null;
      bubble?.();
      setBubbleOpen(false);
      cleanup();
      live.current = null;
      // Nothing was recorded: don't leave an empty "Incomplete upload" behind.
      if (made) {
        await store.removeSession(made.videoId).catch(() => {});
        const removed = await fetch(`/api/videos/${made.videoId}`, { method: "DELETE" }).catch(() => null);
        if (removed?.ok) placeBack();
        made.releaseLock();
      }
      setPhase("setup");
      const name = (err as Error).name;
      if (name !== "NotAllowedError" && name !== "AbortError") setError((err as Error).message);
    }
  }

  function pause() {
    const l = live.current;
    if (!l || l.recorder.state !== "recording") return;
    l.recorder.pause();
    l.accumulated += performance.now() - l.startedAt;
    setPhase("paused");
  }

  function resume() {
    const l = live.current;
    if (!l || l.recorder.state !== "paused") return;
    l.recorder.resume();
    l.startedAt = performance.now();
    setPhase("recording");
  }

  async function stop() {
    const l = live.current;
    // Not started yet: during the countdown there's nothing to finish (start() handles a share that ends then).
    if (!l || !l.started || l.finishing) return;
    l.finishing = true;
    const durationMs = durationNow();
    setPhase("finishing");
    // A recorder the browser has already stopped (after an error) is finished off the same way.
    if (l.recorder.state !== "inactive") {
      const stopped = new Promise<void>((r) => l.recorder.addEventListener("stop", () => r(), { once: true }));
      l.recorder.stop();
      await stopped;
    }
    await l.sealing;
    cleanup();
    try {
      await store.updateSession(l.videoId, { durationMs, stopped: true }).catch(() => {});
      await l.uploader.finish(durationMs);
      if (failure.current) {
        setError(`${failure.current} You'll find it in your library.`);
        setPhase("setup");
      } else router.push(`/v/${l.videoId}?new=1`);
    } catch (err) {
      setError(
        err instanceof FatalUploadError && !mayRecover(err)
          ? (err as Error).message
          : `${(err as Error).message}. Your recording is kept in this browser and will finish uploading next time you open SureFrame here.`,
      );
      setPhase("setup");
    } finally {
      l.releaseLock();
      live.current = null;
    }
  }

  async function discard() {
    setConfirmDiscard(null);
    const l = live.current;
    if (!l) return;
    l.recorder.ondataavailable = null;
    if (l.recorder.state !== "inactive") l.recorder.stop();
    cleanup();
    await store.removeSession(l.videoId);
    const removed = await fetch(`/api/videos/${l.videoId}`, { method: "DELETE" }).catch(() => null);
    if (removed?.ok) placeBack();
    l.releaseLock();
    live.current = null;
    setElapsed(0);
    setPhase("setup");
  }

  function askDiscard() {
    const wasRecording = phase === "recording";
    if (wasRecording) pause();
    setConfirmDiscard({ wasRecording });
    // Closing the browser with this question open counts as discarding: recovery deletes it rather than uploading it.
    const l = live.current;
    if (l) void store.updateSession(l.videoId, { discarding: true }).catch(() => {});
  }

  function keepRecording() {
    if (confirmDiscard?.wasRecording) resume();
    setConfirmDiscard(null);
    const l = live.current;
    if (l) void store.updateSession(l.videoId, { discarding: false }).catch(() => {});
  }

  function cleanup() {
    const l = live.current;
    if (!l) return;
    stopAll(...l.streams);
    l.closeAudio();
    l.closeBubble();
    setBubbleOpen(false);
  }

  async function popOutBubble() {
    if (!camStream.current || !live.current) return;
    const close = await openCameraBubble(camStream.current, () => setBubbleOpen(false));
    if (!close) return;
    live.current.closeBubble = close;
    setBubbleOpen(true);
  }

  const recordingish = phase === "recording" || phase === "paused";
  // Only Camera only shows the camera full size. Screen + camera shows it where the video will: a circle in its corner.
  const bigCamera = mode === "camera";
  const allowedQualities = ([720, 1080, 2160] as Quality[]).filter((q) => q <= maxResolution);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_21.25rem]">
      <div
        style={bigCamera ? frame.style : undefined}
        className={`relative mx-auto overflow-hidden rounded-2xl border border-line bg-solid shadow-sm ${bigCamera ? "" : "aspect-video w-full"}`}
      >
        {bigCamera ? (
          <video ref={previewRef} autoPlay muted playsInline className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-dim" data-testid="screen-panel">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
            <p className="text-sm">
              {phase === "setup"
                ? mode === "screen+camera"
                  ? "You\u2019ll pick a screen, window or tab when you start. Your camera goes in the circle: drag it to any corner."
                  : "You\u2019ll pick a screen, window or tab when you start."
                : mode === "screen"
                  ? "Recording your screen."
                  : wholeScreen
                    ? "Recording your whole screen. Your camera is in the circle in the corner of the video. Drag it to move it."
                    : bubbleOpen
                      ? "Recording your screen. Your camera is in the floating bubble."
                      : "Recording your screen. Pop out the camera bubble to show your camera over your other windows."}
            </p>
          </div>
        )}
        {mode === "screen+camera" && (
          <CameraCircle corner={corner} onCorner={setCorner}>
            <video ref={previewRef} autoPlay muted playsInline className="h-full w-full -scale-x-100 rounded-full object-cover" />
          </CameraCircle>
        )}
        {phase === "countdown" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black/60 text-white">
            <span className="text-8xl font-semibold">{count}</span>
            <button onClick={() => (cancelled.current = true)} className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium hover:bg-white/25">Cancel</button>
          </div>
        )}
        {recordingish && (
          // Out of the camera's way when it sits top left.
          <div className={`absolute top-4 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-sm font-medium text-white ${mode === "screen+camera" && corner === "top-left" ? "right-4" : "left-4"}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${phase === "recording" ? "animate-pulse bg-red-500" : "bg-amber-400"}`} />
            {phase === "paused" ? "Paused" : "Recording"} · {fmt(elapsed)}
          </div>
        )}
      </div>

      <aside className="flex min-w-0 flex-col gap-5">
        {recovered.length > 0 && phase === "setup" && (
          <div className="flex items-start gap-3 rounded-xl border border-ok-line bg-ok-bg p-3 text-sm text-ok-fg" data-testid="recorder-recovered">
            <p className="min-w-0 flex-1">
              {recovered.length === 1 ? "We finished uploading a recording that was interrupted." : `We finished uploading ${recovered.length} recordings that were interrupted.`}{" "}
              <a className="font-medium underline" href={recovered.length === 1 ? `/v/${recovered[0]}` : "/library"}>{recovered.length === 1 ? "View it" : "See your library"}</a>
            </p>
            <button onClick={() => setRecovered([])} aria-label="Dismiss" className="shrink-0">✕</button>
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-xl border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg">
            {error}
            {upgrade && (
              <>
                {" "}
                <a href="/pricing" className="font-medium underline">See plans</a>
              </>
            )}
          </div>
        )}
        {notice && !error && (phase === "setup" || recordingish) && (
          <div key={flash} className={`rounded-xl border border-line bg-canvas p-3 text-sm text-muted ${flash ? "notice-flash" : ""}`}>{notice}</div>
        )}

        {phase === "setup" && (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-semibold text-ink">What do you want to record?</legend>
              {MODES.map((m) => {
                // Phones (and browsers without screen sharing) show the screen modes greyed, so it's plain why there's only one.
                const off = m.id !== "camera" && (phone || !canShareScreen);
                return (
                  <label
                    key={m.id}
                    aria-disabled={off || undefined}
                    data-testid={`mode-${m.id}`}
                    className={`rounded-xl border p-3 transition ${off ? "cursor-not-allowed border-line opacity-50" : "cursor-pointer"} ${!off && noCamera && m.id !== "screen" ? "opacity-60 " : ""}${mode === m.id ? "border-primary bg-primary-soft ring-1 ring-primary" : off ? "" : "border-line hover:border-line-strong"}`}
                  >
                    <input type="radio" name="mode" className="sr-only" disabled={off} checked={mode === m.id} onChange={() => (noCamera && m.id !== "screen" ? setFlash((n) => n + 1) : setMode(m.id))} />
                    <span className="block text-sm font-medium text-ink">{m.label}</span>
                    <span className="block text-xs text-dim">{m.hint}</span>
                  </label>
                );
              })}
              {(phone || !canShareScreen) && (
                <p className="text-xs text-dim" data-testid="screen-modes-note">Recording your screen needs a computer. On a phone or tablet, record with your camera.</p>
              )}
              {mode === "screen+camera" && !cameraWithScreen && (
                <p className="text-xs text-warn-fg">This browser can&rsquo;t put your camera in a screen recording. Use Chrome, Edge or Brave, or choose Camera only.</p>
              )}
            </fieldset>
            {mode === "screen+camera" && <CornerPicker corner={corner} onCorner={setCorner} />}

            <div className="grid gap-3 text-sm">
              {mode !== "screen" && (
                <label className="grid gap-1">
                  <span className="font-medium text-muted">Camera</span>
                  <select className="w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 py-2" value={camId ?? ""} onChange={(e) => setCamId(e.target.value || undefined)}>
                    <option value="">Default camera</option>
                    {cams.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Camera"}</option>)}
                  </select>
                </label>
              )}
              <label className="grid gap-1">
                <span className="font-medium text-muted">Microphone</span>
                <select className="w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 py-2" value={micId ?? ""} onChange={(e) => setMicId(e.target.value || undefined)}>
                  <option value="">Default microphone</option>
                  {mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>)}
                </select>
              </label>
              {phase === "setup" && <MicLevel deviceId={micId} />}
              {allowedQualities.length > 1 ? (
                <label className="grid gap-1">
                  <span className="font-medium text-muted">Quality</span>
                  <select className="w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 py-2" value={quality} onChange={(e) => setQuality(Number(e.target.value) as Quality)}>
                    {allowedQualities.map((q) => <option key={q} value={q}>{q === 2160 ? "4K" : `${q}p`}</option>)}
                  </select>
                </label>
              ) : (
                // Only one choice on Free, so no dropdown: just what it records in.
                <p className="text-xs text-dim" data-testid="quality-note">
                  {maxResolution}p on Free. <a href="/pricing" className="font-medium text-accent hover:underline">Upgrade to a paid plan</a> for 1080p and 4K.
                </p>
              )}
            </div>

            <button onClick={start} className="rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary shadow-sm hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              Start recording
            </button>
            {/* Said before Start, not only once recording: how long a video can be, and what happens at the limit. */}
            <p className="text-sm text-muted" data-testid="length-limit">
              Videos on your plan can be up to {limitText(maxDurationMin)}. At {limitClock(maxDurationMin)} the recording stops and is saved by itself.
            </p>
            {freeVideos && freeLeft !== null && (
              <p className="text-sm text-muted" data-testid="free-videos-left">
                {freeLeft} of {freeVideos.limit} free videos left.{" "}
                {freeLeft <= 5 && <a href="/pricing" className="font-medium text-accent hover:underline">See plans</a>}
              </p>
            )}
            <p className="text-xs text-dim">
              Your recording uploads while you talk. Until it&rsquo;s safely up, a copy is kept in this browser, so after a crash or dropped connection it picks up where it left off.
            </p>
          </>
        )}

        {recordingish && (
          <>
            <div className="flex gap-2">
              {phase === "recording" ? (
                <button onClick={pause} className="flex-1 rounded-xl border border-line-strong px-4 py-3 font-medium hover:bg-hover">Pause</button>
              ) : (
                <button onClick={resume} className="flex-1 rounded-xl border border-line-strong px-4 py-3 font-medium hover:bg-hover">Resume</button>
              )}
              <button onClick={stop} className="flex-1 rounded-xl bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700">Stop</button>
            </div>
            {mode === "screen+camera" && <CornerPicker corner={corner} onCorner={setCorner} />}
            {mode === "screen+camera" && !bubbleOpen && !wholeScreen && (
              <button onClick={popOutBubble} className="rounded-xl border border-line-strong px-4 py-2 text-sm hover:bg-hover">Pop out camera bubble</button>
            )}
            <button onClick={askDiscard} className="text-sm text-dim underline-offset-2 hover:underline">Discard and start over</button>
            <UploadBadge s={upload} />
            {confirmDiscard && (
              <ConfirmDialog
                title="Discard this recording?"
                body={
                  <p>
                    What you&rsquo;ve recorded so far is deleted and can&rsquo;t be brought back.
                    {freeVideos ? " It doesn't count towards your free videos." : ""}
                  </p>
                }
                confirmLabel="Discard recording"
                cancelLabel="Keep recording"
                danger
                onConfirm={() => void discard()}
                onCancel={keepRecording}
                testId="discard-confirm"
              />
            )}
            <p className="text-xs text-dim">
              Limit on your plan: {limitText(maxDurationMin)}. It stops and saves by itself at {limitClock(maxDurationMin)}.
            </p>
          </>
        )}

        {phase === "finishing" && (
          <div className="flex items-center gap-3 rounded-xl border border-line p-4 text-sm">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Finishing upload… your link will open in a moment.
          </div>
        )}
      </aside>
    </div>
  );
}

const CORNER_KEY = "sureframe.cameraCorner";
const CORNER_LABEL: Record<CameraCorner, string> = { "top-left": "Top left", "top-right": "Top right", "bottom-left": "Bottom left", "bottom-right": "Bottom right" };

/**
 * The camera preview in Screen + camera: the same size and corner as the circle drawn into the video
 * (lib/recorder/compose.ts), on a 16:9 panel, so the inset across is the inset down times 9/16. Drag it and it
 * snaps to the nearest corner when let go; the recording follows from the next frame.
 */
function CameraCircle({ corner, onCorner, children }: { corner: CameraCorner; onCorner: (c: CameraCorner) => void; children: ReactNode }) {
  const [drag, setDrag] = useState<{ x0: number; y0: number; dx: number; dy: number } | null>(null);
  const inset = CIRCLE.inset * 100;
  const place = {
    [corner.startsWith("top") ? "top" : "bottom"]: `${inset}%`,
    [corner.endsWith("left") ? "left" : "right"]: `${(inset * 9) / 16}%`,
  };
  return (
    <div
      role="img"
      aria-label={`Your camera, ${CORNER_LABEL[corner].toLowerCase()}. Drag to move it.`}
      title="Drag to move your camera"
      data-testid="camera-circle"
      data-corner={corner}
      style={{ height: `${CIRCLE.size * 100}%`, ...place, transform: drag ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined }}
      className={`absolute z-10 aspect-square touch-none select-none rounded-full ring-2 ring-white/90 ${drag ? "cursor-grabbing" : "cursor-grab transition-[top,bottom,left,right] duration-200"}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 });
      }}
      onPointerMove={(e) => drag && setDrag({ ...drag, dx: e.clientX - drag.x0, dy: e.clientY - drag.y0 })}
      onPointerUp={(e) => {
        if (!drag) return;
        // The corner nearest where the middle of the circle was let go.
        const panel = e.currentTarget.parentElement!.getBoundingClientRect();
        const me = e.currentTarget.getBoundingClientRect();
        const cx = me.left + me.width / 2 - panel.left, cy = me.top + me.height / 2 - panel.top;
        onCorner(`${cy < panel.height / 2 ? "top" : "bottom"}-${cx < panel.width / 2 ? "left" : "right"}`);
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {children}
    </div>
  );
}

/** The same choice without dragging: four corners, also while recording. */
function CornerPicker({ corner, onCorner }: { corner: CameraCorner; onCorner: (c: CameraCorner) => void }) {
  return (
    <div className="grid gap-1 text-sm" role="group" aria-labelledby="corner-label" data-testid="corner-picker">
      <span id="corner-label" className="font-medium text-muted">Camera position</span>
      <div className="grid grid-cols-2 gap-1.5">
        {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={corner === c}
            onClick={() => onCorner(c)}
            data-testid={`corner-${c}`}
            className={`rounded-lg border px-2 py-1.5 text-xs ${corner === c ? "border-primary bg-primary-soft font-medium text-ink ring-1 ring-primary" : "border-line-strong text-muted hover:bg-hover"}`}
          >
            {CORNER_LABEL[c]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "5 minutes", "4 hours" */
const limitText = (min: number) => (min % 60 === 0 && min >= 60 ? `${min / 60} hour${min === 60 ? "" : "s"}` : `${min} minutes`);
/** "5:00" as the recording's clock shows it; "4 hours" for the long ones. */
const limitClock = (min: number) => (min >= 60 ? limitText(min) : `${min}:00`);

/** A phone (not a tablet or computer): a touch screen with no mouse, small on its shorter side. */
function isPhone() {
  const ua = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (ua.userAgentData?.mobile) return true;
  return /iPhone|Android.+Mobile|Mobi/i.test(navigator.userAgent) || (matchMedia("(pointer: coarse) and (hover: none)").matches && Math.min(screen.width, screen.height) < 600);
}

function UploadBadge({ s }: { s: UploadState }) {
  if (s.error) return <p className="text-sm text-danger-fg">{s.error}</p>;
  if (s.retrying)
    return (
      <p className="text-sm text-warn-fg">
        {s.unsaved
          ? "Connection lost and this browser's storage is full. Keep this page open; the upload resumes when you're back online."
          : "Connection lost. Still recording and saving locally; upload resumes automatically."}
      </p>
    );
  return (
    <p className="text-sm text-ok-fg">
      Uploaded: {(s.uploadedBytes / 1024 / 1024).toFixed(1)} MB
      {s.bufferedBytes > 0 && <span className="text-dim"> (+{(s.bufferedBytes / 1024 / 1024).toFixed(1)} MB on device)</span>}
      {/* Short takes go up in one piece at the end, so a still 0.0 isn't a stuck upload. */}
      {s.uploadedBytes === 0 && (
        <span className="block text-xs text-dim">It goes up in {Math.round(PART_BYTES / 1024 / 1024)} MB pieces while you record, and the rest when you stop. Until then it&rsquo;s kept safe in this browser.</span>
      )}
    </p>
  );
}
