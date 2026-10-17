"use client";

// On-device transcription for the AI summaries add-on. The decrypted
// recording is turned into 16 kHz audio here and handed to a Whisper model
// running in a web worker on this device. Audio never leaves the device.
// Nothing here is loaded unless the workspace has the add-on switched on.

import { isManifest, type ModelManifest } from "./modelManifest";
import { MAX_TRANSCRIBE_MINUTES } from "./limits";

export type TranscriptSegment = { start: number; end: number; text: string };
export type Transcript = { v: 1; segments: TranscriptSegment[] };
export type Summary = { overview: string; keyPoints: string[]; actionItems: string[] };

export type Progress = { stage: "audio" | "download" | "transcribe"; fraction: number; bytes?: number };
export type WorkerIn = { channels: Float32Array[]; device: "webgpu" | "wasm"; modelBase: string; manifest: ModelManifest };
export type WorkerOut =
  | { type: "progress"; stage: "download" | "transcribe"; fraction: number; bytes?: number }
  | { type: "done"; transcript: Transcript }
  | { type: "error"; message: string; cause?: "server" | "download" | "device" };

export type Transcriber = (media: Blob, onProgress: (p: Progress) => void) => Promise<Transcript>;

declare global {
  interface Window {
    /**
     * Replaces the on-device model, for automated tests (a headless browser
     * has no model files or speakers to test with).
     */
    __sureframeTranscribe?: Transcriber;
  }
}

/** Longest recording transcribed on a device (see limits.ts). */
export { MAX_TRANSCRIBE_MINUTES };
const SAMPLE_RATE = 16_000;
/** Give up when the worker goes quiet this long (a crashed or out-of-memory worker sends nothing). */
const STALL_MS = 10 * 60_000;

/** Thrown when this browser or device can't run the model. */
export class UnsupportedDevice extends Error {}
/** Thrown when the speech model isn't installed on the server yet, or is incomplete there. */
export class ModelUnavailable extends Error {}
/** Thrown when the speech model couldn't be fetched intact (usually the connection): worth trying again. */
export class ModelDownloadFailed extends Error {}

export type DeviceSupport = {
  /** Run on the graphics chip, on the processor only, or not at all. */
  device: "webgpu" | "wasm" | null;
  mobile: boolean;
  /** Under 4 GB of memory (where the browser says): shown as a warning before the button. */
  lowMemory: boolean;
};

/**
 * Where the self-hosted model lives: our own site, which hands out each file
 * from our storage bucket. Nothing is ever fetched from Hugging Face or a CDN.
 */
export const modelBase = () => new URL("/models/", window.location.origin).toString();

/** The installed model's manifest (exact revision and every file's sha256), read fresh each time. */
async function fetchManifest(): Promise<ModelManifest> {
  const res = await fetch(`${modelBase()}manifest.json`, { cache: "no-store" }).catch(() => null);
  if (res?.status === 404) throw new ModelUnavailable("The speech model isn't installed on this server yet.");
  const manifest = res?.ok ? await res.json().catch(() => null) : null;
  if (!isManifest(manifest)) throw new ModelDownloadFailed("Couldn't check the transcription model just now.");
  return manifest;
}

/** What this device can do. */
export function deviceSupport(): DeviceSupport {
  if (typeof window === "undefined") return { device: null, mobile: false, lowMemory: false };
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean }; gpu?: unknown; deviceMemory?: number };
  const mobile = nav.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad|iPod/i.test(nav.userAgent);
  const lowMemory = typeof nav.deviceMemory === "number" && nav.deviceMemory < 4;
  if (window.__sureframeTranscribe) return { device: nav.gpu ? "webgpu" : "wasm", mobile, lowMemory };
  const basics = typeof WebAssembly === "object" && typeof Worker === "function" && typeof AudioContext === "function";
  if (!basics) return { device: null, mobile, lowMemory };
  return { device: nav.gpu ? "webgpu" : "wasm", mobile, lowMemory };
}

/**
 * Decodes a recording's sound into 16 kHz samples, the rate Whisper expects.
 * Uses the browser's own audio decoder (not available inside workers); the
 * mixing and all model work happen in the worker.
 */
async function decodeAudio(media: Blob): Promise<Float32Array[]> {
  let ctx: AudioContext | undefined;
  try {
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const buffer = await ctx.decodeAudioData(await media.arrayBuffer());
    if (buffer.duration > MAX_TRANSCRIBE_MINUTES * 60) {
      throw new UnsupportedDevice(`Transcripts work for videos up to ${MAX_TRANSCRIBE_MINUTES} minutes for now.`);
    }
    return Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => {
      const ch = new Float32Array(buffer.length);
      buffer.copyFromChannel(ch, c);
      return ch;
    });
  } catch (err) {
    if (err instanceof UnsupportedDevice) throw err;
    throw new UnsupportedDevice("Couldn't read the sound in this recording on this device.");
  } finally {
    void ctx?.close().catch(() => {});
  }
}

/** WebGPU only when the browser will actually hand out a graphics adapter. */
async function usableDevice(device: "webgpu" | "wasm"): Promise<"webgpu" | "wasm"> {
  if (device !== "webgpu") return device;
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return (await gpu?.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

const runModel: Transcriber = async (media, onProgress) => {
  const found = deviceSupport().device;
  if (!found) throw new UnsupportedDevice("This browser can't make transcripts.");
  const device = await usableDevice(found);
  const manifest = await fetchManifest();
  onProgress({ stage: "audio", fraction: 0 });
  const channels = await decodeAudio(media);
  const worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<Transcript>((resolve, reject) => {
      // A worker that runs out of memory can die without a word; don't wait forever.
      let heard = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - heard > STALL_MS) reject(new UnsupportedDevice("Transcription stopped responding on this device."));
      }, 15_000);
      const settle = <T,>(fn: (v: T) => void) => (v: T) => {
        clearInterval(watchdog);
        fn(v);
      };
      resolve = settle(resolve);
      reject = settle(reject);
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        heard = Date.now();
        const msg = e.data;
        if (msg.type === "progress") onProgress({ stage: msg.stage, fraction: msg.fraction, bytes: msg.bytes });
        else if (msg.type === "done") resolve(msg.transcript);
        else if (msg.cause === "server") reject(new ModelUnavailable(msg.message));
        else if (msg.cause === "download") reject(new ModelDownloadFailed(msg.message));
        else reject(new UnsupportedDevice(msg.message));
      };
      worker.onmessageerror = () => reject(new UnsupportedDevice("The transcription model couldn't start on this device."));
      worker.onerror = (e) => reject(new UnsupportedDevice(e.message || "The transcription model couldn't start on this device."));
      worker.postMessage({ channels, device, modelBase: modelBase(), manifest } satisfies WorkerIn, channels.map((c) => c.buffer));
    });
  } finally {
    worker.terminate();
  }
};

/** Makes a transcript of a (decrypted) recording on this device. */
export function transcribe(media: Blob, onProgress: (p: Progress) => void): Promise<Transcript> {
  return (window.__sureframeTranscribe ?? runModel)(media, onProgress);
}

export const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The transcript as plain text with times, which is what's sent for summarising. */
export const transcriptText = (t: Transcript) => t.segments.map((s) => `[${clock(s.start)}] ${s.text}`).join("\n");
