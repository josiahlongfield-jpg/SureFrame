"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useVideoFrame } from "@/lib/videoFrame";
import PosterCover, { usePoster } from "./PosterCover";

/**
 * Plays a raw browser recording. WebM files recorded in the browser have no
 * duration in their header until they are transcoded; seeking far ahead makes
 * the browser scan the file so the scrubber works immediately.
 */
export function fixDuration(el: HTMLMediaElement) {
  const run = () => {
    if (el.duration !== Infinity) return;
    el.addEventListener("durationchange", () => (el.currentTime = 0), { once: true });
    el.currentTime = 1e101;
  };
  el.addEventListener("loadedmetadata", run, { once: true });
  return () => el.removeEventListener("loadedmetadata", run);
}

type Props = { src: string; kind: "VIDEO" | "AUDIO"; className?: string };

const MediaPlayer = forwardRef<HTMLMediaElement | null, Props>(function MediaPlayer({ src, kind, className }, ref) {
  const el = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useImperativeHandle(ref, () => el.current!, []);
  useEffect(() => (el.current ? fixDuration(el.current) : undefined), [src]);
  // Video replies take their own shape (a phone's portrait camera too), so they fill the frame without black bars.
  const frame = useVideoFrame("60vh");
  const frameRef = frame.ref;
  useEffect(() => frameRef(el.current), [frameRef, src]);
  // The file arrived but this device can't decode its format (an older iPhone and a WebM recording).
  const [unplayable, setUnplayable] = useState(false);
  // A picture from the recording until it's played (phones show black), only where the page doesn't start it itself.
  const poster = usePoster(kind === "VIDEO" && !className ? src : null);
  const [started, setStarted] = useState(false);
  const onError = (e: React.SyntheticEvent<HTMLMediaElement>) => e.currentTarget.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && setUnplayable(true);
  if (unplayable) {
    return (
      <p data-testid="unplayable" className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
        This device can&apos;t play this recording&apos;s format. Try another browser or a computer.
      </p>
    );
  }
  if (kind === "AUDIO") return <audio ref={el} src={src} controls preload="metadata" onError={onError} className={className ?? "w-full"} />;
  if (className) return <video ref={el} src={src} controls playsInline preload="metadata" onError={onError} className={className} />;
  return (
    <div style={frame.style} className="relative mx-auto overflow-hidden rounded-lg bg-black">
      <video ref={el} src={src} controls playsInline preload="metadata" onError={onError} onPlay={() => setStarted(true)} className="absolute inset-0 h-full w-full object-contain" />
      {!started && <PosterCover poster={poster} onPlay={() => (setStarted(true), void el.current?.play().catch(() => {}))} />}
    </div>
  );
});

export default MediaPlayer;
