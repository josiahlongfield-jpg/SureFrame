import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

type Options = {
  /** Remembers the last shape in this browser under this key, so the frame starts in it next time. */
  remember?: string;
  /**
   * Called when a picture that's already showing changes size (another camera, turning the phone). Safari can keep
   * drawing it at the old size, a small picture inside the frame, so a camera preview is drawn fresh then.
   */
  onNewSize?: () => void;
};

/**
 * Sizes a video's frame to the video's own shape, so a phone's portrait or
 * square camera fills the frame instead of sitting between black bars.
 * Starts at 16:9 (or the remembered shape) until the video's size is known, and follows changes such as
 * flipping the camera, turning the phone or a new stream when recording starts.
 *
 * `ready` says the video has a picture and the frame has its shape: a camera preview stays hidden until then, so the
 * picture only ever shows filling its whole frame, never small first.
 */
export function useVideoFrame(maxHeight: string, { remember, onNewSize }: Options = {}) {
  const [aspect, setAspect] = useState(16 / 9);
  const [shown, setShown] = useState<HTMLVideoElement | null>(null);
  const newSize = useRef(onNewSize);
  useEffect(() => {
    newSize.current = onNewSize;
  });
  useEffect(() => {
    if (!remember) return;
    try {
      const saved = Number(localStorage.getItem(remember));
      if (saved > 0.2 && saved < 5) setAspect(saved);
    } catch {}
  }, [remember]);
  /** Attach to the <video>: measures it whenever its size becomes known or changes. */
  const ref = useCallback(
    (v: HTMLVideoElement | null) => {
      if (!v) return;
      // A new element starts hidden until it has a picture.
      setShown(null);
      let size = "";
      const on = (e?: Event) => {
        if (!v.videoWidth || !v.videoHeight) return;
        const now = `${v.videoWidth}x${v.videoHeight}`;
        // Showing at one size and now another: hidden, and drawn fresh where the page asks for that.
        if (e?.type === "resize" && size && now !== size && newSize.current) {
          size = "";
          setShown(null);
          newSize.current();
          return;
        }
        const shape = v.videoWidth / v.videoHeight;
        setAspect(shape);
        if (v.readyState >= 2) {
          size = now;
          setShown(v);
          if (remember)
            try {
              localStorage.setItem(remember, shape.toFixed(4));
            } catch {}
        }
      };
      v.addEventListener("loadedmetadata", on);
      v.addEventListener("loadeddata", on);
      v.addEventListener("resize", on);
      // Phones don't always report a new size (a new camera stream when recording starts, turning the phone),
      // so it's checked again while it plays. Unchanged, it costs nothing: React skips an equal value.
      v.addEventListener("playing", on);
      v.addEventListener("timeupdate", on);
      on();
    },
    [remember],
  );
  /** For the frame around the video: its shape, as wide as fits, never taller than maxHeight. */
  const style: CSSProperties = { aspectRatio: String(aspect), width: `min(100%, calc(${maxHeight} * ${aspect}))` };
  return { ref, style, aspect, ready: !!shown?.isConnected };
}
