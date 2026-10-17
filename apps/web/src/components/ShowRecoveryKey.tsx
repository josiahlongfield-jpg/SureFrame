"use client";

import { useState } from "react";
import { exportKey } from "@/lib/e2e/crypto";
import { KeyActions, KeyText } from "./RecoveryKey";
import TeamKeyGate from "./TeamKeyGate";

/** Lets a device that's already unlocked show the recovery key again, to unlock a phone or new computer. */
export default function ShowRecoveryKey({ workspaceId, fingerprint, business }: { workspaceId: string; fingerprint: string | null; business: string }) {
  return <TeamKeyGate workspaceId={workspaceId} fingerprint={fingerprint}>{(key) => <Reveal teamKey={key} business={business} />}</TeamKeyGate>;
}

function Reveal({ teamKey, business }: { teamKey: CryptoKey; business: string }) {
  const [value, setValue] = useState<string>();
  if (!value) {
    return (
      <button
        onClick={async () => setValue(await exportKey(teamKey))}
        className="mt-4 rounded-xl border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-hover"
      >
        Show recovery key
      </button>
    );
  }
  return (
    <div className="mt-4">
      <KeyText value={value} className="bg-canvas" />
      <p className="mt-1 text-xs text-dim">Numbers are in colour, so 0 (zero) and O, or 1 and l, can&apos;t be mixed up. Spaces don&apos;t matter.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <KeyActions value={value} business={business} />
        <button onClick={() => setValue(undefined)} className="rounded-lg px-3 py-1.5 text-sm text-muted">
          Hide
        </button>
      </div>
    </div>
  );
}
