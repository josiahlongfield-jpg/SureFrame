/// <reference lib="webworker" />
// On-device speech to text for the AI summaries add-on. Runs Whisper in this
// worker with Transformers.js (WebGPU when available, otherwise WebAssembly).
// Audio arrives already decoded and never leaves the device. The model and
// runtime are served by SureFrame itself (/models, which hands out files from
// our own storage) at the revision in the installed manifest. Every model file
// is checked against the manifest's sha256 before use, including copies kept
// on this device; this worker refuses to fetch anything else.
import type { TranscriptSegment, WorkerIn, WorkerOut } from "./transcribe";
import { ONNX_FOR, type ModelManifest } from "./modelManifest";

const SAMPLE_RATE = 16_000;
/** Audio is handled in two-minute pieces so progress can be shown. */
const SEGMENT_SECONDS = 120;
/** This device's copy of verified model files, keyed by their stable /models URL. */
const CACHE = "sureframe-models-v1";

const post = (msg: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

type Asr = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>;
let loading: Promise<Asr> | null = null;

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (body: Uint8Array) => hex(await crypto.subtle.digest("SHA-256", body as Uint8Array<ArrayBuffer>));
const BAD_DOWNLOAD = "The transcription model didn't download correctly.";
/** The model on our server is missing or broken: nothing to do with this device. */
class ServerModelError extends Error {}
/** The model files didn't arrive intact (a dropped connection, usually): worth another try. */
class DownloadError extends Error {}

async function openCache() {
  try {
    return typeof caches === "undefined" ? null : await caches.open(CACHE);
  } catch {
    return null; // e.g. storage blocked: download each time instead
  }
}

/**
 * Gets every model file this device needs, each checked against the manifest
 * before anything reads it: from this device's copy when it has one, else
 * downloaded once and kept.
 */
async function fetchVerified(manifest: ModelManifest, prefix: string, names: string[]) {
  const cache = await openCache();
  const wanted = new Set(Object.keys(manifest.files).map((n) => prefix + n));
  // Drop copies of other revisions (an older install).
  if (cache) for (const req of await cache.keys().catch(() => [])) if (!wanted.has(req.url)) await cache.delete(req).catch(() => {});

  const total = names.reduce((n, name) => n + manifest.files[name].bytes, 0);
  const got = new Map<string, number>();
  const report = () => post({ type: "progress", stage: "download", fraction: [...got.values()].reduce((a, b) => a + b, 0) / total, bytes: total });
  const out = new Map<string, Uint8Array>();
  for (const name of names) {
    const expected = manifest.files[name];
    const url = prefix + name;
    const kept = await cache?.match(url).catch(() => undefined);
    if (kept) {
      const body = new Uint8Array(await kept.arrayBuffer());
      if ((await sha256(body)) === expected.sha256) {
        out.set(name, body);
        got.set(name, expected.bytes);
        report();
        continue;
      }
      await cache?.delete(url).catch(() => {});
    }
    // Same-origin request; /models answers with a redirect to our storage bucket.
    const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    if (!res.ok || !res.body) throw new ServerModelError(`Couldn't download the transcription model (${res.status}).`);
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      n += value.length;
      if (n > expected.bytes) throw new DownloadError(BAD_DOWNLOAD);
      got.set(name, n);
      report();
    }
    const body = new Uint8Array(n);
    let at = 0;
    for (const p of parts) {
      body.set(p, at);
      at += p.length;
    }
    if (n !== expected.bytes || (await sha256(body)) !== expected.sha256) throw new DownloadError(BAD_DOWNLOAD);
    await cache?.put(url, new Response(body, { headers: { "Content-Type": "application/octet-stream" } })).catch(() => {});
    out.set(name, body);
  }
  return out;
}

async function load(device: "webgpu" | "wasm", modelBase: string, manifest: ModelManifest): Promise<Asr> {
  const prefix = `${modelBase}${manifest.model}/${manifest.revision}/`;
  const needed = [...Object.keys(manifest.files).filter((n) => !n.includes("/") && n.endsWith(".json")), ...ONNX_FOR[device]];
  if (needed.some((n) => !manifest.files[n])) throw new ServerModelError("The transcription model on this server is incomplete.");
  // Everything is checked before the model code even loads.
  const verified = await fetchVerified(manifest, prefix, needed);

  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = modelBase;
  // Pinned in the path itself: some files are requested with the default
  // revision ("main"), which would miss the installed copy.
  env.remotePathTemplate = `{model}/${manifest.revision}/`;
  // Its own browser cache would skip the checks above; ours keeps verified copies instead.
  env.useBrowserCache = false;
  // The ONNX runtime comes from our own site too (copied there on install).
  const ort = `${self.location.origin}/ort/`;
  const safari = /^((?!chrome|android).)*safari/i.test(self.navigator.userAgent);
  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = safari
      ? { mjs: `${ort}ort-wasm-simd-threaded.mjs`, wasm: `${ort}ort-wasm-simd-threaded.wasm` }
      : { mjs: `${ort}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${ort}ort-wasm-simd-threaded.asyncify.wasm` };
  }

  // Only the verified files of the installed revision; anything else is "not found".
  env.fetch = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(ort)) return fetch(url, init);
    const name = url.startsWith(prefix) ? url.slice(prefix.length).split("?")[0] : null;
    const body = name ? verified.get(name) : undefined;
    if (!body) return new Response(null, { status: 404 });
    return new Response(body as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": "application/octet-stream", "Content-Length": String(body.length) } });
  };

  try {
    const asr = await pipeline("automatic-speech-recognition", manifest.model, {
      revision: manifest.revision,
      device,
      dtype: device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : { encoder_model: "q8", decoder_model_merged: "q8" },
    });
    return asr as unknown as Asr;
  } finally {
    verified.clear(); // the model holds what it needs; free the copies
  }
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const { channels, device, modelBase, manifest } = e.data;
  try {
    // Mix down to mono here, off the page's main thread.
    const audio = channels.length === 1 ? channels[0] : new Float32Array(channels[0].length);
    if (channels.length > 1) for (const ch of channels) for (let i = 0; i < ch.length; i++) audio[i] += ch[i] / channels.length;

    // Some browsers (Brave, for one) report WebGPU but won't run the model on
    // it; fall back to the processor, which works in every modern browser.
    loading ??= load(device, modelBase, manifest).catch((err) => {
      if (device !== "webgpu") throw err;
      post({ type: "progress", stage: "download", fraction: 0 });
      return load("wasm", modelBase, manifest);
    });
    const asr = await loading;
    const segments: TranscriptSegment[] = [];
    const step = SEGMENT_SECONDS * SAMPLE_RATE;
    for (let start = 0; start < audio.length; start += step) {
      post({ type: "progress", stage: "transcribe", fraction: start / audio.length });
      const piece = audio.subarray(start, Math.min(audio.length, start + step));
      const offset = start / SAMPLE_RATE;
      const out = await asr(piece, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true, task: "transcribe" });
      for (const c of out.chunks ?? [{ timestamp: [0, piece.length / SAMPLE_RATE] as [number, number], text: out.text }]) {
        const text = c.text.trim();
        if (!text) continue;
        segments.push({ start: offset + (c.timestamp[0] ?? 0), end: offset + (c.timestamp[1] ?? piece.length / SAMPLE_RATE), text });
      }
    }
    post({ type: "done", transcript: { v: 1, segments } });
  } catch (err) {
    loading = null;
    // Says whose problem it was, so the page doesn't blame this device for our server or the connection.
    const cause = err instanceof ServerModelError ? "server" : err instanceof DownloadError || err instanceof TypeError ? "download" : "device";
    post({ type: "error", message: (err as Error)?.message ?? String(err), cause });
  }
};
