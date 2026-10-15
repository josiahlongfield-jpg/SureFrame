"use client";

import { decryptBytes, encryptBytes } from "@/lib/e2e/crypto";

/**
 * Library stills. Recordings are end-to-end encrypted, so the server can't
 * make a preview: a team member's device takes a frame from the decrypted
 * recording, encrypts it with the video's key and uploads it, and the library
 * decrypts it the same way it would the video.
 */
const WIDTH = 480;

function waitFor(el: HTMLVideoElement, event: "loadeddata" | "seeked", ms: number) {
  return new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => {
      el.removeEventListener(event, onEvent);
      el.removeEventListener("error", onError);
      clearTimeout(timer);
      resolve(ok);
    };
    const onEvent = () => done(true);
    const onError = () => done(false);
    const timer = setTimeout(() => done(false), ms);
    el.addEventListener(event, onEvent);
    el.addEventListener("error", onError);
  });
}

/** Takes a still about a second in (past any countdown fade) and saves it, encrypted, for the library. */
export async function makeThumb(videoId: string, src: string, key: CryptoKey) {
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.preload = "auto";
  el.src = src;
  try {
    if (!(await waitFor(el, "loadeddata", 20_000)) || !el.videoWidth) return false;
    // Recordings straight from the browser often don't know their length; a second in is fine for those.
    const at = Number.isFinite(el.duration) && el.duration > 0 ? Math.min(1, el.duration / 3) : 1;
    el.currentTime = at;
    // If seeking isn't possible, the first frame will do.
    await waitFor(el, "seeked", 8_000);
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(WIDTH, el.videoWidth);
    canvas.height = Math.round((canvas.width * el.videoHeight) / el.videoWidth);
    canvas.getContext("2d")?.drawImage(el, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.72));
    if (!blob) return false;
    const data = await encryptBytes(new Uint8Array(await blob.arrayBuffer()), key);
    const res = await fetch(`/api/videos/${videoId}/thumb`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    }).catch(() => null);
    return !!res?.ok;
  } finally {
    el.removeAttribute("src");
    el.load();
  }
}

/** The still as an image URL, or null if there isn't one or it can't be unlocked here. */
export async function loadThumb(videoId: string, key: CryptoKey) {
  const res = await fetch(`/api/videos/${videoId}/thumb`).catch(() => null);
  if (!res?.ok) return null;
  const bytes = await decryptBytes(await res.text(), key);
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
}
