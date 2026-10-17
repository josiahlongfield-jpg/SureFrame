"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientKeyName } from "@/lib/e2e/keystore";

/**
 * "Remove from this device": after a confirm, this browser forgets the client's personal link (the server
 * forgets nothing; `forget` only clears this device's cookie) and the key that unlocks their videos.
 * Opening the personal link again brings everything back.
 */
export default function ForgetDevice({ clientId, business, forget }: { clientId: string; business: string; forget: () => Promise<void> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!confirm(`Remove your videos from ${business} from this device? Nothing is deleted: open your personal link again to see them here.`)) return;
    setBusy(true);
    try {
      // The keystore's own name for this key (lib/e2e/keystore.ts keeps keys under "framecast.key.").
      localStorage.removeItem(`framecast.key.${clientKeyName(clientId)}`);
    } catch {
      /* storage blocked: nothing was kept */
    }
    await forget().catch(() => {});
    router.refresh();
  }
  return (
    <button onClick={go} disabled={busy} data-testid="forget-device" className="text-xs font-medium text-dim underline-offset-2 hover:text-ink hover:underline disabled:opacity-50">
      {busy ? "Removing…" : "Remove from this device"}
    </button>
  );
}
