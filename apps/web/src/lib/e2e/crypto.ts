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

async function seal(plain: Uint8Array, key: CryptoKey) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, plain as BufferSource));
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv);
  out.set(ct, IV_BYTES);
  return out;
}

async function open(sealed: Uint8Array, key: CryptoKey) {
  const iv = sealed.subarray(0, IV_BYTES);
  return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, sealed.subarray(IV_BYTES) as BufferSource));
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
 * Encrypt one recorder chunk into a self-delimiting frame:
 *   [4-byte big-endian length][12-byte IV][ciphertext + 16-byte tag]
 * Frames concatenate into the stored file, so parts can be uploaded,
 * retried and joined without the server understanding them.
 */
export async function encryptFrame(chunk: Blob | Uint8Array, key: CryptoKey) {
  const plain = chunk instanceof Blob ? new Uint8Array(await chunk.arrayBuffer()) : chunk;
  const sealed = await seal(plain, key);
  const frame = new Uint8Array(4 + sealed.length);
  new DataView(frame.buffer).setUint32(0, sealed.length);
  frame.set(sealed, 4);
  return frame;
}

/**
 * Decrypt the complete frames at the start of a framed file, for a preview
 * from only the first part of a recording. A frame cut off at the end is left out.
 */
export async function decryptLeadingFrames(bytes: Uint8Array, key: CryptoKey): Promise<Uint8Array[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Uint8Array[] = [];
  let at = 0;
  while (at + 4 <= bytes.length) {
    const len = view.getUint32(at);
    if (at + 4 + len > bytes.length) break;
    out.push(await open(bytes.subarray(at + 4, at + 4 + len), key));
    at += 4 + len;
  }
  return out;
}

/** Decrypt a whole framed file back into the original recording bytes. */
export async function decryptFrames(data: ArrayBuffer, key: CryptoKey): Promise<Uint8Array[]> {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  const out: Uint8Array[] = [];
  let at = 0;
  while (at < bytes.length) {
    if (at + 4 > bytes.length) throw new Error("Recording is truncated");
    const len = view.getUint32(at);
    at += 4;
    if (at + len > bytes.length) throw new Error("Recording is truncated");
    out.push(await open(bytes.subarray(at, at + len), key));
    at += len;
  }
  return out;
}
