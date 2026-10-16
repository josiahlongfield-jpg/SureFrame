import { useCallback, useState, type CSSProperties } from "react";

/**
 * Sizes a video's frame to the video's own shape, so a phone's portrait or
 * square camera fills the frame instead of sitting between black bars.
 * Starts at 16:9 until the video's size is known, and follows changes such as
 * flipping the camera, turning the phone or a new stream when recording starts.
 */
export function useVideoFrame(maxHeight: string) {
  const [aspect, setAspect] = useState(16 / 9);
  const measure = useCallback((v: HTMLVideoElement) => {
    if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
  }, []);
  /** Attach to the <video>: measures it whenever its size becomes known or changes. */
  const ref = useCallback(
    (v: HTMLVideoElement | null) => {
      if (!v) return;
      const on = () => measure(v);
      v.addEventListener("loadedmetadata", on);
      v.addEventListener("resize", on);
      // Phones don't always report a new size (a new camera stream when recording starts, turning the phone),
      // so it's checked again while it plays. Unchanged, it costs nothing: React skips an equal value.
      v.addEventListener("playing", on);
      v.addEventListener("timeupdate", on);
      on();
    },
    [measure],
  );
  /** For the frame around the video: its shape, as wide as fits, never taller than maxHeight. */
  const style: CSSProperties = { aspectRatio: String(aspect), width: `min(100%, calc(${maxHeight} * ${aspect}))` };
  return { ref, style, aspect };
}
