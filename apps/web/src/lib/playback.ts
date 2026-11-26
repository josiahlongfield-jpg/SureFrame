"use client";

import { decryptFrames, FrameReader } from "@/lib/e2e/crypto";

/**
 * Play-as-it-loads for encrypted recordings (REC-1). The recording is downloaded in order, each chunk is decrypted
 * on this device as it arrives and handed to the player (MediaSource), so it starts within seconds and a long one
 * never has to fit in memory. Only what's a minute or so ahead of the playhead is fetched; the browser lets go of
 * what's been watched. A seek back to a part it has let go of starts the download again from the beginning.
 *
 * Tried only where it's well supported (Chrome, Edge, Android and Firefox, for a recording whose format the browser
 * says it can stream). Anywhere else, or if anything goes wrong before or while playing, the page falls back to the
 * way it always worked: the whole file downloaded and decrypted, then played (components/SecureMedia.tsx).
 * Nothing readable leaves the device either way.
 */

/** About this much of what's ahead of the playhead is fetched, a minute at most (players hold only so much). */
const AHEAD_BYTES = 20 * 1024 * 1024;
const AHEAD_MAX_S = 60;
const AHEAD_MIN_S = 10;
/** The start of the recording is kept as a short clip of its own, for the picture over the player and the library still. */
const PREVIEW_BYTES = 6 * 1024 * 1024;
/** A hole this small in what the player has (a quirk of some recordings) is stepped over; a bigger one is fetched again. */
const SMALL_GAP_S = 1.5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const baseType = (mimeType: string) => mimeType.split(";")[0].trim();

/** Refused by the server: deleted ("expired"), or not this viewer's to open ("unavailable"). Not worth retrying. */
export class PlaybackRefused extends Error {
  constructor(readonly reason: "expired" | "unavailable") {
    super(reason);
  }
}

/**
 * The type to give MediaSource when this browser can play the recording as it loads, or null for the whole-file way.
 * A recording's stored length is needed too, so the player's timeline is right from the start.
 */
export function streamableType(mimeType: string, durationMs: number | null): string | null {
  if (typeof window === "undefined" || !durationMs || durationMs <= 0) return null;
  const MS = window.MediaSource;
  if (typeof MS?.isTypeSupported !== "function") return null;
  // Chrome, Edge, Android and Firefox only: Safari, and every browser on an iPhone or iPad, keeps the whole-file way.
  const ua = navigator.userAgent;
  if (!/Chrome\/|Chromium\/|Firefox\//.test(ua) || /iPhone|iPad|iPod/.test(ua)) return null;
  const [base, ...params] = mimeType.split(";").map((s) => s.trim());
  const codecs = params.find((p) => /^codecs=/i.test(p))?.slice(7).replace(/"/g, "").trim();
  // Without the codecs named, the browser can't say for sure; a format other than these two isn't tried.
  if (!codecs || !/^(video|audio)\/(webm|mp4)$/i.test(base)) return null;
  const type = `${base}; codecs="${codecs}"`;
  try {
    return MS.isTypeSupported(type) ? type : null;
  } catch {
    return null;
  }
}

/**
 * Downloads `url` in order, handing each piece to `take` (which may wait, holding the download back). A dropped
 * connection carries on from where it stopped (a range request), after a pause, for as long as the page is open.
 */
async function download(url: string, signal: AbortSignal, take: (bytes: Uint8Array) => Promise<void>) {
  let at = 0;
  for (let tries = 0; ; ) {
    let res: Response | null = null;
    try {
      res = await fetch(url, { signal, headers: at ? { Range: `bytes=${at}-` } : undefined });
    } catch (err) {
      if (signal.aborted) throw err;
    }
    if (res) {
      if (res.status === 410) throw new PlaybackRefused("expired");
      // Asked for what's after the last byte: it had all arrived.
      if (res.status === 416 && at) return;
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw new PlaybackRefused("unavailable");
      if (res.ok && res.body) {
        // A server that ignored the range sends it all again: what's already here is skipped.
        let skip = at && res.status !== 206 ? at : 0;
        const reader = res.body.getReader();
        try {
          for (;;) {
            let part: ReadableStreamReadResult<Uint8Array>;
            try {
              part = await reader.read();
            } catch (err) {
              if (signal.aborted) throw err;
              break;
            }
            if (part.done) return;
            tries = 0;
            let bytes = part.value;
            if (skip) {
              if (bytes.length <= skip) {
                skip -= bytes.length;
                continue;
              }
              bytes = bytes.subarray(skip);
              skip = 0;
            }
            at += bytes.length;
            await take(bytes);
          }
        } finally {
          void reader.cancel().catch(() => {});
        }
      }
    }
    // 1s, 2s, 4s ... capped at 30s, as uploads do.
    await sleep(Math.min(30_000, 1000 * 2 ** Math.min(tries++, 5)));
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  }
}

/** Runs one change on a SourceBuffer and waits for it to finish. */
function update(sb: SourceBuffer, act: () => void) {
  return new Promise<void>((resolve, reject) => {
    const off = () => {
      sb.removeEventListener("updateend", done);
      sb.removeEventListener("error", failed);
    };
    const done = () => (off(), resolve());
    const failed = () => (off(), reject(new Error("The player couldn't take this part of the recording")));
    sb.addEventListener("updateend", done);
    sb.addEventListener("error", failed);
    try {
      act();
    } catch (err) {
      off();
      reject(err);
    }
  });
}

async function idle(sb: SourceBuffer) {
  while (sb.updating) await new Promise((r) => sb.addEventListener("updateend", r, { once: true }));
}

const lastEnd = (b: TimeRanges) => (b.length ? b.end(b.length - 1) : 0);

type Events = {
  /** A short clip of the recording's start, as a URL (valid until stop). */
  preview: (url: string) => void;
  /** Part of the recording didn't open in order (REC-14): what came before plays, and it ends there. */
  cut: () => void;
  /** The server refused it, or it can't be unlocked here at all. */
  fail: (reason: "expired" | "unavailable") => void;
  /** Streaming isn't working here: use the whole-file way instead. */
  fallback: () => void;
};

/**
 * Starts playing an encrypted recording as it loads. Give the returned `src` to the player (`element`) straight
 * away; the download starts once the player has taken it. `stop` ends it all and lets go of everything.
 */
export function streamRecording(url: string, key: CryptoKey, type: string, durationMs: number, element: () => HTMLMediaElement | null, on: Events) {
  const source = new MediaSource();
  const src = URL.createObjectURL(source);
  let stopped = false;
  let controller = new AbortController();
  let restart = false;
  let wake: (() => void) | null = null;
  let previewUrl: string | undefined;
  const cleanups: (() => void)[] = [];

  const stop = () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    wake?.();
    for (const f of cleanups) f();
    URL.revokeObjectURL(src);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  };
  const giveUp = (then: () => void) => {
    if (stopped) return;
    stop();
    then();
  };
  const startAgain = () => {
    restart = true;
    controller.abort();
    wake?.();
  };

  async function run() {
    const el = element();
    if (!el) throw new Error("No player");
    // The stored length, so the timeline is right before the end has arrived; the real end replaces it then.
    source.duration = durationMs / 1000;
    const sb = source.addSourceBuffer(type);

    const onError = () => giveUp(on.fallback);
    el.addEventListener("error", onError);
    // What the player is missing at the playhead: a small hole is stepped over; one that the download has already
    // gone past (a seek back to a part the browser let go of) means starting the download again.
    const check = () => {
      if (stopped || restart || source.readyState === "closed" || (!el.seeking && el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA)) return;
      try {
        const t = el.currentTime;
        const b = sb.buffered;
        for (let i = 0; i < b.length; i++) {
          if (b.start(i) <= t + 0.05 && t < b.end(i)) return;
          if (b.start(i) > t) {
            if (b.start(i) - t <= SMALL_GAP_S) el.currentTime = b.start(i) + 0.01;
            else startAgain();
            return;
          }
        }
      } catch {}
    };
    el.addEventListener("seeking", check);
    el.addEventListener("waiting", check);
    const timer = setInterval(check, 500);
    cleanups.push(() => {
      el.removeEventListener("error", onError);
      el.removeEventListener("seeking", check);
      el.removeEventListener("waiting", check);
      clearInterval(timer);
    });

    for (let first = true; ; first = false) {
      restart = false;
      controller = new AbortController();
      const finished = await feed(sb, el, first);
      if (stopped) return;
      if (finished) {
        await idle(sb);
        if (source.readyState === "open") source.endOfStream();
        // All of it is in; only a seek back to a part the browser has let go of needs it again.
        await new Promise<void>((r) => (wake = r));
        wake = null;
        if (stopped) return;
      }
      await idle(sb);
      if (stopped || source.readyState === "closed") return;
      await update(sb, () => sb.remove(0, Infinity));
    }
  }

  /** One pass through the file from its start. True when it reached the end (or a cut); false when asked to start again. */
  async function feed(sb: SourceBuffer, el: HTMLMediaElement, first: boolean) {
    const reader = new FrameReader(key);
    let preview: Uint8Array[] = [];
    let previewSize = 0;
    let appended = 0;
    let appendedBytes = 0;
    const makePreview = () => {
      if (!first || previewUrl || !preview.length) return;
      previewUrl = URL.createObjectURL(new Blob(preview as BlobPart[], { type: baseType(type) }));
      preview = [];
      on.preview(previewUrl);
    };
    // The first few seconds must give the player something it can play from the start, or this way isn't working.
    const playableStart = () => {
      const b = sb.buffered;
      if (!b.length || b.start(0) > 1) throw new Error("Nothing playable from the start");
    };
    const DONE = new Error("done");
    // A recording of the first kind with a chunk that won't open, or that ends part way through one: it plays as far
    // as it goes, as with a cut (the whole-file way refuses it).
    let broken = false;
    const take = async (bytes: Uint8Array) => {
      let chunks: Uint8Array[] = [];
      try {
        chunks = await reader.push(bytes);
      } catch {
        broken = true;
      }
      for (const chunk of chunks) {
        if (first && !previewUrl) {
          preview.push(chunk);
          previewSize += chunk.length;
          if (previewSize >= PREVIEW_BYTES) makePreview();
        }
        await room(sb, el, appendedBytes);
        if (stopped || restart) throw DONE;
        await append(sb, chunk);
        if (stopped || restart) throw DONE;
        appended++;
        appendedBytes += chunk.length;
        if (first && appended === 3) playableStart();
      }
      if (reader.cut || broken) throw DONE;
    };
    try {
      await download(url, controller.signal, take);
    } catch (err) {
      if (stopped || restart) return false;
      if (err !== DONE) throw err;
    }
    if (!reader.cut && !broken) {
      try {
        reader.finish();
      } catch {
        broken = true;
      }
    }
    const cut = reader.cut || broken;
    if (!appended) throw cut ? new PlaybackRefused("unavailable") : new Error("Nothing in the recording");
    if (first && appended < 3) playableStart();
    makePreview();
    if (cut) on.cut();
    return true;
  }

  /** Waits while enough is already lined up ahead of the playhead. */
  async function room(sb: SourceBuffer, el: HTMLMediaElement, appendedBytes: number) {
    for (;;) {
      if (stopped || restart) return;
      const end = lastEnd(sb.buffered);
      // Bytes per second of this recording, from what's gone in so far, so a 4K one keeps less time in hand.
      const rate = end > 1 ? appendedBytes / end : 0;
      const ahead = rate ? Math.min(AHEAD_MAX_S, Math.max(AHEAD_MIN_S, AHEAD_BYTES / rate)) : AHEAD_MAX_S;
      if (end - el.currentTime < ahead) return;
      await sleep(500);
    }
  }

  async function append(sb: SourceBuffer, chunk: Uint8Array) {
    for (;;) {
      try {
        return await update(sb, () => sb.appendBuffer(chunk as BufferSource));
      } catch (err) {
        if ((err as DOMException)?.name !== "QuotaExceededError") throw err;
        // The player is full: once more of it has been watched, the browser lets go of the start and there's room.
        await sleep(1000);
        if (stopped || restart) return;
      }
    }
  }

  source.addEventListener(
    "sourceopen",
    () =>
      void run().catch((err) => {
        if (stopped) return;
        if (err instanceof PlaybackRefused) return giveUp(() => on.fail(err.reason));
        console.warn("Playing as it loads didn't work here; downloading the whole recording instead", err);
        giveUp(on.fallback);
      }),
    { once: true },
  );
  // The player let go of it (it hit an error, or was given something else).
  source.addEventListener("sourceclose", () => giveUp(on.fallback));
  return { src, stop };
}

/** The whole recording, decrypted on this device (the way it always worked). `cut`: see decryptFrames. */
export async function fetchWhole(url: string, key: CryptoKey, mimeType: string) {
  const res = await fetch(url);
  if (res.status === 410) throw new PlaybackRefused("expired");
  if (!res.ok) throw new PlaybackRefused("unavailable");
  const parts = await decryptFrames(await res.arrayBuffer(), key);
  return { blob: new Blob(parts as BlobPart[], { type: baseType(mimeType) }), cut: !!parts.cut };
}

/** Saves the whole recording as a download, the way the page always has (it's held in memory while it's made). */
export async function saveWhole(url: string, key: CryptoKey, mimeType: string, name: string) {
  const { blob } = await fetchWhole(url, key, mimeType);
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

type SavePicker = (options: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;
const savePicker = () => (typeof window === "undefined" ? undefined : (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker);

/** Whether this browser can write a file piece by piece (Chrome and Edge on a computer), so a long video needn't fit in memory. */
export const canSaveToFile = () => typeof savePicker() === "function";

/**
 * Asks where to save, then downloads, decrypts and writes the recording there piece by piece. Call it straight from
 * the tap (the browser only shows its save box then). "cancelled": they closed the save box.
 */
export async function saveToFile(url: string, key: CryptoKey, mimeType: string, name: string): Promise<"saved" | "cancelled"> {
  const pick = savePicker();
  if (!pick) throw new Error("Not supported");
  let handle: FileSystemFileHandle;
  try {
    handle = await pick.call(window, { suggestedName: name, types: [{ description: "Video", accept: { [baseType(mimeType)]: [name.slice(name.lastIndexOf("."))] } }] });
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") return "cancelled";
    throw err;
  }
  const file = await handle.createWritable();
  try {
    const reader = new FrameReader(key);
    await download(url, new AbortController().signal, async (bytes) => {
      for (const chunk of await reader.push(bytes)) await file.write(chunk as BufferSource);
    });
    reader.finish();
    await file.close();
    return "saved";
  } catch (err) {
    await file.abort().catch(() => {});
    throw err;
  }
}
