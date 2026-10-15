"use client";

import { forwardRef, useEffect, useState } from "react";
import { decryptFrames } from "@/lib/e2e/crypto";
import MediaPlayer from "./MediaPlayer";

/** Download an encrypted recording, decrypt it on this device and return a playable URL. */
export function useDecryptedUrl(url: string | null, key: CryptoKey | null, mimeType: string) {
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState<string>();
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
  return { src, error };
}

type Props = { url: string; mediaKey: CryptoKey | null; mimeType: string; kind: "VIDEO" | "AUDIO"; className?: string };

const SecureMedia = forwardRef<HTMLMediaElement | null, Props>(function SecureMedia({ url, mediaKey, mimeType, kind, className }, ref) {
  const { src, error } = useDecryptedUrl(url, mediaKey, mimeType);
  if (error === "expired") return <MediaNotice text="This recording has been deleted from our servers." />;
  if (error) return <MediaNotice text="Couldn't unlock this recording on this device." />;
  if (!src) return <MediaNotice text="Unlocking…" />;
  return <MediaPlayer ref={ref} src={src} kind={kind} className={className} />;
});

export default SecureMedia;

function MediaNotice({ text }: { text: string }) {
  return <div className="grid min-h-12 place-items-center rounded-lg bg-surface-2 px-3 py-3 text-center text-xs text-dim">{text}</div>;
}
