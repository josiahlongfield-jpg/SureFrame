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

/**
 * Someone who hasn't agreed to the current terms ticks the box here, and agreeing and joining happen in one press.
 * Someone without a name gives it here too, so clients see who sent their videos from the start.
 */
export default function JoinTeam({ token, signedIn, agreed, needsName = false, business }: { token: string; signedIn: boolean; agreed: boolean; needsName?: boolean; business: string }) {
  const [inviteKey, setInviteKey] = useState<string | null>(null);
  // Where the key came from: this page's address, or this browser from an earlier visit (signing in drops the #part).
  const [fromLink, setFromLink] = useState(false);
  const [name, setName] = useState("");
  const [ticked, setTicked] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.hash.slice(1)).get("k");
    setFromLink(!!fromLink);
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
      const res = await fetch("/api/team/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...(agreed ? {} : { agree: ticked }), ...(name.trim() ? { name: name.trim() } : {}) }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data.code === "TERMS_REQUIRED") throw new Error("Tick the box to agree to the Terms of Service and Privacy Policy.");
      if (!res.ok) throw new Error(data.error ?? "Could not join the team");
      const teamKey = await unwrapKey(data.teamKeyWrap, await importKey(inviteKey)).catch(() => {
        throw new Error("This invite link is damaged. Ask for a new one.");
      });
      if (data.fingerprint && (await fingerprint(teamKey)) !== data.fingerprint) throw new Error("This invite link is out of date. Ask for a new one.");
      await saveKey(teamKeyName(data.workspaceId), teamKey);
      try {
        localStorage.removeItem(stash(token));
      } catch {}
      // The library then shows the team's recovery key once, to save (components/RecoveryKey.tsx).
      window.location.assign("/library?joined=1");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (inviteKey === null) {
    return (
      <p className="mt-6 text-sm text-warn-fg" data-testid="join-no-key">
        This page needs the whole invite link, including the part after the # at the end: it holds the key to your team&apos;s encrypted videos. Open the link exactly as it was
        sent to you, in this browser. If you opened it on another device, you can finish joining there.
      </p>
    );
  }
  return (
    <div className="mt-6 grid gap-3">
      {signedIn ? (
        <>
          {needsName && (
            <label className="grid gap-1 text-sm text-ink">
              <span className="font-medium">Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" placeholder="The name your clients know you by" data-testid="join-name" className="rounded-lg border border-line-strong bg-surface px-3 py-2" />
              <span className="text-xs text-dim">Clients see it on the videos you send, as &ldquo;{name.trim() || "Your name"} from {business}&rdquo;. You can change it later under Settings &gt; Account.</span>
            </label>
          )}
          {!agreed && (
            <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm text-ink">
              <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} data-testid="join-agree" className="mt-0.5 h-5 w-5 shrink-0 accent-primary" />
              <span>
                I have read and agree to the{" "}
                <a href="/legal/terms" target="_blank" rel="noopener" className="font-medium text-accent underline">Terms of Service</a> and{" "}
                <a href="/legal/privacy" target="_blank" rel="noopener" className="font-medium text-accent underline">Privacy Policy</a>
              </span>
            </label>
          )}
          <button onClick={join} disabled={busy || (!agreed && !ticked)} data-testid="join-team" className="rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
            {busy ? "Joining…" : agreed ? "Join the team" : "Agree and join"}
          </button>
        </>
      ) : (
        <Link href={`/login?next=${encodeURIComponent(`/join/${token}`)}`} className="rounded-xl bg-primary px-4 py-3 text-center font-semibold text-on-primary hover:bg-primary-hover">
          Sign in to join
        </Link>
      )}
      <p className="text-xs text-dim" data-testid="join-key-note">
        {fromLink
          ? "Videos stay end-to-end encrypted. This link holds the key that lets your device open them, so don't share it."
          : "Videos stay end-to-end encrypted. The key from your invite link was kept in this browser when you first opened it, so you can join here."}
      </p>
      {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
    </div>
  );
}
