"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { exportKey, fingerprint as keyFingerprint } from "@/lib/e2e/crypto";
import { writeClipboard } from "@/lib/clipboard";
import TeamKeyGate from "./TeamKeyGate";

const button = "rounded-xl border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-hover";

/** The online connector's address with a Copy button (Settings > Connections). */
export function CopyConnectorUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <code className="min-w-0 break-all rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink" data-testid="connector-url">
        {url}
      </code>
      <button
        className={button}
        onClick={async () => {
          await writeClipboard(url).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * Makes a connection code for the desktop connector: a new desktop connection's token plus the team key, put
 * together here in the browser so the key never reaches SureFrame. Shown once.
 */
export function DesktopConnectionCode({ workspaceId, fingerprint }: { workspaceId: string; fingerprint: string | null }) {
  return <TeamKeyGate workspaceId={workspaceId} fingerprint={fingerprint}>{(key) => <MakeCode teamKey={key} />}</TeamKeyGate>;
}

function MakeCode({ teamKey }: { teamKey: CryptoKey }) {
  const router = useRouter();
  const [code, setCode] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function make() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/connector/desktop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyFingerprint: await keyFingerprint(teamKey) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't make a connection code. Try again.");
      const json = JSON.stringify({ u: data.site, t: data.token, k: await exportKey(teamKey) });
      const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      setCode(`sfc1_${b64}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!code) {
    return (
      <div className="mt-3">
        <button onClick={make} disabled={busy} className={button} data-testid="make-connection-code">
          {busy ? "Making…" : "Make a connection code"}
        </button>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-xl border border-line-strong bg-surface-2 p-4" data-testid="connection-code">
      <p className="text-sm font-semibold text-ink">Your connection code</p>
      <p className="mt-1 text-sm text-muted">
        Paste it into SureFrame&apos;s settings in Claude Desktop. It holds your team&apos;s key, so treat it like your recovery key: don&apos;t send it
        to anyone or paste it anywhere else. It&apos;s only shown now.
      </p>
      <textarea readOnly value={code} rows={3} className="mt-3 w-full break-all rounded-lg border border-line bg-canvas p-2 font-mono text-xs text-ink" data-testid="connection-code-text" />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className={button}
          onClick={async () => {
            await writeClipboard(code).catch(() => {});
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy code"}
        </button>
        <button onClick={() => setCode(undefined)} className="rounded-lg px-3 py-1.5 text-sm text-muted">
          Done
        </button>
      </div>
    </div>
  );
}
