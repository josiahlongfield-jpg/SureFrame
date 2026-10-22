"use client";

import { useEffect, useRef, useState } from "react";
import CantOpen from "./CantOpen";
import { keyHeldCookie, markKeyHeld } from "@/lib/e2e/keyHeld";
import { clientKeyName, loadKey } from "@/lib/e2e/keystore";
import { takeLinkKey } from "@/lib/e2e/linkKey";

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
 * their videos: an email link opened on a new device, a link cut short before its key, or a browser that
 * cleared its storage (Safari does after a week or so without a visit). Only the business can send the
 * personal link again, so this asks them to. Its heading is the same "private" one a plain /v/ address
 * gets (app/v/[id]/page.tsx), as it's the same situation for the client.
 */
export default function LostKey({ clientId, business, signInNext, unlocks = "this video" }: { clientId: string; business: string; signInNext?: string; unlocks?: string }) {
  return (
    <CantOpen
      title={unlocks === "this video" ? "This video is private" : "Your videos are private"}
      testId="lost-key"
      signInNext={signInNext}
      action={<AskForLink business={business} url={`/api/clients/${clientId}/lost-key`} unlocks={unlocks} />}
    >
      <p>
        Videos from {business} unlock with the personal link they sent you. Use the whole link from their message: it&rsquo;s long, and its end is the part that
        unlocks them.
      </p>
      <p>
        This device hasn&rsquo;t opened that link yet, or this browser has since cleared it. If you just opened a link from a text or chat and still see this, it may
        have been cut short: open it again from the original message.
      </p>
      <p>Open your personal link on this device once, and {unlocks === "this video" ? "this video and future" : "your videos and"} email links from {business} will open here.</p>
    </CantOpen>
  );
}

/**
 * A link whose key isn't this client's (a character changed, or cut short) on a device that has no working key of
 * its own. The key wasn't saved (lib/e2e/linkKey.ts), so opening the right link fixes it.
 */
export function BadLinkKey({ clientId, business, signInNext, unlocks = "this video" }: { clientId: string; business: string; signInNext?: string; unlocks?: string }) {
  return (
    <CantOpen title="This link is incomplete or mistyped" testId="bad-link-key" signInNext={signInNext} action={<AskForLink business={business} url={`/api/clients/${clientId}/lost-key`} unlocks={unlocks} />}>
      <p>Open it again from the original message, making sure you use the whole link: it&rsquo;s long, and its end is the part that unlocks {unlocks}.</p>
      <p>Still not opening? Ask {business} to send your personal link again.</p>
    </CantOpen>
  );
}

const BAD_LINK_NOTE = "sureframe.badlink.";

/** Remembers, for the page after a reload, that the link just opened had a wrong key and this device kept its own. */
export function noteBadLink(clientId: string) {
  try {
    sessionStorage.setItem(BAD_LINK_NOTE + clientId, "1");
  } catch {
    /* storage blocked: no note, the videos still open */
  }
}

/**
 * Said above the videos when the link just opened had a wrong key but this device already had the right one: nothing
 * changed here, and the person knows the link they have (or forwarded) is the faulty one. `now` shows it straight
 * away; otherwise it's shown once if noteBadLink left word before a reload.
 */
export function BadLinkNote({ clientId, now = false }: { clientId: string; now?: boolean }) {
  const [shown, setShown] = useState(now);
  useEffect(() => {
    if (now) return setShown(true);
    try {
      if (sessionStorage.getItem(BAD_LINK_NOTE + clientId)) {
        sessionStorage.removeItem(BAD_LINK_NOTE + clientId);
        setShown(true);
      }
    } catch {
      /* storage blocked */
    }
  }, [clientId, now]);
  if (!shown) return null;
  return (
    <p role="status" data-testid="bad-link-note" className="mb-4 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg">
      The link you just opened is incomplete or mistyped, so this device kept the key it already had and your videos still open. If you forward that link, send
      it again from the original message.
    </p>
  );
}

/**
 * Stands in for a client's videos (inbox section, video page) until this browser is known to hold their key
 * (lib/e2e/keyHeld.ts). If the key is here after all (arriving from the personal link, or saved before the
 * server was told), it tells the server and reloads into the videos (once per device); otherwise it explains
 * how to get it. A link whose key isn't theirs is never saved over a key this device has (lib/e2e/linkKey.ts).
 */
export function ClientKeyGate({ clientId, business, signInNext, unlocks }: { clientId: string; business: string; signInNext?: string; unlocks?: string }) {
  const [state, setState] = useState<"checking" | "opening" | "missing" | "wrong">("checking");
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    (async () => {
      // Arriving from the personal link: keep the key on this device (only if it's really theirs), then hide it from the address bar.
      const link = await takeLinkKey(clientId).catch(() => "wrong" as const);
      if (!(await loadKey(clientKeyName(clientId)))) return setState(link === "wrong" ? "wrong" : "missing");
      if (link === "wrong") noteBadLink(clientId);
      markKeyHeld(clientId, true);
      // A browser that won't keep the note (cookies blocked) would come straight back here: say what's in the way instead.
      if (!document.cookie.split("; ").includes(`${keyHeldCookie(clientId)}=1`)) return setState("missing");
      setState("opening");
      // A full reload, so nothing else on the page (such as the address bar tidy-up) can hold the new page back.
      window.location.reload();
    })().catch(() => setState("missing"));
  }, [clientId]);
  if (state === "wrong") return <BadLinkKey clientId={clientId} business={business} signInNext={signInNext} unlocks={unlocks} />;
  if (state === "missing") return <LostKey clientId={clientId} business={business} signInNext={signInNext} unlocks={unlocks} />;
  return (
    <p className="rounded-2xl border border-line bg-surface p-10 text-center text-sm text-muted" role="status" data-testid="key-checking">
      {state === "opening" ? "Opening your videos…" : "One moment…"}
    </p>
  );
}
