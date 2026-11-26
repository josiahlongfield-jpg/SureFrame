"use client";

import { forwardRef, useCallback, useEffect, useState, type RefObject } from "react";
import { decryptFrames } from "@/lib/e2e/crypto";
import { fetchWhole, PlaybackRefused, streamableType, streamRecording } from "@/lib/playback";
import { leadingClip } from "@/lib/thumb";
import MediaPlayer from "./MediaPlayer";

/**
 * Download an encrypted recording, decrypt it on this device and return a playable URL. Nothing is fetched while
 * `url` is null. `cut`: part of it didn't open in order, so it ends early (lib/e2e/crypto.ts FrameReader).
 */
export function useDecryptedUrl(url: string | null, key: CryptoKey | null, mimeType: string) {
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState<string>();
  const [cut, setCut] = useState(false);
  useEffect(() => {
    if (!url || !key) return;
    let objectUrl: string | undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (res.status === 410) throw new Error("expired");
        if (!res.ok) throw new Error("unavailable");
        const parts = await decryptFrames(await res.arrayBuffer(), key);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob(parts as BlobPart[], { type: mimeType.split(";")[0] }));
        setCut(!!parts.cut);
        setSrc(objectUrl);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, key, mimeType]);
  return { src, error, cut };
}

type Playback = {
  /** For the player. */
  src?: string;
  /** A playable copy of (at least) the start, for pictures taken from it: the whole recording, or its first seconds while streaming. */
  preview?: string;
  /** Playing as it loads (lib/playback.ts): `src` is ready to attach at once, and playable once the player says so. */
  streaming: boolean;
  error?: string;
  cut: boolean;
};

/**
 * The main video's playback: as it loads where the browser can (lib/playback.ts), otherwise, or if that fails, the
 * whole file first, as before. `player` is the element `src` goes on. `whole` gets the entire decrypted recording,
 * for what needs it all at once (the transcript, saving).
 */
export function usePlayback(url: string | null, key: CryptoKey | null, mimeType: string, durationMs: number | null, player: RefObject<HTMLMediaElement | null>) {
  const [state, setState] = useState<Playback>({ streaming: false, cut: false });
  // Streaming didn't work on this device: the whole file from then on.
  const [wholeFile, setWholeFile] = useState(false);
  useEffect(() => {
    if (!url || !key) return;
    let cancelled = false;
    const type = wholeFile ? null : streamableType(mimeType, durationMs);
    if (type && durationMs) {
      const stream = streamRecording(url, key, type, durationMs, () => player.current, {
        preview: (preview) => !cancelled && setState((s) => ({ ...s, preview })),
        cut: () => !cancelled && setState((s) => ({ ...s, cut: true })),
        fail: (error) => !cancelled && setState({ streaming: false, cut: false, error }),
        fallback: () => {
          if (cancelled) return;
          setState({ streaming: false, cut: false });
          setWholeFile(true);
        },
      });
      setState({ src: stream.src, streaming: true, cut: false });
      return () => {
        cancelled = true;
        stream.stop();
      };
    }
    let objectUrl: string | undefined;
    (async () => {
      try {
        const { blob, cut } = await fetchWhole(url, key, mimeType);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ src: objectUrl, preview: objectUrl, streaming: false, cut });
      } catch (err) {
        if (!cancelled) setState({ streaming: false, cut: false, error: err instanceof PlaybackRefused ? err.reason : "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, key, mimeType, durationMs, wholeFile, player]);
  const whole = useCallback(async () => {
    if (!url || !key) throw new Error("unavailable");
    return (await fetchWhole(url, key, mimeType)).blob;
  }, [url, key, mimeType]);
  return { ...state, whole };
}

/**
 * Only the first few seconds of a recording (a few MB), decrypted here as a short clip, for a still of it: the
 * whole recording is only fetched when it's played. `clip` is undefined while it loads, null if there's none.
 */
export function useLeadingClip(url: string | null, key: CryptoKey | null, mimeType: string, maxBytes: number) {
  const [clip, setClip] = useState<string | null>();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!url || !key) return;
    let made: string | null = null;
    let cancelled = false;
    leadingClip(url, key, mimeType, maxBytes).then(
      (u) => {
        made = u;
        if (cancelled && u) URL.revokeObjectURL(u);
        else setClip(u);
      },
      () => {
        if (cancelled) return;
        setClip(null);
        setError(true);
      },
    );
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
      setClip(undefined);
    };
  }, [url, key, mimeType, maxBytes]);
  return { clip, error };
}

type Props = { url: string; mediaKey: CryptoKey | null; mimeType: string; kind: "VIDEO" | "AUDIO"; className?: string; autoPlay?: boolean };

const SecureMedia = forwardRef<HTMLMediaElement | null, Props>(function SecureMedia({ url, mediaKey, mimeType, kind, className, autoPlay }, ref) {
  const { src, error } = useDecryptedUrl(url, mediaKey, mimeType);
  if (error === "expired") return <MediaNotice text="This recording has been deleted from SureFrame." />;
  if (error) return <MediaNotice text="Couldn't unlock this recording on this device." />;
  if (!src) return <MediaNotice text="Unlocking…" />;
  return <MediaPlayer ref={ref} src={src} kind={kind} className={className} autoPlay={autoPlay} />;
});

export default SecureMedia;

function MediaNotice({ text }: { text: string }) {
  return <div className="grid min-h-12 place-items-center rounded-lg bg-surface-2 px-3 py-3 text-center text-xs text-dim">{text}</div>;
}
