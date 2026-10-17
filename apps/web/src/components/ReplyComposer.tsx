"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as store from "@/lib/recorder/store";
import { ChunkedUploader, FatalUploadError, lockName, mayRecover, type UploadState } from "@/lib/recorder/uploader";
import { bitrateFor, pickMimeType, stopAll } from "@/lib/recorder/media";
import { encryptFrame, encryptText, generateKey, wrapKey } from "@/lib/e2e/crypto";
import type { ReplyDTO } from "@/lib/replies";
import MicLevel from "./MicLevel";
import MediaPlayer from "./MediaPlayer";
import { useVideoFrame } from "@/lib/videoFrame";

type Mode = "TEXT" | "VIDEO" | "AUDIO";
/**
 * A video or voice reply goes preview (camera/mic on) → recording → review (played back on this device
 * while its upload finishes; nobody else can see it yet) → sent. Re-record and Discard delete it.
 */
type Phase = "idle" | "preview" | "recording" | "review" | "sending" | "sent";

/** AAC first, as it plays everywhere (see CANDIDATE_TYPES in media.ts). */
const AUDIO_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/mp4", "audio/webm"];

function pickAudioType() {
  return AUDIO_TYPES.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "audio/webm";
}

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Deletes one of the viewer's own replies (and its recording) from the conversation. */
export async function deleteReply(videoId: string, replyId: string) {
  const res = await fetch(`/api/videos/${videoId}/replies/${replyId}`, { method: "DELETE" }).catch(() => null);
  return !!res && (res.ok || res.status === 404);
}

/** Sends a video or voice reply its author has reviewed. */
export async function sendHeldReply(videoId: string, replyId: string): Promise<{ reply?: ReplyDTO; error?: string }> {
  const res = await fetch(`/api/videos/${videoId}/replies/${replyId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ send: true }),
  }).catch(() => null);
  const data = await res?.json().catch(() => ({}));
  if (!res?.ok) return { error: data?.error ?? "Couldn't send your reply. Check your connection and try again." };
  return { reply: data.reply };
}

export type ReplyComposerHandle = {
  /** Stops and throws away a recording in progress (closing the conversation mid-recording). */
  discard: () => Promise<void>;
};

type Props = {
  videoId: string;
  /** The conversation's video key: seals text replies and wraps each reply's media key. */
  conversationKey: CryptoKey;
  currentTimeMs: () => number | undefined;
  onReplied: (r: ReplyDTO) => void;
  /** Told when a voice/video reply starts and stops recording, so it isn't closed away without asking. */
  onBusyChange?: (busy: boolean) => void;
  /** The composer is out of sight (the phone conversation sheet is closed): let go of the camera and mic unless recording. */
  offscreen?: boolean;
  /** What "Sent" means for this viewer: who sees it now, and whether anyone is told (true to what the server does). */
  sentNote: string;
};

const ReplyComposer = forwardRef<ReplyComposerHandle, Props>(function ReplyComposer(
  { videoId, conversationKey, currentTimeMs, onReplied, onBusyChange, offscreen = false, sentNote },
  ref,
) {
  const [mode, setMode] = useState<Mode>("TEXT");
  // The open camera/mic stream, so the microphone level bar can follow it.
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [text, setText] = useState("");
  const [textBusy, setTextBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [facing, setFacing] = useState<"user" | "environment">("user");
  // Flip camera only where there's another camera to flip to (phones, mostly).
  const [cameras, setCameras] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [upload, setUpload] = useState<UploadState>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [maxMs, setMaxMs] = useState(15 * 60_000);
  const [session, setSession] = useState(0);
  // The recording under review: played back from this device's own copy while its upload finishes.
  const [review, setReview] = useState<{ url: string; kind: "VIDEO" | "AUDIO"; uploaded: boolean } | null>(null);

  const preview = useRef<HTMLVideoElement>(null);
  // The camera preview takes the camera's own shape (portrait on most phones), so it fills its frame.
  const frame = useVideoFrame("55vh");
  const frameRef = frame.ref;
  const previewRef = useCallback(
    (v: HTMLVideoElement | null) => {
      preview.current = v;
      frameRef(v);
    },
    [frameRef],
  );
  const stream = useRef<MediaStream | null>(null);
  const live = useRef<{
    recorder: MediaRecorder;
    uploader: ChunkedUploader;
    mediaId: string;
    replyId: string;
    startedAt: number;
    release: () => void;
    sealing: Promise<void>;
    /** What was recorded, unencrypted and only on this device, for playing it back before sending. */
    raw: Blob[];
    /** The upload finishing, once stopped: true when it's all on the server. */
    finishing?: Promise<boolean>;
    discarded?: boolean;
  } | null>(null);

  // Live camera/mic preview while a media mode is selected.
  // Re-acquired when the mode or camera changes, and after each sent or re-recorded reply.
  useEffect(() => {
    if (mode === "TEXT") return;
    let cancelled = false;
    setPhase("idle");
    setError(undefined);
    navigator.mediaDevices
      .getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: mode === "VIDEO" ? { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } : false,
      })
      .then((s) => {
        if (cancelled) return stopAll(s);
        stopAll(stream.current);
        stream.current = s;
        setLiveStream(s);
        if (preview.current) preview.current.srcObject = s;
        setPhase("preview");
        // The list of cameras is only complete once access is allowed.
        if (mode === "VIDEO") {
          navigator.mediaDevices.enumerateDevices().then((d) => setCameras(d.filter((x) => x.kind === "videoinput").length), () => {});
        }
      })
      .catch(() => setError(`Allow ${mode === "VIDEO" ? "camera and microphone" : "microphone"} access in your browser to record a reply.`));
    return () => {
      cancelled = true;
    };
  }, [mode, facing, session]);

  const releaseCamera = useCallback(() => {
    stopAll(stream.current);
    stream.current = null;
    setLiveStream(null);
  }, []);

  // Release the camera when leaving media modes or unmounting.
  useEffect(() => {
    if (mode === "TEXT") {
      releaseCamera();
      setPhase("idle");
    }
  }, [mode, releaseCamera]);
  useEffect(() => () => stopAll(stream.current), []);
  useEffect(() => () => void (review && URL.revokeObjectURL(review.url)), [review]);

  const recording = phase === "recording";
  useEffect(() => onBusyChange?.(recording), [recording, onBusyChange]);
  // Hidden away with only a camera preview open: back to text, which turns the camera and mic off.
  // A recording under review stays, ready to send when they come back.
  useEffect(() => {
    if (offscreen && (phase === "preview" || phase === "idle" || phase === "sent")) setMode("TEXT");
  }, [offscreen, phase]);

  useEffect(() => {
    if (phase !== "recording") return;
    let saved = 0;
    const t = setInterval(() => {
      const ms = performance.now() - (live.current?.startedAt ?? performance.now());
      setElapsed(ms);
      // Kept with the local copy, so a reply cut short by a closed browser comes back the right length.
      if (live.current && ms - saved > 5000) {
        saved = ms;
        void store.updateSession(live.current.mediaId, { durationMs: Math.round(ms) }).catch(() => {});
      }
      if (ms >= maxMs) void stop();
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, maxMs]);

  async function sendText(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setTextBusy(true);
    setError(undefined);
    const res = await fetch(`/api/videos/${videoId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "TEXT", body: await encryptText(text, conversationKey), encrypted: true, timestampMs: currentTimeMs() }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setTextBusy(false);
    if (!res?.ok) return setError(data?.error ?? "Couldn't send your reply. Check your connection and try again.");
    setText("");
    onReplied(data.reply);
  }

  async function start() {
    if (!stream.current) return;
    setError(undefined);
    setNotice(undefined);
    const kind = mode === "VIDEO" ? "VIDEO" : "AUDIO";
    const mimeType = kind === "VIDEO" ? pickMimeType() : pickAudioType();
    const mediaKey = await generateKey();
    const res = await fetch(`/api/videos/${videoId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Held for review: nobody else sees it until they press Send.
      body: JSON.stringify({ kind, mimeType, parentKeyWrap: await wrapKey(mediaKey, conversationKey), review: true }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) return setError(data?.error ?? "Couldn't start your reply. Check your connection and try again.");
    setMaxMs(data.maxDurationMin * 60_000);
    const mediaId: string = data.mediaId;

    await store.putSession({
      videoId: mediaId,
      title: "Reply",
      mimeType,
      startedAt: Date.now(),
      nextPart: 1,
      durationMs: 0,
      stopped: false,
      uploadToken: data.uploadToken,
      replyTo: videoId,
    });
    let release = () => {};
    await new Promise<void>((held) => {
      navigator.locks.request(lockName(mediaId), () => new Promise<void>((r) => {
        release = r;
        held();
      }));
    });

    const uploader = new ChunkedUploader(mediaId, { uploadToken: data.uploadToken }, setUpload);
    const recorder = new MediaRecorder(stream.current, {
      mimeType,
      ...(kind === "VIDEO" ? { videoBitsPerSecond: bitrateFor(1080) } : { audioBitsPerSecond: 128_000 }),
    });
    recorder.ondataavailable = (e) => {
      const l = live.current;
      if (!l || l.discarded || e.data.size === 0) return;
      l.raw.push(e.data);
      // Encrypted on this device, in order, before it is saved or sent.
      l.sealing = l.sealing
        .then(() => encryptFrame(e.data, mediaKey))
        .then((frame) => uploader.push(new Blob([frame as BlobPart])))
        .catch((err) => {
          // A gap would spoil the recording, so it ends here and what came before is kept.
          console.error("Reply chunk failed", err);
          void stop();
        });
    };
    live.current = { recorder, uploader, mediaId, replyId: data.reply.id, startedAt: performance.now(), release, sealing: Promise.resolve(), raw: [] };
    recorder.start(2000);
    setElapsed(0);
    setPhase("recording");
  }

  /** Stops recording and shows it for review; the upload finishes meanwhile. */
  async function stop() {
    const l = live.current;
    if (!l || l.recorder.state === "inactive") return;
    const durationMs = Math.round(performance.now() - l.startedAt);
    const stopped = new Promise<void>((r) => l.recorder.addEventListener("stop", () => r(), { once: true }));
    l.recorder.stop();
    await stopped;
    await l.sealing;
    if (l.discarded) return;
    releaseCamera();
    setReview({ url: URL.createObjectURL(new Blob(l.raw, { type: l.recorder.mimeType.split(";")[0] })), kind: mode === "VIDEO" ? "VIDEO" : "AUDIO", uploaded: false });
    setPhase("review");
    l.finishing = (async () => {
      try {
        await store.updateSession(l.mediaId, { durationMs, stopped: true }).catch(() => {});
        await l.uploader.finish(durationMs);
        if (!l.discarded && live.current === l) setReview((r) => r && { ...r, uploaded: true });
        return true;
      } catch (err) {
        if (!l.discarded) {
          setError(
            err instanceof FatalUploadError && !mayRecover(err)
              ? (err as Error).message
              : `${(err as Error).message}. Your recording is kept in this browser and finishes uploading next time you open this page here. You'll be asked then whether to send it.`,
          );
        }
        return false;
      } finally {
        l.release();
      }
    })();
  }

  /** Sends the reviewed reply once its upload has finished. */
  async function send() {
    const l = live.current;
    if (!l?.finishing) return;
    setPhase("sending");
    setError(undefined);
    if (!(await l.finishing)) return setPhase("review");
    const { reply, error: failed } = await sendHeldReply(videoId, l.replyId);
    if (!reply) {
      setError(failed);
      return setPhase("review");
    }
    onReplied(reply);
    live.current = null;
    setReview(null);
    setUpload(undefined);
    setPhase("sent");
  }

  /** Throws the recording away: from the server, and from this device. */
  const throwAway = useCallback(async () => {
    const l = live.current;
    if (!l) return;
    l.discarded = true;
    live.current = null;
    if (l.recorder.state !== "inactive") {
      const stopped = new Promise<void>((r) => l.recorder.addEventListener("stop", () => r(), { once: true }));
      l.recorder.stop();
      await stopped;
    }
    setReview(null);
    setUpload(undefined);
    setError(undefined);
    await deleteReply(videoId, l.replyId);
    // Any upload still going stops at its next part (the server no longer has it); then nothing is kept here.
    void (l.finishing ?? l.uploader.finish(0))
      .catch(() => {})
      .finally(() => {
        l.release();
        void store.removeSession(l.mediaId).catch(() => {});
      });
  }, [videoId]);

  async function rerecord() {
    setPhase("sending");
    await throwAway();
    setSession((n) => n + 1);
  }

  const discard = useCallback(async () => {
    setPhase("sending");
    await throwAway();
    setNotice("Recording deleted. Nothing was sent.");
    setMode("TEXT");
    setPhase("idle");
  }, [throwAway]);

  useImperativeHandle(ref, () => ({ discard }), [discard]);

  const tabs: { id: Mode; label: string }[] = [
    { id: "TEXT", label: "Text" },
    { id: "VIDEO", label: "Video" },
    { id: "AUDIO", label: "Voice" },
  ];
  // A recording in progress or under review keeps its tab until it's sent or thrown away.
  const locked = phase === "recording" || phase === "review" || phase === "sending";
  const noun = mode === "VIDEO" ? "video" : "voice";

  return (
    <div className="border-t border-line p-4" data-testid="reply-composer">
      <div role="tablist" aria-label="Reply type" className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1 text-sm">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={mode === t.id}
            disabled={locked || textBusy}
            onClick={() => {
              setNotice(undefined);
              setMode(t.id);
            }}
            className={`rounded-md px-2 py-1.5 font-medium transition disabled:opacity-50 ${mode === t.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode === "TEXT" ? (
        <form onSubmit={sendText}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter starts a new line.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Write a reply…"
            aria-label="Reply"
            rows={3}
            className="w-full resize-none rounded-lg border border-line-strong px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          <button disabled={textBusy || !text.trim()} className="mt-2 w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
            {textBusy ? "Sending…" : "Send reply"}
          </button>
        </form>
      ) : phase === "sent" ? (
        <div role="status" data-testid="reply-sent" className="rounded-lg border border-ok-line bg-ok-bg px-4 py-4 text-center text-sm text-ok-fg">
          <p className="font-semibold">Sent</p>
          <p className="mt-1">{sentNote}</p>
          <button onClick={() => setSession((n) => n + 1)} className="mt-3 rounded-lg border border-line-strong bg-surface px-3 py-1.5 font-medium text-ink hover:bg-hover">
            Record another
          </button>
        </div>
      ) : review ? (
        <div data-testid="reply-review">
          <p className="mb-2 text-sm font-medium text-ink">Play it back, then send it. Nobody else can see it yet.</p>
          <MediaPlayer src={review.url} kind={review.kind} />
          <p className="mt-2 text-xs text-dim" role="status">
            {review.uploaded
              ? "Ready to send."
              : upload?.retrying
                ? "Connection lost. It's saved on this device and keeps uploading when you're back online."
                : "Uploading securely…"}
          </p>
          <button
            onClick={send}
            disabled={phase === "sending"}
            className="mt-2 w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            {phase === "sending" ? "Sending…" : `Send ${noun} reply`}
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={rerecord} disabled={phase === "sending"} className="rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50">
              Re-record
            </button>
            <button onClick={discard} disabled={phase === "sending"} className="rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-danger-fg hover:bg-hover disabled:opacity-50">
              Discard
            </button>
          </div>
        </div>
      ) : (
        <div>
          {mode === "VIDEO" ? (
            <div style={frame.style} className="relative mx-auto overflow-hidden rounded-lg bg-solid">
              <video ref={previewRef} autoPlay muted playsInline className={`absolute inset-0 h-full w-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`} />
              {phase === "preview" && cameras > 1 && (
                <button onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} className="absolute right-2 top-2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
                  Flip camera
                </button>
              )}
              {phase === "recording" && <RecBadge ms={elapsed} />}
            </div>
          ) : (
            <div className="relative grid h-20 place-items-center rounded-lg bg-canvas text-sm text-dim">
              {phase === "recording" ? <RecBadge ms={elapsed} inline /> : "Tap record and start talking"}
            </div>
          )}
          {liveStream && (phase === "preview" || phase === "recording") && (
            <div className="mt-2">
              <MicLevel stream={liveStream} />
            </div>
          )}
          {phase === "recording" ? (
            <>
              <button onClick={stop} className="mt-2 w-full rounded-lg bg-red-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
                Stop recording
              </button>
              <p className="mt-1 text-center text-xs text-dim">
                You can play it back before sending. Replies can be up to {Math.round(maxMs / 60_000)} minutes; recording stops by itself at the limit.
              </p>
            </>
          ) : (
            <button onClick={start} disabled={phase !== "preview"} className="mt-2 w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
              {phase === "sending" ? "One moment…" : `Record ${noun} reply`}
            </button>
          )}
        </div>
      )}
      {notice && <p role="status" className="mt-2 text-sm text-muted">{notice}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-danger-fg">{error}</p>}
    </div>
  );
});

export default ReplyComposer;

function RecBadge({ ms, inline = false }: { ms: number; inline?: boolean }) {
  return (
    <span className={`${inline ? "" : "absolute left-2 top-2 "}flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white`}>
      <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Recording · {fmt(ms)}
    </span>
  );
}
