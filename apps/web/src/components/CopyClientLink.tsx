"use client";

import { useEffect, useState } from "react";
import { shareLink, useCanShare, writeClipboard } from "@/lib/clipboard";
import TeamKeyGate from "./TeamKeyGate";
import { LinkBadge, markLinkSent, personalLink } from "./ClientsManager";
import FirstLinkSender, { KeyIcon } from "./FirstLinkSender";

type Props = {
  workspaceId: string;
  fingerprint: string | null;
  clientId: string;
  name: string;
  email: string | null;
  business: string;
  link: string;
  teamKeyWrap: string | null;
  reached: boolean;
  /** The team has copied, shared or emailed it, but they haven't opened it yet. */
  sent: boolean;
};

/**
 * A client's personal link to copy (or share on a phone). Until they've opened
 * it, a card says they can't watch anything yet and gives every way to send it.
 */
export default function CopyClientLink(props: Props) {
  return (
    <TeamKeyGate workspaceId={props.workspaceId} fingerprint={props.fingerprint}>
      {(teamKey) => (props.reached ? <Button {...props} teamKey={teamKey} /> : <FirstLink {...props} teamKey={teamKey} />)}
    </TeamKeyGate>
  );
}

function FirstLink({ clientId, name, email, business, link, teamKeyWrap, sent, teamKey }: Omit<Props, "workspaceId" | "fingerprint"> & { teamKey: CryptoKey }) {
  const [isSent, setSent] = useState(sent);
  return (
    <div className="mt-4 rounded-2xl border-2 border-primary bg-primary-soft p-4 text-sm text-ink" data-testid="needs-first-card">
      <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
        <KeyIcon className="h-5 w-5 text-accent" />
        Send {name} their personal link
        <LinkBadge sent={isSent} />
      </p>
      <p className="mt-1 text-muted" data-testid="needs-first-link-text">
        {name} hasn&apos;t opened it yet, so they can&apos;t open any videos. It holds the key to their videos, so it comes from you, by text, chat or your own email.
        Once they&apos;ve opened it, every video you send opens straight away{email ? ", and we can email them new ones" : ""}.
      </p>
      <div className="mt-3">
        <FirstLinkSender
          name={name}
          email={email}
          business={business}
          getLink={() => personalLink(link, teamKeyWrap, teamKey)}
          onSent={() => {
            void markLinkSent(clientId);
            setSent(true);
          }}
          copyLabel="Copy personal link"
        />
      </div>
    </div>
  );
}

function Button({ clientId, name, link, teamKeyWrap, teamKey }: Omit<Props, "workspaceId" | "fingerprint"> & { teamKey: CryptoKey }) {
  const [copied, setCopied] = useState(false);
  const canShare = useCanShare();
  // Worked out ahead, so Copy and Share use it in the same tap.
  const [ready, setReady] = useState<string>();
  useEffect(() => {
    personalLink(link, teamKeyWrap, teamKey).then(setReady, () => {});
  }, [link, teamKeyWrap, teamKey]);
  const full = () => (ready ? Promise.resolve(ready) : personalLink(link, teamKeyWrap, teamKey));
  return (
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
  );
}
