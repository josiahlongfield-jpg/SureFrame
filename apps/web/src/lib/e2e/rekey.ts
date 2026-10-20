import { decryptText, encryptText, fingerprint, generateKey, unwrapKey, wrapKey } from "./crypto";

export type Bundle = {
  fingerprint: string;
  /** `opened`: they opened their personal link; `held`: paused, or link turned off by support (not emailed either way). */
  clients: { id: string; name: string; hasEmail: boolean; email?: string | null; opened?: boolean; held?: boolean; teamKeyWrap: string; active: boolean }[];
  videos: { id: string; teamKeyWrap: string; clientKeyWrap: string | null; clientId: string | null }[];
  items: { id: string; body: string; clientId: string | null; shared: boolean }[];
};

/**
 * Re-seal everything under new keys, on this device. A new team key replaces
 * the old one, and every active client gets a new key. Video keys stay the
 * same (re-encrypting recordings would mean re-uploading them); they are just
 * re-wrapped, and the server stops handing the recordings to anyone removed.
 * Returns the new team key and the payload for the remove route.
 */
export async function rekey(oldTeam: CryptoKey, bundle: Bundle) {
  const from = await fingerprint(oldTeam);
  if (from !== bundle.fingerprint) throw new Error("This device's key is out of date. Reload the page and try again.");
  const team = await generateKey();
  const oldClient = new Map<string, CryptoKey>();
  const newClient = new Map<string, CryptoKey>();
  const clients = await Promise.all(
    bundle.clients.map(async (c) => {
      // A wrap that never opened with the team key can't be carried over; its link still changes.
      const old = await unwrapKey(c.teamKeyWrap, oldTeam).catch(() => null);
      if (!old) return { id: c.id, teamKeyWrap: c.teamKeyWrap };
      oldClient.set(c.id, old);
      if (!c.active) {
        // Removed clients' links already don't work; keep their key so the team can read their history, and restore them, until they're deleted.
        newClient.set(c.id, old);
        return { id: c.id, teamKeyWrap: await wrapKey(old, team) };
      }
      const next = await generateKey();
      newClient.set(c.id, next);
      return {
        id: c.id,
        teamKeyWrap: await wrapKey(next, team),
        rotation: { from: await fingerprint(old), fingerprint: await fingerprint(next), wrap: await wrapKey(next, old) },
      };
    }),
  );
  const videos = await Promise.all(
    bundle.videos.map(async (v) => {
      const key = await unwrapKey(v.teamKeyWrap, oldTeam).catch(() => null);
      if (!key) return { id: v.id, teamKeyWrap: v.teamKeyWrap, clientKeyWrap: v.clientKeyWrap };
      const clientKey = v.clientId ? newClient.get(v.clientId) : undefined;
      return { id: v.id, teamKeyWrap: await wrapKey(key, team), clientKeyWrap: v.clientKeyWrap && clientKey ? await wrapKey(key, clientKey) : v.clientKeyWrap };
    }),
  );
  const items = await Promise.all(
    bundle.items.map(async (i) => {
      const shared = i.shared && i.clientId;
      const oldKey = shared ? oldClient.get(i.clientId!) : oldTeam;
      const newKey = shared ? newClient.get(i.clientId!) : team;
      if (!oldKey || !newKey) return { id: i.id, body: i.body };
      try {
        return { id: i.id, body: await encryptText(await decryptText(i.body, oldKey), newKey) };
      } catch {
        // Already unreadable; leave it as it was.
        return { id: i.id, body: i.body };
      }
    }),
  );
  return {
    team,
    newClientKeys: newClient,
    payload: { from, fingerprint: await fingerprint(team), teamWrap: await wrapKey(team, oldTeam), clients, videos, items },
  };
}
