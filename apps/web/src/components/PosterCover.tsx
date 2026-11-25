"use client";

import { useEffect, useRef, useState } from "react";
import { loadThumb, posterFrom } from "@/lib/thumb";

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
 * The recording's library still (made while recording, or the first time the team opened it), as an image URL,
 * so there's a picture over the player straight away, before the whole recording has downloaded and unlocked.
 * Tried again once `retry` turns true (a new recording's still may still be on its way when the page opens).
 */
export function useStoredStill(videoId: string, key: CryptoKey | null, enabled: boolean, retry: boolean) {
  const [still, setStill] = useState<string | null>(null);
  const have = useRef(false);
  useEffect(() => {
    if (!enabled || !key || have.current) return;
    let cancelled = false;
    loadThumb(videoId, key, retry).then(
      (url) => {
        if (!url) return;
        if (cancelled || have.current) return URL.revokeObjectURL(url);
        have.current = true;
        setStill(url);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [videoId, key, enabled, retry]);
  useEffect(() => () => void (still && URL.revokeObjectURL(still)), [still]);
  return still;
}

/**
 * Covers a video that hasn't been played yet with a picture from it and a play button, because phones (iPhones
 * especially) show a video as a black box until it plays. Tapping it starts the video; it goes once playing starts.
 * `busy`: the video isn't ready to play yet (still downloading and unlocking) and the viewer has asked for it, or
 * there's no picture to show meanwhile: a spinner and a line say so in place of the play button, picture or not.
 */
export default function PosterCover({ poster, onPlay, label = "Play video", busy = false }: { poster: string | null; onPlay: () => void; label?: string; busy?: boolean }) {
  if (!poster && !busy) return null;
  return (
    <button type="button" onClick={onPlay} aria-label={busy ? undefined : label} data-testid="poster-cover" className="group absolute inset-0 z-10 block bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {poster && <img src={poster} alt="" className="h-full w-full object-contain" />}
      <span className="absolute inset-0 grid place-items-center">
        {busy ? (
          <span role="status" data-testid="poster-busy" className="flex max-w-[90%] items-center gap-3 rounded-full bg-black/55 px-4 py-2 text-sm text-white shadow-lg">
            <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Getting your video ready…
          </span>
        ) : (
          <span className="grid h-16 w-16 place-items-center rounded-full bg-black/55 text-white shadow-lg transition group-hover:bg-black/70">
            <svg aria-hidden width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
          </span>
        )}
      </span>
    </button>
  );
}
