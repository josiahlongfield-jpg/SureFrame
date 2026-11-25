"use client";

import { useEffect, useRef, useState } from "react";
import { fingerprint as keyFingerprint, generateKey, importKey } from "@/lib/e2e/crypto";
import { canKeepKey, dropKey, followRotations, loadKey, saveKey, teamKeyName } from "@/lib/e2e/keystore";

/** Sent when this device has just made the team's key (the first device of a new business); components/RecoveryKey.tsx shows it. */
export const KEY_CREATED = "sureframe-team-key-created";

type State =
  | { kind: "loading" }
  | { kind: "ready"; key: CryptoKey }
  | { kind: "recover"; error?: string }
  // A new business's key couldn't be set up just now: there's no recovery key to ask for yet, only another go.
  // `blocked`: because this browser won't keep a key (its storage for the site is blocked or full).
  | { kind: "setup-failed"; blocked?: boolean };

/**
 * How making a new business's key went: the key, "taken" (another device already set one, so this one needs the
 * recovery key), "failed" (no connection, a server error, an expired session: it can be tried again, with the same
 * key), or "blocked" (this browser can't keep a key, so none was made and nothing was set).
 */
type Created = { key: CryptoKey } | "taken" | "failed" | "blocked";

/**
 * Creating the team key must happen once per workspace even if the gate
 * mounts twice at the same moment (React dev mode, a quick navigation).
 * Otherwise two keys race, one loses with a 409, and a brand-new account is
 * asked for a recovery key it was never shown.
 */
const creating = new Map<string, Promise<Created>>();
function createTeamKey(workspaceId: string) {
  let pending = creating.get(workspaceId);
  if (!pending) {
    pending = (async (): Promise<Created> => {
      try {
        // The key of an earlier go that never heard back is used again: the server may have registered it although
        // its answer was lost, and a different key would then be refused and a recovery key asked for that nobody
        // was ever shown. It waits under a name of its own until the server has it.
        const waiting = `${teamKeyName(workspaceId)}.waiting`;
        const key = (await loadKey(waiting)) ?? (await generateKey());
        // Before the server hears of this key, make sure this browser will keep it: saving fails without any error
        // where site storage is blocked or full, and a key registered but never kept is gone with this page, along
        // with every video made with it.
        if (!(await canKeepKey(teamKeyName(workspaceId), key))) return "blocked";
        await saveKey(waiting, key);
        const res = await fetch("/api/workspace/key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fingerprint: await keyFingerprint(key) }),
        }).catch(() => null);
        // Only a 409 means a different key already exists somewhere else (api/workspace/key), so this one is no use.
        // Any other failure may or may not have set it: the same key is sent again next time.
        if (res?.status === 409) dropKey(waiting);
        if (!res?.ok) return res?.status === 409 ? "taken" : "failed";
        await saveKey(teamKeyName(workspaceId), key);
        dropKey(waiting);
        // The header shows the new recovery key until it's saved (components/RecoveryKey.tsx).
        window.dispatchEvent(new CustomEvent(KEY_CREATED, { detail: workspaceId }));
        return { key };
      } catch {
        return "failed";
      }
    })();
    creating.set(workspaceId, pending);
    // Anything but the key itself is forgotten, so Try again (or the next page) starts afresh.
    void pending.then((r) => typeof r === "string" && creating.delete(workspaceId));
  }
  return pending;
}

export const UNLOCKED = "sureframe-team-key-unlocked";

/**
 * If the team's keys were reset (someone left), bring a key this device or
 * this person holds up to date. Only current members are given the chain.
 */
async function catchUp(workspaceId: string, key: CryptoKey) {
  const res = await fetch("/api/team/keys").catch(() => null);
  if (!res?.ok) return null;
  const next = await followRotations(key, await res.json()).catch(() => null);
  if (next) await saveKey(teamKeyName(workspaceId), next);
  return next;
}

/**
 * This device's copy of the team's end-to-end key: loads it, brings it up to date after a key reset, or (the first
 * device of a new business) creates it. While it's missing, `state` is "recover" and `recover` takes the recovery
 * key. Every gate on a page opens together (UNLOCKED). Pages that work without the key (the Clients list, Decision 15)
 * use this directly and lock only what needs it; TeamKeyGate below locks a whole part of the page.
 */
export function useTeamKey(workspaceId: string, fingerprint: string | null, onUnlock?: () => void) {
  const [state, setState] = useState<State>({ kind: "loading" });
  // Bumped when another gate on the page unlocks, so every gate opens together.
  const [unlockedElsewhere, setUnlockedElsewhere] = useState(0);
  // Bumped by Try again after a key set-up that didn't go through.
  const [attempt, setAttempt] = useState(0);
  const locked = useRef(false);
  locked.current = state.kind === "recover" || state.kind === "setup-failed";

  useEffect(() => {
    const onOther = (e: Event) => locked.current && (e as CustomEvent<string>).detail === workspaceId && setUnlockedElsewhere((n) => n + 1);
    window.addEventListener(UNLOCKED, onOther);
    return () => window.removeEventListener(UNLOCKED, onOther);
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = await loadKey(teamKeyName(workspaceId));
      if (local && fingerprint && (await keyFingerprint(local)) === fingerprint) {
        if (!cancelled) setState({ kind: "ready", key: local });
        return;
      }
      if (fingerprint) {
        const updated = local ? await catchUp(workspaceId, local) : null;
        if (!cancelled) setState(updated ? { kind: "ready", key: updated } : { kind: "recover" });
        return;
      }
      // First device for this workspace: create the team key.
      const created = await createTeamKey(workspaceId);
      if (cancelled) return;
      // The recovery key box only when a key really exists elsewhere; a request that failed is offered again instead.
      if (typeof created === "string") return setState(created === "taken" ? { kind: "recover" } : { kind: "setup-failed", blocked: created === "blocked" });
      setState({ kind: "ready", ...created });
      // Made on a second go: the page's other gates, still waiting, open too.
      if (attempt > 0) window.dispatchEvent(new CustomEvent(UNLOCKED, { detail: workspaceId }));
    })().catch(() => {
      // This browser's key store couldn't be read (blocked storage, say): never left on "Unlocking…" for good.
      if (!cancelled) setState(fingerprint ? { kind: "recover" } : { kind: "setup-failed" });
    });
    return () => {
      cancelled = true;
    };
    // `attempt` re-runs it for Try again.
  }, [workspaceId, fingerprint, unlockedElsewhere, attempt]);

  /** Try again, after a new business's key couldn't be set up. */
  function retry() {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }

  async function recover(input: string) {
    // Nothing typed yet: say what goes in the box, not that a key is wrong (S6).
    if (!input.trim()) return setState({ kind: "recover", error: "Enter your recovery key: the letters and numbers you copied, downloaded or printed when it was shown to you. Spaces don't matter." });
    try {
      let key = await importKey(input.replace(/\s+/g, ""));
      if (fingerprint && (await keyFingerprint(key)) !== fingerprint) {
        // A recovery key from before a key reset still works for current members.
        const updated = await catchUp(workspaceId, key);
        if (!updated) throw new Error("That isn't this workspace's recovery key.");
        key = updated;
      }
      await saveKey(teamKeyName(workspaceId), key);
      setState({ kind: "ready", key });
      window.dispatchEvent(new CustomEvent(UNLOCKED, { detail: workspaceId }));
      onUnlock?.();
    } catch (err) {
      setState({ kind: "recover", error: (err as Error).message });
    }
  }

  return { state, recover, retry };
}

/**
 * In place of the recovery key box when a brand-new business's key couldn't be set up (the request failed): that key
 * was never made, so there's no recovery key to enter yet. One more go usually does it.
 */
export function KeySetupFailed({ onRetry, anchor, blocked = false }: { onRetry: () => void; anchor?: string; /** This browser won't keep a key: say that, not "check your connection". */ blocked?: boolean }) {
  return (
    <div id={anchor} role="alert" className="mt-6 max-w-md scroll-mt-6 rounded-2xl border border-line bg-surface p-6" data-testid="key-setup-failed">
      <h2 className="font-semibold text-ink">{blocked ? "Your key can't be kept in this browser" : "We couldn't set up your key just now"}</h2>
      {blocked ? (
        <p className="mt-2 text-sm text-muted" data-testid="key-storage-blocked">
          This browser is blocking storage for SureFrame, so your key can&apos;t be kept here. Turn off private browsing, or allow site data for SureFrame, then try again.
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">
          Your videos are locked with a key that&apos;s made in this browser, and setting it up didn&apos;t finish. Check your connection, then try again.
        </p>
      )}
      <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover">
        Try again
      </button>
    </div>
  );
}

/**
 * The recovery key box: what's locked in this browser and why, in plain words (Decision 15). `why` leads with what
 * this page needs the key for; the rest says what the key is, where to find it, and what works without it.
 */
export function UnlockBox({ error, onRecover, why, anchor }: { error?: string; onRecover: (input: string) => void; why?: React.ReactNode; anchor?: string }) {
  const [input, setInput] = useState("");
  return (
    <div id={anchor} className="mt-6 max-w-md scroll-mt-6 rounded-2xl border border-line bg-surface p-6" data-testid="unlock-box">
      <h2 className="font-semibold text-ink">Unlock your videos in this browser</h2>
      {why && <p className="mt-2 text-sm font-medium text-ink" data-testid="unlock-why">{why}</p>}
      <p className="mt-2 text-sm text-muted" data-testid="unlock-what">
        Your videos, replies, to-dos and notes, and each client&apos;s private key, are end-to-end encrypted with your team&apos;s key, so not even we can open them.
        Each browser keeps its own copy of that key, so a new device, a different browser or cleared browser data asks for it once. Your client list, settings and
        billing work without it.
      </p>
      <p className="mt-2 text-sm text-muted">
        Enter the recovery key saved when the account was set up. On a team, everyone has the same recovery key: it was shown to you when you joined, and the owner or an admin has it too. If you joined from an invite link, opening that same link again in this browser also works, until the team&apos;s keys are next reset.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onRecover(input);
        }}
        className="mt-4 grid gap-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Recovery key"
          placeholder="Recovery key"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 rounded-lg border border-line-strong px-3 py-2 font-mono text-sm"
        />
        <button className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover">Unlock</button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-danger-fg">{error}</p>}
    </div>
  );
}

/**
 * Makes sure this device holds the team's end-to-end key before rendering
 * children that record, send or play videos. The first device creates the
 * key (the header then shows its recovery key until it's saved); other
 * devices enter that recovery key.
 */
export default function TeamKeyGate({
  workspaceId,
  fingerprint,
  children,
  loading,
  lockedNote,
  onUnlock,
  why,
  anchor,
}: {
  workspaceId: string;
  fingerprint: string | null;
  children: (key: CryptoKey) => React.ReactNode;
  /** Shown while checking this device's key (default: "Unlocking…"). */
  loading?: React.ReactNode;
  /** Shown instead of the unlock form when another gate on the page has it (components/LibraryUnlock). */
  lockedNote?: React.ReactNode;
  /** Called after the recovery key was entered here. */
  onUnlock?: () => void;
  /** What this part of the page needs the key for, said first in the unlock box. */
  why?: React.ReactNode;
  /** The unlock box's id, so a note elsewhere on the page can link to it. */
  anchor?: string;
}) {
  const { state, recover, retry } = useTeamKey(workspaceId, fingerprint, onUnlock);

  if (state.kind === "loading") {
    return loading !== undefined ? <>{loading}</> : <div className="grid h-40 place-items-center text-sm text-dim">Unlocking…</div>;
  }

  // Never `lockedNote`, which points to a recovery key box (a new business has no recovery key yet). A gate with one
  // leaves the Try again box to the page's main gate, and opens with it.
  if (state.kind === "setup-failed") return lockedNote !== undefined ? null : <KeySetupFailed onRetry={retry} anchor={anchor} blocked={state.blocked} />;

  if (state.kind === "recover" && lockedNote !== undefined) return <>{lockedNote}</>;

  if (state.kind === "recover") return <UnlockBox error={state.error} onRecover={recover} why={why} anchor={anchor} />;

  return <>{children(state.key)}</>;
}

/**
 * The library's unlock box, at the top of the page so a new device meets it
 * before the locked tiles. Shows nothing once this device has the key; after
 * unlocking, the page reloads so the stills and lists open.
 */
export function LibraryUnlock({ workspaceId, fingerprint }: { workspaceId: string; fingerprint: string | null }) {
  return (
    <div id="unlock" className="scroll-mt-6 empty:hidden [&>div]:mb-8 [&>div]:mt-0" data-testid="library-unlock">
      <TeamKeyGate
        workspaceId={workspaceId}
        fingerprint={fingerprint}
        loading={null}
        onUnlock={() => window.location.reload()}
        why="Your list of videos is below. Playing them, and their stills, needs the key in this browser."
      >
        {() => null}
      </TeamKeyGate>
    </div>
  );
}
