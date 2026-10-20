"use client";

import { useEffect, useState } from "react";
import { unwrapKey } from "@/lib/e2e/crypto";
import { loadClientKey } from "@/lib/e2e/keystore";
import { loadThumb } from "@/lib/thumb";

// One look-up of this device's key per client, however many tiles show their videos.
const keys = new Map<string, Promise<CryptoKey | null>>();
function clientKey(clientId: string) {
  let key = keys.get(clientId);
  if (!key) keys.set(clientId, (key = loadClientKey(clientId).catch(() => null)));
  return key;
}

/**
 * A video's still on a client's "Your videos" page, unlocked with the key from
 * their personal link (the same still the business's library shows, made on
 * the team's device). A play mark until there is one.
 */
export default function ClientThumb({ clientId, videoId, wrap, has }: { clientId: string; videoId: string; wrap: string | null; has: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!has || !wrap) return;
    let made: string | null = null;
    let cancelled = false;
    (async () => {
      const mine = await clientKey(clientId);
      if (!mine || cancelled) return;
      made = await loadThumb(videoId, await unwrapKey(wrap, mine));
      if (cancelled && made) URL.revokeObjectURL(made);
      else setUrl(made);
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [clientId, videoId, wrap, has]);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="h-full w-full object-cover transition group-hover:scale-105" data-testid="client-thumb" />
  ) : (
    <span className="absolute inset-0 grid place-items-center text-white/80">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.5v13l11-6.5z" /></svg>
    </span>
  );
}
