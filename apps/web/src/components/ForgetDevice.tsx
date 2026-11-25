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
  const [error, setError] = useState<string>();
  async function go() {
    setBusy(true);
    setError(undefined);
    // The device's cookies first: if that fails (offline, say), nothing is removed, so it's never left half done
    // (the key gone but the business still named here).
    try {
      await forget();
    } catch {
      setBusy(false);
      setError("Couldn't remove it just now. Check your connection and try again.");
      return;
    }
    try {
      // The keystore's own name for this key (lib/e2e/keystore.ts keeps keys under "framecast.key.").
      localStorage.removeItem(`framecast.key.${clientKeyName(clientId)}`);
      localStorage.removeItem(introSeenKey(workspaceId));
    } catch {
      /* storage blocked: nothing was kept */
    }
    router.refresh();
  }
  return (
    <>
      {/* The padding (cancelled by the margin) only widens where a finger can land. */}
      <button onClick={() => setAsking(true)} disabled={busy} data-testid="forget-device" className="-my-2 py-2 text-xs font-medium text-dim underline-offset-2 hover:text-ink hover:underline disabled:opacity-50">
        {busy ? "Removing…" : "Remove from this device"}
      </button>
      {asking && (
        <ConfirmDialog
          title="Remove from this device?"
          body={<p>Your videos from {business} stop showing on this device. Nothing is deleted: open your personal link again to see them here.</p>}
          confirmLabel="Remove from this device"
          cancelLabel="Keep them here"
          busy={busy}
          error={error}
          onConfirm={go}
          onCancel={() => {
            setAsking(false);
            setError(undefined);
          }}
          testId="forget-confirm"
        />
      )}
    </>
  );
}
