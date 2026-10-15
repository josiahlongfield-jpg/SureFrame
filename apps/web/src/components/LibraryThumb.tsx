"use client";

import { useEffect, useState } from "react";
import { fingerprint as keyFingerprint, unwrapKey } from "@/lib/e2e/crypto";
import { loadKey, teamKeyName } from "@/lib/e2e/keystore";
import { loadThumb } from "@/lib/thumb";

// One look-up of this device's team key for the whole library.
const teamKeys = new Map<string, Promise<CryptoKey | null>>();
function teamKey(workspaceId: string, fingerprint: string | null) {
  const id = `${workspaceId}:${fingerprint}`;
  let key = teamKeys.get(id);
  if (!key) {
    key = loadKey(teamKeyName(workspaceId)).then(async (k) => (k && fingerprint && (await keyFingerprint(k)) === fingerprint ? k : null)).catch(() => null);
    teamKeys.set(id, key);
  }
  return key;
}

const Lock = () => (
  <span className="absolute inset-0 grid place-items-center text-dim">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" role="img" aria-label="Encrypted"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
  </span>
);

/**
 * An encrypted recording's library still, unlocked on this device (lib/thumb.ts).
 * Shows the lock until there is one, or if this device doesn't have the team key yet.
 */
export default function LibraryThumb({ videoId, teamKeyWrap, workspaceId, fingerprint, has }: { videoId: string; teamKeyWrap: string | null; workspaceId: string; fingerprint: string | null; has: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!has || !teamKeyWrap) return;
    let made: string | null = null;
    let cancelled = false;
    (async () => {
      const team = await teamKey(workspaceId, fingerprint);
      if (!team || cancelled) return;
      made = await loadThumb(videoId, await unwrapKey(teamKeyWrap, team));
      if (cancelled && made) URL.revokeObjectURL(made);
      else setUrl(made);
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [videoId, teamKeyWrap, workspaceId, fingerprint, has]);
  if (!url) return <Lock />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" data-testid="library-thumb" className="h-full w-full object-cover transition group-hover:scale-105" />;
}
