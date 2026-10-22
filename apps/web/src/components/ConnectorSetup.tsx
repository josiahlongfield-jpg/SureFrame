"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { exportKey, fingerprint as keyFingerprint } from "@/lib/e2e/crypto";
import { writeClipboard } from "@/lib/clipboard";
import TeamKeyGate from "./TeamKeyGate";

const button = "rounded-xl border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-hover";

/** The online connector's address with a Copy button (Settings > Connections). */
export function CopyConnectorUrl({ url }: { url: string }) {
  const [state, setState] = useState<"copied" | "failed">();
  const address = useRef<HTMLElement>(null);
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <code ref={address} className="min-w-0 select-all break-all rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink" data-testid="connector-url">
          {url}
        </code>
        <button
          className={button}
          data-testid="copy-connector-url"
          onClick={async () => {
            const ok = await writeClipboard(url).then(() => true, () => false);
            setState(ok ? "copied" : "failed");
            if (ok) setTimeout(() => setState(undefined), 2000);
            else if (address.current) getSelection()?.selectAllChildren(address.current);
          }}
        >
          {state === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      {state === "failed" && (
        <p className="mt-2 text-sm text-danger" data-testid="copy-failed">
          Your browser didn&apos;t let us copy it. The address is selected: press and hold it (or right-click) and choose Copy.
        </p>
      )}
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
  const [copied, setCopied] = useState<boolean | "failed">(false);
  const codeBox = useRef<HTMLTextAreaElement>(null);

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
        {/* What a lost code means, and what ends one (O95, B12). */}
        <p className="mt-2 text-xs text-dim" data-testid="code-lifetime">
          Lost a code? Make another. Each code keeps working until you disconnect it under Your connections below. Resetting your team&apos;s key
          doesn&apos;t end a code; only Disconnect does.
        </p>
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
      <p className="mt-1 text-xs text-dim">
        It&apos;s long on purpose, so use Copy code rather than selecting it. Lost it later? Make another one; this one keeps working until you disconnect it.
      </p>
      <textarea ref={codeBox} readOnly value={code} rows={3} aria-label="Connection code" className="mt-3 w-full break-all rounded-lg border border-dashed border-line-strong bg-surface p-2 font-mono text-xs text-ink" data-testid="connection-code-text" />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover"
          data-testid="copy-connection-code"
          onClick={async () => {
            const ok = await writeClipboard(code).then(() => true, () => false);
            setCopied(ok ? true : "failed");
            if (!ok) codeBox.current?.select();
          }}
        >
          {copied === true ? "Copied" : "Copy code"}
        </button>
        <button onClick={() => setCode(undefined)} className="rounded-lg px-3 py-1.5 text-sm text-muted">
          Done
        </button>
      </div>
      {copied === "failed" && (
        <p className="mt-2 text-sm text-danger">Your browser didn&apos;t let us copy it. The code is selected: press and hold it (or right-click) and choose Copy.</p>
      )}
    </div>
  );
}

/**
 * Disconnect, asked first (S75): what stops, and for someone else's connection, that they're emailed. The
 * server action does the disconnecting; Settings > Connections then says it's done.
 */
export function DisconnectConnection({ id, what, who, action }: { id: string; what: string; who?: string; action: (form: FormData) => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button onClick={() => setAsking(true)} className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover" data-testid="disconnect">
        Disconnect
      </button>
    );
  }
  return (
    <form action={action} role="dialog" aria-label={`Disconnect ${what}`} className="w-full rounded-lg border border-danger-line bg-danger-bg p-3 text-sm text-muted sm:max-w-xs" data-testid="disconnect-confirm-box">
      <input type="hidden" name="id" value={id} />
      <p className="font-medium text-ink">Disconnect {who ? `${who}'s ` : ""}{what}?</p>
      <p className="mt-1 text-xs">
        It stops reading SureFrame straight away.{who ? ` We email ${who} to say so.` : ""} Connecting again takes a new {what === "Claude Desktop" ? "connection code" : "sign-in from Claude"}.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700" data-testid="disconnect-confirm">Disconnect</button>
        <button type="button" onClick={() => setAsking(false)} className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs hover:bg-hover">Cancel</button>
      </div>
    </form>
  );
}
