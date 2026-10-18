"use client";

import { useEffect, useState } from "react";
import { unwrapKey } from "@/lib/e2e/crypto";
import Planner, { type PlannerClient, type PlannerDefaults, type TeamWho } from "./Planner";
import TeamKeyGate from "./TeamKeyGate";

type Props = {
  workspaceId: string;
  fingerprint: string | null;
  clientId?: string | null;
  clientName?: string;
  clientTeamKeyWrap?: string | null;
  client?: PlannerClient;
  defaults?: PlannerDefaults;
  title?: string;
  note?: string;
  teamWho?: TeamWho;
  /** Shown while this device is locked, when the page has its own unlock box (components/TeamKeyGate.tsx LibraryUnlock). */
  lockedNote?: React.ReactNode;
};

/** The team's planner: private items use the team key, shared items the client's key. */
export default function MemberPlanner({ workspaceId, fingerprint, lockedNote, ...rest }: Props) {
  return (
    <TeamKeyGate workspaceId={workspaceId} fingerprint={fingerprint} lockedNote={lockedNote}>
      {(teamKey) => <Unlocked teamKey={teamKey} {...rest} />}
    </TeamKeyGate>
  );
}

function Unlocked({ teamKey, clientId = null, clientName, clientTeamKeyWrap, client, defaults, title, note, teamWho }: Omit<Props, "workspaceId" | "fingerprint" | "lockedNote"> & { teamKey: CryptoKey }) {
  const [clientKey, setClientKey] = useState<CryptoKey | null>(null);
  const [ready, setReady] = useState(!clientTeamKeyWrap);

  useEffect(() => {
    if (!clientTeamKeyWrap) return;
    unwrapKey(clientTeamKeyWrap, teamKey)
      .then(setClientKey)
      .catch(() => setClientKey(null))
      .finally(() => setReady(true));
  }, [clientTeamKeyWrap, teamKey]);

  if (!ready) return <p className="text-sm text-dim">Unlocking…</p>;
  return <Planner role="member" clientId={clientId} clientName={clientName} client={client} defaults={defaults} privateKey={teamKey} sharedKey={clientKey} title={title} note={note} teamWho={teamWho} />;
}
