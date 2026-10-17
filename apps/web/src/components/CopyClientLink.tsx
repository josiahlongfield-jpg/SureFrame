"use client";

import { useEffect, useState } from "react";
import { shareLink, useCanShare, writeClipboard } from "@/lib/clipboard";
import TeamKeyGate from "./TeamKeyGate";
import { markLinkSent, personalLink } from "./ClientsManager";

type Props = { workspaceId: string; fingerprint: string | null; clientId: string; name: string; link: string; teamKeyWrap: string | null; reached: boolean };

/** A client's personal link to copy (or share on a phone), saying when they're still waiting for their first one. */
export default function CopyClientLink(props: Props) {
  return (
    <TeamKeyGate workspaceId={props.workspaceId} fingerprint={props.fingerprint}>
      {(teamKey) => <Button {...props} teamKey={teamKey} />}
    </TeamKeyGate>
  );
}

function Button({ clientId, name, link, teamKeyWrap, reached, teamKey }: Omit<Props, "workspaceId" | "fingerprint"> & { teamKey: CryptoKey }) {
  const [copied, setCopied] = useState(false);
  const canShare = useCanShare();
  // Worked out ahead, so Copy and Share use it in the same tap.
  const [ready, setReady] = useState<string>();
  useEffect(() => {
    personalLink(link, teamKeyWrap, teamKey).then(setReady, () => {});
  }, [link, teamKeyWrap, teamKey]);
  const full = () => (ready ? Promise.resolve(ready) : personalLink(link, teamKeyWrap, teamKey));
  return (
    <div className="grid justify-items-start gap-1.5 sm:justify-items-end">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={async () => {
            await writeClipboard(ready ?? full());
            void markLinkSent(clientId);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm hover:bg-hover"
        >
          {copied ? "Copied" : "Copy personal link"}
        </button>
        {canShare && (
          <button
            onClick={async () => {
              if (await shareLink(await full(), `${name}'s personal link`)) void markLinkSent(clientId);
            }}
            className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm hover:bg-hover"
          >
            Share
          </button>
        )}
      </div>
      {!reached && (
        <p className="max-w-xs text-xs text-dim sm:text-right" data-testid="needs-first-link">
          <span className="font-semibold text-accent">Needs first link.</span> {name} hasn&apos;t opened it yet. Send it to them yourself; once they have, we can email them new videos too.
        </p>
      )}
    </div>
  );
}
