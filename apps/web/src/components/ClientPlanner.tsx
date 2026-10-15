"use client";

import { useEffect, useState } from "react";
import { loadClientKey } from "@/lib/e2e/keystore";
import Planner from "./Planner";

/** What a client sees: only the items shared with them, unlocked with the key from their personal link. */
export default function ClientPlanner({ clientId, title }: { clientId: string; title?: string }) {
  const [key, setKey] = useState<CryptoKey | null | undefined>();

  useEffect(() => {
    // ClientKeyCapture may still be saving the key from the link, so look again shortly after.
    let cancelled = false;
    const load = async (tries: number): Promise<void> => {
      const k = await loadClientKey(clientId);
      if (cancelled) return;
      if (k || tries <= 0) return setKey(k);
      setTimeout(() => load(tries - 1), 300);
    };
    load(5);
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (key === undefined) return null;
  if (!key) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-5 text-sm text-muted">
        Open your personal link on this device to see your to-dos and notes.
      </section>
    );
  }
  return <Planner role="client" clientId={clientId} privateKey={null} sharedKey={key} title={title} />;
}
