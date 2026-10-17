"use client";

import { useEffect, useState } from "react";
import { fingerprint as keyFingerprint, unwrapKey } from "@/lib/e2e/crypto";
import { loadKey, teamKeyName } from "@/lib/e2e/keystore";
import { backfillThumb, loadThumb } from "@/lib/thumb";

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

// Missing stills are made one at a time, so the library doesn't download many recordings at once,
// and once per recording however many tiles show it.
let queue: Promise<unknown> = Promise.resolve();
const backfills = new Map<string, Promise<boolean>>();
function backfill(videoId: string, rawUrl: string, key: CryptoKey, mimeType: string) {
  let made = backfills.get(videoId);
  if (!made) {
    const job = () => backfillThumb(videoId, rawUrl, key, mimeType).catch(() => false);
    made = queue.then(job, job);
    queue = made;
    backfills.set(videoId, made);
  }
  return made;
}

const Lock = () => (
  <span className="absolute inset-0 grid place-items-center text-dim">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" role="img" aria-label="Encrypted"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
  </span>
);

/**
 * An encrypted recording's library still, unlocked on this device (lib/thumb.ts).
 * A recording without one yet gets one here from the start of the recording
 * (`canMake`). Shows the lock until there is one, or if this device doesn't
 * have the team key yet.
 */
export default function LibraryThumb({ videoId, teamKeyWrap, workspaceId, fingerprint, has, canMake, rawUrl, mimeType }: { videoId: string; teamKeyWrap: string | null; workspaceId: string; fingerprint: string | null; has: boolean; canMake: boolean; rawUrl: string; mimeType: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if ((!has && !canMake) || !teamKeyWrap) return;
    let made: string | null = null;
    let cancelled = false;
    (async () => {
      const team = await teamKey(workspaceId, fingerprint);
      if (!team || cancelled) return;
      const key = await unwrapKey(teamKeyWrap, team);
      if (!has && !(await backfill(videoId, rawUrl, key, mimeType))) return;
      if (cancelled) return;
      made = await loadThumb(videoId, key);
      if (cancelled && made) URL.revokeObjectURL(made);
      else setUrl(made);
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [videoId, teamKeyWrap, workspaceId, fingerprint, has, canMake, rawUrl, mimeType]);
  if (!url) return <Lock />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" data-testid="library-thumb" className="h-full w-full object-cover transition group-hover:scale-105" />;
}
