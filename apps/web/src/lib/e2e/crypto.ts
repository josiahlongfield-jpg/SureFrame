/**
 * End-to-end encryption for recordings, replies and keys (Web Crypto, AES-256-GCM).
 *
 * Key hierarchy:
 *   team key (per workspace, lives only on the team's devices)
 *     ├─ wraps each client key        → Client.teamKeyWrap
 *     └─ wraps each video key         → Video.teamKeyWrap
 *   client key (travels only in the personal link's #fragment)
 *     └─ wraps videos sent to them    → Video.clientKeyWrap
 *   video key (random per recording)
 *     ├─ encrypts the recording, chunk by chunk
 *     ├─ encrypts text replies in its conversation
 *     └─ wraps each reply's media key → Video.parentKeyWrap
 *
 * The server only ever stores ciphertext and wrapped keys.
 */

const ALG = { name: "AES-GCM", length: 256 } as const;
const IV_BYTES = 12;
const subtle = () => globalThis.crypto.subtle;

export function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(text: string) {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function generateKey(): Promise<CryptoKey> {
  return subtle().generateKey(ALG, true, ["encrypt", "decrypt"]);
}

export async function exportKey(key: CryptoKey) {
  return b64url(new Uint8Array(await subtle().exportKey("raw", key)));
}

export async function importKey(text: string): Promise<CryptoKey> {
  const raw = fromB64url(text.trim());
  if (raw.length !== 32) throw new Error("That key isn't valid");
  return subtle().importKey("raw", raw as BufferSource, ALG, true, ["encrypt", "decrypt"]);
}

/** Short public identifier of a key, so the server can tell devices which key is current. */
export async function fingerprint(key: CryptoKey) {
  const raw = new Uint8Array(await subtle().exportKey("raw", key));
  const digest = new Uint8Array(await subtle().digest("SHA-256", raw));
  return b64url(digest).slice(0, 22);
}

/** `aad`: authenticated context (a recording chunk's position); it isn't stored, so opening needs the same again. */
async function seal(plain: Uint8Array, key: CryptoKey, aad?: Uint8Array) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const params: AesGcmParams = aad ? { name: "AES-GCM", iv, additionalData: aad as BufferSource } : { name: "AES-GCM", iv };
  const ct = new Uint8Array(await subtle().encrypt(params, key, plain as BufferSource));
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv);
  out.set(ct, IV_BYTES);
  return out;
}

async function open(sealed: Uint8Array, key: CryptoKey, aad?: Uint8Array) {
  const iv = sealed.subarray(0, IV_BYTES) as BufferSource;
  const params: AesGcmParams = aad ? { name: "AES-GCM", iv, additionalData: aad as BufferSource } : { name: "AES-GCM", iv };
  return new Uint8Array(await subtle().decrypt(params, key, sealed.subarray(IV_BYTES) as BufferSource));
}

export async function wrapKey(key: CryptoKey, wrappingKey: CryptoKey) {
  return b64url(await seal(new Uint8Array(await subtle().exportKey("raw", key)), wrappingKey));
}

export async function unwrapKey(wrapped: string, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const raw = await open(fromB64url(wrapped), wrappingKey);
  return subtle().importKey("raw", raw as BufferSource, ALG, true, ["encrypt", "decrypt"]);
}

export async function encryptText(text: string, key: CryptoKey) {
  return b64url(await seal(new TextEncoder().encode(text), key));
}

export async function decryptText(sealed: string, key: CryptoKey) {
  return new TextDecoder().decode(await open(fromB64url(sealed), key));
}

export async function encryptBytes(bytes: Uint8Array, key: CryptoKey) {
  return b64url(await seal(bytes, key));
}

export async function decryptBytes(sealed: string, key: CryptoKey) {
  return open(fromB64url(sealed), key);
}

/**
 * Recordings are sealed chunk by chunk into self-delimiting frames:
 *   [4-byte big-endian length][12-byte IV][ciphertext + 16-byte tag]
 * Frames concatenate into the stored file, so parts can be uploaded,
 * retried and joined without the server understanding them.
 *
 * Two kinds, and a file is all one or the other:
 * - position-bound (every recording made from 3 December 2026, see POSITIONED_FROM): the length's top bit is set, and each chunk is
 *   sealed with its place in the recording (0, 1, 2 ...) as authenticated data, so a chunk moved, repeated or taken
 *   out by anyone holding the stored file no longer opens where it ends up;
 * - the first kind (recordings made before then), with no position: still read exactly as before.
 * A cut-off end can't be told from a recording that stopped there (the server finishes interrupted ones as they are).
 */
const POSITIONED = 0x80000000;
/** When new recordings start being position-bound: a week after the reader shipped (tests set it earlier). */
const POSITIONED_FROM = Date.parse(process.env.NEXT_PUBLIC_CHUNK_V2_FROM || "2026-12-03T00:00:00Z");
const CHUNK_LABEL = new TextEncoder().encode("sureframe recording chunk v2 #");

function chunkAad(index: number) {
  const aad = new Uint8Array(CHUNK_LABEL.length + 4);
  aad.set(CHUNK_LABEL);
  new DataView(aad.buffer).setUint32(CHUNK_LABEL.length, index);
  return aad;
}

/** Encrypt one recorder chunk into a frame. `index`: its place in the recording (use frameSealer); without it, the first kind. */
export async function encryptFrame(chunk: Blob | Uint8Array, key: CryptoKey, index?: number) {
  const plain = chunk instanceof Blob ? new Uint8Array(await chunk.arrayBuffer()) : chunk;
  const positioned = index !== undefined;
  const sealed = await seal(plain, key, positioned ? chunkAad(index) : undefined);
  const frame = new Uint8Array(4 + sealed.length);
  new DataView(frame.buffer).setUint32(0, positioned ? POSITIONED + sealed.length : sealed.length);
  frame.set(sealed, 4);
  return frame;
}

/**
 * Seals one recording's chunks, each with its place in it: one sealer per recording. Chunks are taken in the order
 * they're given, one at a time, and a chunk that fails to seal uses up no place (so what follows still opens).
 */
export function frameSealer(key: CryptoKey) {
  // Before POSITIONED_FROM new recordings still use the first kind, so a tab left open from before the release
  // (or a rollback to it) can open everything made until then; from then on every new recording is position-bound.
  const positioned = !(Date.now() < POSITIONED_FROM);
  let next = 0;
  let queue: Promise<unknown> = Promise.resolve();
  return (chunk: Blob | Uint8Array): Promise<Uint8Array> => {
    const run = queue.then(async () => {
      const frame = await encryptFrame(chunk, key, positioned ? next : undefined);
      next++;
      return frame;
    });
    queue = run.catch(() => {});
    return run;
  };
}

/**
 * Reads a framed file in order, as it arrives (push each piece) or all at once. The first kind reads as it always
 * has: a frame that doesn't open fails the whole file. In a position-bound file, a frame that doesn't open at its
 * place (moved, repeated, taken out or damaged) ends the reading there: what came before is kept and `cut` is set.
 */
export class FrameReader {
  cut = false;
  private parts: Uint8Array[] = [];
  private size = 0;
  private positioned?: boolean;
  private index = 0;
  private key: CryptoKey;

  constructor(key: CryptoKey) {
    this.key = key;
  }

  /** Adds the next bytes of the file; resolves with the chunks they complete. */
  async push(bytes: Uint8Array): Promise<Uint8Array[]> {
    const out: Uint8Array[] = [];
    if (this.cut) return out;
    if (bytes.length) {
      this.parts.push(bytes);
      this.size += bytes.length;
    }
    while (this.size >= 4) {
      const head = this.first(4);
      const word = new DataView(head.buffer, head.byteOffset, 4).getUint32(0);
      this.positioned ??= word >= POSITIONED;
      if (this.positioned && word < POSITIONED) {
        // A frame of the first kind in a position-bound file (something else sealed with the same key): not this recording.
        this.stop();
        break;
      }
      const len = this.positioned ? word - POSITIONED : word;
      if (this.size < 4 + len) break;
      const frame = this.first(4 + len).subarray(4);
      this.drop(4 + len);
      if (!this.positioned) {
        out.push(await open(frame, this.key));
        continue;
      }
      try {
        out.push(await open(frame, this.key, chunkAad(this.index)));
        this.index++;
      } catch {
        this.stop();
        break;
      }
    }
    return out;
  }

  /** The end of the file. Bytes left over are a frame cut short: the first kind fails as before, the other is kept up to there. */
  finish() {
    if (this.cut || !this.size) return;
    if (!this.positioned) throw new Error("Recording is truncated");
    this.stop();
  }

  private stop() {
    this.cut = true;
    this.parts = [];
    this.size = 0;
  }

  /** The first `n` bytes (there are at least that many), joined into one piece if they're spread over several. */
  private first(n: number) {
    if (this.parts[0].length < n) {
      const joined = new Uint8Array(this.size);
      let at = 0;
      for (const p of this.parts) {
        joined.set(p, at);
        at += p.length;
      }
      this.parts = [joined];
    }
    return this.parts[0].subarray(0, n);
  }

  private drop(n: number) {
    this.parts[0] = this.parts[0].subarray(n);
    if (!this.parts[0].length) this.parts.shift();
    this.size -= n;
  }
}

/**
 * Decrypt the complete frames at the start of a framed file, for a preview
 * from only the first part of a recording. A frame cut off at the end is left out.
 */
export async function decryptLeadingFrames(bytes: Uint8Array, key: CryptoKey): Promise<Uint8Array[]> {
  return new FrameReader(key).push(bytes);
}

/**
 * Decrypt a whole framed file back into the original recording bytes. `cut`: a position-bound recording whose
 * frames stop being in order part way; only what came before is returned.
 */
export async function decryptFrames(data: ArrayBuffer, key: CryptoKey): Promise<Uint8Array[] & { cut?: boolean }> {
  const reader = new FrameReader(key);
  const out = await reader.push(new Uint8Array(data));
  reader.finish();
  // Nothing in order at all: as unreadable as with the wrong key.
  if (reader.cut && !out.length) throw new Error("Recording is damaged");
  return Object.assign(out, { cut: reader.cut });
}
