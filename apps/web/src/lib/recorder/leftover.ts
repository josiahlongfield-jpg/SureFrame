import { decryptFrames, unwrapKey } from "@/lib/e2e/crypto";
import * as store from "./store";

/**
 * The last part of a recording the server finished early (lib/recorder/uploader.ts keepLeftover): only in this
 * browser, so it's offered as a file to save rather than dropped. The file is the whole recording, the part in the
 * library with the rest after it, as one video that plays: the rest on its own carries on from the middle of the
 * recording and wouldn't play. Everything is opened here, with the team's key; nothing readable goes to the server.
 */

/** Recordings with a part kept here, the latest first. Not replies: they're opened with another key (see keepLeftover). */
export async function listLeftovers() {
  const all = await store.listSessions();
  return all.filter((s) => s.leftover && !s.replyTo).sort((a, b) => b.startedAt - a.startedAt);
}

const fileName = (title: string) => title.replace(/[^\w\- ]+/g, "").trim() || "recording";

/**
 * Puts the whole recording together and saves it to this device: the server's copy, then each chunk kept here that
 * comes after it, in order. They're joined as stored (still encrypted) and opened in one go, exactly as a recording
 * that uploaded in full would be, so they're read the same way. "nothing": the server's copy had it all after all.
 */
export async function saveLeftover(videoId: string, teamKey: CryptoKey): Promise<"saved" | "nothing"> {
  const res = await fetch(`/api/videos/${videoId}`);
  if (!res.ok) throw new Error(`Video ${res.status}`);
  const { video } = (await res.json()) as { video: { title: string; mimeType: string; rawUrl: string; teamKeyWrap: string | null } };
  if (!video.teamKeyWrap) throw new Error("No key for this recording");
  const key = await unwrapKey(video.teamKeyWrap, teamKey);
  const file = await fetch(video.rawUrl);
  if (!file.ok) throw new Error(`Recording ${file.status}`);
  const saved = await file.arrayBuffer();
  const rest = (await store.getChunks(videoId)).sort((a, b) => a.seq - b.seq).filter((c) => (c.offset ?? 0) >= saved.byteLength);
  if (!rest.length) return "nothing";
  const whole = await new Blob([saved, ...rest.map((c) => c.blob)]).arrayBuffer();
  const parts = await decryptFrames(whole, key);
  // A recording sealed chunk by chunk with each one's place (lib/e2e/crypto.ts) stops opening where the rest doesn't
  // carry straight on from the saved part: the file would be no more than the library's copy, so it isn't offered.
  if ((parts as { cut?: boolean }).cut) throw new Error("The rest doesn't follow on from the saved part");
  const type = video.mimeType.split(";")[0];
  const url = URL.createObjectURL(new Blob(parts as BlobPart[], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${fileName(video.title)}.${type.includes("mp4") ? "mp4" : "webm"}` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "saved";
}

/** Forgets the part kept here (saved, or not wanted). */
export const removeLeftover = (videoId: string) => store.removeSession(videoId);
