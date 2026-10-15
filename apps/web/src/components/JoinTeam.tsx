"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fingerprint, importKey, unwrapKey } from "@/lib/e2e/crypto";
import { saveKey, teamKeyName } from "@/lib/e2e/keystore";

/**
 * The invite link's #fragment holds the one-off key that unlocks the team
 * key. Signing in leaves this page (and may happen in another tab, from an
 * email link), so the fragment is kept in localStorage until the invite is
 * accepted.
 */
const stash = (token: string) => `framecast.invite:${token}`;

export default function JoinTeam({ token, signedIn }: { token: string; signedIn: boolean }) {
  const [inviteKey, setInviteKey] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.hash.slice(1)).get("k");
    try {
      if (fromLink) localStorage.setItem(stash(token), fromLink);
      setInviteKey(fromLink ?? localStorage.getItem(stash(token)));
    } catch {
      setInviteKey(fromLink);
    }
  }, [token]);

  async function join() {
    if (!inviteKey) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/team/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await res.json().catch(() => ({}));
      // Agree to the current terms first, then come back here (the invite key waits in localStorage).
      if (res.status === 403 && data.code === "TERMS_REQUIRED") return window.location.assign(`/agree?next=${encodeURIComponent(`/join/${token}`)}`);
      if (!res.ok) throw new Error(data.error ?? "Could not join the team");
      const teamKey = await unwrapKey(data.teamKeyWrap, await importKey(inviteKey)).catch(() => {
        throw new Error("This invite link is damaged. Ask for a new one.");
      });
      if (data.fingerprint && (await fingerprint(teamKey)) !== data.fingerprint) throw new Error("This invite link is out of date. Ask for a new one.");
      await saveKey(teamKeyName(data.workspaceId), teamKey);
      try {
        localStorage.removeItem(stash(token));
      } catch {}
      window.location.assign("/library");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (inviteKey === null) {
    return <p className="mt-6 text-sm text-warn-fg">This link is missing its security key. Open the full link exactly as it was sent to you.</p>;
  }
  return (
    <div className="mt-6 grid gap-3">
      {signedIn ? (
        <button onClick={join} disabled={busy} className="rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
          {busy ? "Joining…" : "Join the team"}
        </button>
      ) : (
        <Link href={`/login?next=${encodeURIComponent(`/join/${token}`)}`} className="rounded-xl bg-primary px-4 py-3 text-center font-semibold text-on-primary hover:bg-primary-hover">
          Sign in to join
        </Link>
      )}
      <p className="text-xs text-dim">Videos stay end-to-end encrypted. This link carries the key that lets your device open them, so don&apos;t share it.</p>
      {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
    </div>
  );
}
