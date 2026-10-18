import { exportKey, fingerprint, importKey, unwrapKey } from "./crypto";
import { markKeyHeld } from "./keyHeld";

/**
 * Keys kept on this device only. The team key unlocks everything the team
 * owns; a client key unlocks what was sent to that client.
 */
const PREFIX = "framecast.key.";
const CLIENT_PREFIX = "client:";

function get(name: string) {
  try {
    return localStorage.getItem(PREFIX + name);
  } catch {
    return null;
  }
}

function set(name: string, value: string) {
  try {
    localStorage.setItem(PREFIX + name, value);
  } catch {
    /* storage blocked; the key stays usable for this page only */
  }
}

export async function loadKey(name: string) {
  const text = get(name);
  if (!text) return null;
  try {
    return await importKey(text);
  } catch {
    return null;
  }
}

export async function saveKey(name: string, key: CryptoKey) {
  set(name, await exportKey(key));
  // The server then lists this client's videos on this device (lib/e2e/keyHeld.ts).
  if (name.startsWith(CLIENT_PREFIX) && get(name)) markKeyHeld(name.slice(CLIENT_PREFIX.length), true);
  // Ask the browser not to clear this site's storage on its own (Safari otherwise can after a week without a visit).
  void navigator.storage?.persist?.().catch(() => {});
}

export const teamKeyName = (workspaceId: string) => `team:${workspaceId}`;
export const clientKeyName = (clientId: string) => `${CLIENT_PREFIX}${clientId}`;

type Chain = { fingerprint: string | null; rotations: { from: string; wrap: string }[] };

/**
 * After a key reset, follow the chain of rotations from a key this device
 * holds to the current one. Returns null if the chain doesn't reach it.
 */
export async function followRotations(key: CryptoKey, chain: Chain): Promise<CryptoKey | null> {
  if (!chain.fingerprint) return key;
  let current = key;
  for (let i = 0; i <= chain.rotations.length; i++) {
    const fp = await fingerprint(current);
    if (fp === chain.fingerprint) return current;
    const step = chain.rotations.find((r) => r.from === fp);
    if (!step) return null;
    current = await unwrapKey(step.wrap, current);
  }
  return null;
}

/**
 * The client's key on this device, brought up to date if their business has
 * reset its keys since this device last saw it.
 */
export async function loadClientKey(clientId: string): Promise<CryptoKey | null> {
  const local = await loadKey(clientKeyName(clientId));
  if (!local) {
    markKeyHeld(clientId, false);
    return null;
  }
  const res = await fetch(`/api/clients/${clientId}/key`).catch(() => null);
  if (!res?.ok) return local;
  const next = await followRotations(local, await res.json()).catch(() => null);
  if (next && next !== local) await saveKey(clientKeyName(clientId), next);
  // A key that can't reach the current one opens nothing here.
  markKeyHeld(clientId, !!next);
  return next;
}
