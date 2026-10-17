"use client";

import { decryptBytes, decryptLeadingFrames, encryptBytes } from "@/lib/e2e/crypto";

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

/** Draws the element's current frame as a small JPEG. */
async function capture(el: HTMLVideoElement) {
  if (!el.videoWidth || !el.videoHeight) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(WIDTH, el.videoWidth);
  canvas.height = Math.round((canvas.width * el.videoHeight) / el.videoWidth);
  canvas.getContext("2d")?.drawImage(el, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.72));
}

/** Encrypts a still with the video's key and saves it for the library. */
async function save(videoId: string, still: Blob, key: CryptoKey) {
  const data = await encryptBytes(new Uint8Array(await still.arrayBuffer()), key);
  const res = await fetch(`/api/videos/${videoId}/thumb`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  }).catch(() => null);
  return !!res?.ok;
}

/** A still about a second in (past any countdown fade) from a playable recording URL. */
async function stillFrom(src: string) {
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.preload = "auto";
  el.src = src;
  try {
    if (!(await waitFor(el, "loadeddata", 20_000)) || !el.videoWidth) return null;
    // Recordings straight from the browser often don't know their length; a second in is fine for those.
    const at = Number.isFinite(el.duration) && el.duration > 0 ? Math.min(1, el.duration / 3) : 1;
    el.currentTime = at;
    // If seeking isn't possible, the first frame will do.
    await waitFor(el, "seeked", 8_000);
    return await capture(el);
  } finally {
    el.removeAttribute("src");
    el.load();
  }
}

/** Takes a still from a decrypted recording and saves it, encrypted, for the library. */
export async function makeThumb(videoId: string, src: string, key: CryptoKey) {
  const still = await stillFrom(src);
  return !!still && (await save(videoId, still, key));
}

/**
 * Takes the still while recording, from the video track being recorded, so a
 * new recording has its still in the library straight away.
 */
export async function thumbFromTrack(videoId: string, track: MediaStreamTrack, key: CryptoKey) {
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.srcObject = new MediaStream([track]);
  try {
    void el.play().catch(() => {});
    if (!(await waitFor(el, "loadeddata", 10_000))) return false;
    // A moment for the first frames to settle (a camera's exposure, a screen share's first paint).
    await new Promise((r) => setTimeout(r, 300));
    const still = await capture(el);
    return !!still && (await save(videoId, still, key));
  } finally {
    el.pause();
    el.srcObject = null;
  }
}

// Enough of a recording for its first few seconds; the rest isn't downloaded.
const PREVIEW_BYTES = 6 * 1024 * 1024;

/**
 * Makes a still for a recording that doesn't have one yet (recorded before
 * stills, or never opened), from only the start of the recording. True once it's saved.
 */
export async function backfillThumb(videoId: string, rawUrl: string, key: CryptoKey, mimeType: string) {
  const res = await fetch(rawUrl).catch(() => null);
  if (!res?.ok || !res.body) return false;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (size < PREVIEW_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
  }
  void reader.cancel().catch(() => {});
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  const frames = await decryptLeadingFrames(bytes, key);
  if (!frames.length) return false;
  const src = URL.createObjectURL(new Blob(frames as BlobPart[], { type: mimeType.split(";")[0] }));
  try {
    const still = await stillFrom(src);
    return !!still && (await save(videoId, still, key));
  } finally {
    URL.revokeObjectURL(src);
  }
}

/** The still as an image URL, or null if there isn't one or it can't be unlocked here. */
export async function loadThumb(videoId: string, key: CryptoKey) {
  const res = await fetch(`/api/videos/${videoId}/thumb`).catch(() => null);
  if (!res?.ok) return null;
  const bytes = await decryptBytes(await res.text(), key);
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
}
