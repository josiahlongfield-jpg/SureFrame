"use client";

import { useEffect, useState } from "react";
import { takeLinkKey } from "@/lib/e2e/linkKey";
import { BadLinkNote } from "./LostKey";

/**
 * Saves the key from a personal link's #fragment on this device, then hides it from the address bar. A key that
 * isn't this client's (a mistyped or cut-short link) is never saved over the one this device has; the page says so.
 */
export default function ClientKeyCapture({ clientId }: { clientId: string }) {
  const [wrong, setWrong] = useState(false);
  useEffect(() => {
    takeLinkKey(clientId).then(
      (r) => setWrong(r === "wrong"),
      () => {},
    );
  }, [clientId]);
  return <BadLinkNote clientId={clientId} now={wrong} />;
}

/** Takes a link's #k=… part out of the address bar on a page that couldn't use it (a link that can't open). */
export function HideKeyFromAddress() {
  useEffect(() => {
    if (new URLSearchParams(window.location.hash.slice(1)).has("k")) history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);
  return null;
}
