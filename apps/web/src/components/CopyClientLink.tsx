"use client";

import { useState } from "react";
import TeamKeyGate from "./TeamKeyGate";
import { markLinkSent, personalLink } from "./ClientsManager";

export default function CopyClientLink(props: { workspaceId: string; fingerprint: string | null; clientId: string; link: string; teamKeyWrap: string | null }) {
  return (
    <TeamKeyGate workspaceId={props.workspaceId} fingerprint={props.fingerprint}>
      {(teamKey) => <Button {...props} teamKey={teamKey} />}
    </TeamKeyGate>
  );
}

function Button({ clientId, link, teamKeyWrap, teamKey }: { clientId: string; link: string; teamKeyWrap: string | null; teamKey: CryptoKey }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(await personalLink(link, teamKeyWrap, teamKey));
        void markLinkSent(clientId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm hover:bg-hover"
    >
      {copied ? "Copied" : "Copy personal link"}
    </button>
  );
}
