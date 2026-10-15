"use client";

import { useState } from "react";
import { exportKey } from "@/lib/e2e/crypto";
import TeamKeyGate from "./TeamKeyGate";

/** Lets a device that's already unlocked show the recovery key again, to unlock a phone or new computer. */
export default function ShowRecoveryKey({ workspaceId, fingerprint }: { workspaceId: string; fingerprint: string | null }) {
  return <TeamKeyGate workspaceId={workspaceId} fingerprint={fingerprint}>{(key) => <Reveal teamKey={key} />}</TeamKeyGate>;
}

function Reveal({ teamKey }: { teamKey: CryptoKey }) {
  const [value, setValue] = useState<string>();
  const [copied, setCopied] = useState(false);
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
      <p className="break-all rounded-lg bg-canvas px-3 py-2 font-mono text-sm text-ink" data-recovery-key={value}>
        {value.match(/.{1,4}/g)?.join(" ") ?? value}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          }}
          className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button onClick={() => setValue(undefined)} className="rounded-lg px-3 py-1.5 text-sm text-muted">
          Hide
        </button>
      </div>
    </div>
  );
}
