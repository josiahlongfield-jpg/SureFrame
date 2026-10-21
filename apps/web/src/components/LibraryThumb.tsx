"use client";

import { useEffect, useRef, useState } from "react";
import { fingerprint as keyFingerprint, unwrapKey } from "@/lib/e2e/crypto";
import { loadKey, teamKeyName } from "@/lib/e2e/keystore";
import { backfillThumb, loadThumb, SHARP_WIDTH } from "@/lib/thumb";

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
function backfill(videoId: string, rawUrl: string, key: CryptoKey, mimeType: string, remake = false) {
  const id = remake ? `${videoId}:sharp` : videoId;
  let made = backfills.get(id);
  if (!made) {
    const job = () => backfillThumb(videoId, rawUrl, key, mimeType).catch(() => false);
    made = queue.then(job, job);
    queue = made;
    backfills.set(id, made);
  }
  return made;
}

// Stills made before they were sharpened: first fetched again past the browser's copy (another device may have remade
// it already), then remade from the recording once on this device (a recording smaller than that keeps its own). Only
// a few a visit, so a big library catches up over a few visits instead of downloading every recording at once.
const REMADE = "sureframe.sharpThumb.";
const REMAKES_PER_VISIT = 8;
let remakes = 0;
function remadeHere(videoId: string) {
  try {
    return !!localStorage.getItem(REMADE + videoId);
  } catch {
    return true;
  }
}
function markRemade(videoId: string) {
  try {
    localStorage.setItem(REMADE + videoId, "1");
  } catch {}
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
  const shown = useRef<string | null>(null);
  // 1: the still is fetched again past the browser's copy; 2: it's remade from the recording (see above).
  const [sharpen, setSharpen] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    if ((!has && !canMake) || !teamKeyWrap) return;
    let cancelled = false;
    (async () => {
      const team = await teamKey(workspaceId, fingerprint);
      if (!team || cancelled) return;
      const key = await unwrapKey(teamKeyWrap, team);
      if (sharpen === 2) {
        const remade = await backfill(videoId, rawUrl, key, mimeType, true);
        if (remade) markRemade(videoId);
        if (!remade) return;
      } else if (!has && !(await backfill(videoId, rawUrl, key, mimeType))) return;
      if (cancelled) return;
      const next = await loadThumb(videoId, key, sharpen > 0);
      if (!next) return;
      if (cancelled) return URL.revokeObjectURL(next);
      // The one showing stays until this one replaces it.
      const old = shown.current;
      shown.current = next;
      setUrl(next);
      if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [videoId, teamKeyWrap, workspaceId, fingerprint, has, canMake, rawUrl, mimeType, sharpen]);
  useEffect(
    () => () => {
      if (shown.current) URL.revokeObjectURL(shown.current);
    },
    [],
  );
  if (!url) return <Lock />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      data-testid="library-thumb"
      className="h-full w-full object-cover transition group-hover:scale-105"
      onLoad={(e) => {
        if (!canMake || e.currentTarget.naturalWidth >= SHARP_WIDTH || remadeHere(videoId)) return;
        if (sharpen === 0) setSharpen(1);
        else if (sharpen === 1 && remakes < REMAKES_PER_VISIT) {
          remakes++;
          setSharpen(2);
        }
      }}
    />
  );
}
