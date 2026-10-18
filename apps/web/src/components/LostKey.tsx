"use client";

import { useEffect, useRef, useState } from "react";
import CantOpen from "./CantOpen";
import { importKey } from "@/lib/e2e/crypto";
import { keyHeldCookie, markKeyHeld } from "@/lib/e2e/keyHeld";
import { clientKeyName, loadKey, saveKey } from "@/lib/e2e/keystore";

/**
 * "Ask for my link again": emails the business to send the client's personal link (lib/askForLink.ts),
 * by an API route (`url`) or a server action, then says who was asked and what happens next.
 */
export function AskForLink({ business, url, action, unlocks = "this video" }: { business: string; url?: string; action?: () => Promise<boolean>; unlocks?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "asked" | "failed">("idle");
  async function ask() {
    setState("busy");
    let asked = false;
    if (action) asked = await action().catch(() => false);
    else if (url) {
      const res = await fetch(url, { method: "POST" }).catch(() => null);
      asked = !!(res?.ok && ((await res.json().catch(() => ({}))) as { asked?: boolean }).asked);
    }
    setState(asked ? "asked" : "failed");
  }
  if (state === "asked") {
    return (
      <p className="rounded-xl bg-ok-bg p-3 text-sm text-ok-fg" role="status" data-testid="lost-key-asked">
        Done. We&rsquo;ve emailed {business} to ask them to send you your personal link again. They&rsquo;ll send it to you themselves. When it arrives, open it
        on this device and {unlocks} will unlock.
      </p>
    );
  }
  return (
    <>
      <button onClick={ask} disabled={state === "busy"} data-testid="ask-link" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
        {state === "busy" ? "Asking…" : "Ask for my link again"}
      </button>
      {state === "failed" && <p role="alert" className="mt-2 text-sm text-danger-fg">That didn&rsquo;t go through. Please contact {business} directly.</p>}
    </>
  );
}

/**
 * A client this browser recognises (it has opened one of their links) but without the key that unlocks
 * their videos: an email link opened on a new device, a link missing its #k= part, or a browser that
 * cleared its storage (Safari does after a week or so without a visit). Only the business can send the
 * personal link again, so this asks them to.
 */
export default function LostKey({ clientId, business, signInNext, unlocks = "this video" }: { clientId: string; business: string; signInNext?: string; unlocks?: string }) {
  return (
    <CantOpen title="This device needs your personal link" testId="lost-key" signInNext={signInNext} action={<AskForLink business={business} url={`/api/clients/${clientId}/lost-key`} unlocks={unlocks} />}>
      <p>
        Videos from {business} unlock with the personal link they gave you: the full link, including the part after <span className="whitespace-nowrap">#k=</span>. This
        device hasn&rsquo;t opened that link yet, or this browser has since cleared it.
      </p>
      <p>Open your personal link on this device once, and {unlocks === "this video" ? "this video and future" : "your videos and"} email links from {business} will open here.</p>
    </CantOpen>
  );
}

/**
 * Stands in for a client's videos (inbox section, video page) until this browser is known to hold their key
 * (lib/e2e/keyHeld.ts). If the key is here after all (arriving from the personal link, or saved before the
 * server was told), it tells the server and reloads into the videos (once per device); otherwise it explains
 * how to get it.
 */
export function ClientKeyGate({ clientId, business, signInNext, unlocks }: { clientId: string; business: string; signInNext?: string; unlocks?: string }) {
  const [state, setState] = useState<"checking" | "opening" | "missing">("checking");
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    (async () => {
      // Arriving from the personal link: keep the key on this device, then hide it from the address bar.
      const fromLink = new URLSearchParams(window.location.hash.slice(1)).get("k");
      if (fromLink) {
        try {
          await saveKey(clientKeyName(clientId), await importKey(fromLink));
          void fetch(`/api/clients/${clientId}/opened`, { method: "POST" }).catch(() => {});
        } catch {
          /* malformed link: fall through to a key saved before */
        }
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      if (!(await loadKey(clientKeyName(clientId)))) return setState("missing");
      markKeyHeld(clientId, true);
      // A browser that won't keep the note (cookies blocked) would come straight back here: say what's in the way instead.
      if (!document.cookie.split("; ").includes(`${keyHeldCookie(clientId)}=1`)) return setState("missing");
      setState("opening");
      // A full reload, so nothing else on the page (such as the address bar tidy-up) can hold the new page back.
      window.location.reload();
    })().catch(() => setState("missing"));
  }, [clientId]);
  if (state === "missing") return <LostKey clientId={clientId} business={business} signInNext={signInNext} unlocks={unlocks} />;
  return (
    <p className="rounded-2xl border border-line bg-surface p-10 text-center text-sm text-muted" role="status" data-testid="key-checking">
      {state === "opening" ? "Opening your videos…" : "One moment…"}
    </p>
  );
}
