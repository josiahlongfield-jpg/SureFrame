"use client";

import { useEffect, useState } from "react";
import { posterFrom } from "@/lib/thumb";

/** A still from the recording at `src`, made on this device, for showing before it plays (lib/thumb.ts). */
export function usePoster(src: string | null | undefined) {
  const [poster, setPoster] = useState<string | null>(null);
  useEffect(() => {
    if (!src) return;
    let made: string | null = null;
    let cancelled = false;
    posterFrom(src).then(
      (url) => {
        made = url;
        if (cancelled && url) URL.revokeObjectURL(url);
        else setPoster(url);
      },
      () => {},
    );
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
      setPoster(null);
    };
  }, [src]);
  return poster;
}

/**
 * Covers a video that hasn't been played yet with a picture from it and a play button, because phones (iPhones
 * especially) show a video as a black box until it plays. Tapping it starts the video; it goes once playing starts.
 */
export default function PosterCover({ poster, onPlay, label = "Play video" }: { poster: string | null; onPlay: () => void; label?: string }) {
  if (!poster) return null;
  return (
    <button type="button" onClick={onPlay} aria-label={label} data-testid="poster-cover" className="group absolute inset-0 z-10 block bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={poster} alt="" className="h-full w-full object-contain" />
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-black/55 text-white shadow-lg transition group-hover:bg-black/70">
          <svg aria-hidden width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
        </span>
      </span>
    </button>
  );
}
