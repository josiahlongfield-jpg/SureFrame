"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientKeyName } from "@/lib/e2e/keystore";
import ConfirmDialog from "./ConfirmDialog";
import { introSeenKey } from "./SureFramePromo";

/**
 * "Remove from this device": after an in-page confirm, this browser forgets the client's personal link (the
 * server forgets nothing; `forget` only clears this device's cookies), the key that unlocks their videos,
 * and that it has seen the business's intro. Opening the personal link again brings everything back.
 */
export default function ForgetDevice({ clientId, workspaceId, business, forget }: { clientId: string; workspaceId: string; business: string; forget: () => Promise<void> }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      // The keystore's own name for this key (lib/e2e/keystore.ts keeps keys under "framecast.key.").
      localStorage.removeItem(`framecast.key.${clientKeyName(clientId)}`);
      localStorage.removeItem(introSeenKey(workspaceId));
    } catch {
      /* storage blocked: nothing was kept */
    }
    await forget().catch(() => {});
    router.refresh();
  }
  return (
    <>
      <button onClick={() => setAsking(true)} disabled={busy} data-testid="forget-device" className="text-xs font-medium text-dim underline-offset-2 hover:text-ink hover:underline disabled:opacity-50">
        {busy ? "Removing…" : "Remove from this device"}
      </button>
      {asking && (
        <ConfirmDialog
          title="Remove from this device?"
          body={<p>Your videos from {business} stop showing on this device. Nothing is deleted: open your personal link again to see them here.</p>}
          confirmLabel="Remove from this device"
          cancelLabel="Keep them here"
          busy={busy}
          onConfirm={go}
          onCancel={() => setAsking(false)}
          testId="forget-confirm"
        />
      )}
    </>
  );
}
