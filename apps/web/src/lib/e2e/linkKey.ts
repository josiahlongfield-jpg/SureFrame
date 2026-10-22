import { fingerprint, importKey, unwrapKey } from "./crypto";
import { clientKeyName, followRotations, loadKey, saveKey } from "./keystore";

/**
 * What became of the key in a personal link's #k=… part:
 * - "none": the address had no key (an email link, or a link cut short before its #);
 * - "saved": it's this client's key, now kept on this device;
 * - "wrong": it isn't (one character off, or cut short), so it was NOT saved and any key this device already
 *   had is kept. A mistyped or truncated forward of a link must never wipe a key that works (C57).
 */
export type LinkKeyResult = "none" | "saved" | "wrong";

/** The link's key, if the address has one. */
export const linkKeyText = () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.hash.slice(1)).get("k"));

/**
 * Whether `key` is this client's key: it leads to their current key (after a key reset), or it unwraps one of
 * their videos' keys (`wrap`: the video on screen, or one the server picks). Null when there's nothing to check it
 * against (no video yet, and no key reset), or the check couldn't be made (offline).
 */
export async function keyFits(clientId: string, key: CryptoKey, wrap?: string | null): Promise<boolean | null> {
  const res = await fetch(`/api/clients/${clientId}/key`).catch(() => null);
  const chain = res?.ok ? ((await res.json().catch(() => null)) as { fingerprint: string | null; rotations: { from: string; wrap: string }[]; check?: string | null } | null) : null;
  if (chain?.fingerprint) {
    if ((await fingerprint(key)) === chain.fingerprint) return true;
    return (await followRotations(key, chain).catch(() => null)) !== null;
  }
  const against = wrap ?? chain?.check ?? null;
  if (!against) return null;
  return unwrapKey(against, key).then(
    () => true,
    () => false,
  );
}

/**
 * Takes the key from a personal link's #k=… part: checks it really is this client's key, saves it on this device
 * only if so, and hides it from the address bar either way. `wrap` is a video key wrapped with the client's key,
 * when the page has one to check against.
 */
export async function takeLinkKey(clientId: string, wrap?: string | null): Promise<LinkKeyResult> {
  const text = linkKeyText();
  if (!text) return "none";
  try {
    let key: CryptoKey | null = null;
    try {
      key = await importKey(text);
    } catch {
      return "wrong";
    }
    const fits = await keyFits(clientId, key, wrap);
    if (fits === false) return "wrong";
    // Nothing to check it against: keep a key this device already has rather than swap it for one that can't be checked.
    if (fits === null && (await loadKey(clientKeyName(clientId)))) return "saved";
    await saveKey(clientKeyName(clientId), key);
    void fetch(`/api/clients/${clientId}/opened`, { method: "POST" }).catch(() => {});
    return "saved";
  } finally {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}
