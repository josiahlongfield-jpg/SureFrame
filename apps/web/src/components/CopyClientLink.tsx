"use client";

import { useEffect, useState } from "react";
import { shareLink, useCanShare, writeClipboard } from "@/lib/clipboard";
import TeamKeyGate from "./TeamKeyGate";
import { LinkBadge, markLinkSent, personalLink } from "./ClientsManager";
import FirstLinkSender from "./FirstLinkSender";

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
 * a link, a card says their first video sets them up, and gives every way to send their link now.
 */
export default function CopyClientLink(props: Props) {
  return (
    <TeamKeyGate
      workspaceId={props.workspaceId}
      fingerprint={props.fingerprint}
      loading={null}
      // Decision 15: the page's one unlock box is the to-dos and notes' (MemberPlanner); this says what it's for here.
      lockedNote={
        <p className="mt-3 text-sm text-muted" data-testid="link-locked">
          {props.name}&apos;s personal link carries their private key, which is locked with your team&apos;s key.{" "}
          <a href="#unlock" className="font-medium text-accent hover:underline">Enter your recovery key</a> to copy or send it from this browser.
        </p>
      }
    >
      {(teamKey) => (props.reached ? <Button {...props} teamKey={teamKey} /> : <FirstLink {...props} teamKey={teamKey} />)}
    </TeamKeyGate>
  );
}

function FirstLink({ clientId, name, email, business, link, teamKeyWrap, sent, teamKey }: Omit<Props, "workspaceId" | "fingerprint"> & { teamKey: CryptoKey }) {
  const [isSent, setSent] = useState(sent);
  return (
    <div className="mt-4 rounded-2xl border border-line-strong bg-surface-2 p-4 text-sm text-ink" data-testid="needs-first-card">
      <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
        {name} hasn&apos;t opened a video yet
        <LinkBadge sent={isSent} />
      </p>
      <p className="mt-1 text-muted" data-testid="needs-first-link-text">
        Record a video and send it to {name} from its Send box: their first one goes from you, by your email or a copied link, and opening it sets them up.
        After that every video opens straight away{email ? ", and we can email them new ones" : ""}. Or send their link now, before any video:
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
          copyLabel="Copy link"
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
        {copied ? "Copied" : "Copy link"}
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
