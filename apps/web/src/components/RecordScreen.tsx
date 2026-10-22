"use client";

import Recorder from "./Recorder";
import TeamKeyGate from "./TeamKeyGate";
import type { Quality } from "@/lib/recorder/media";

export default function RecordScreen(props: {
  workspaceId: string;
  fingerprint: string | null;
  maxResolution: Quality;
  maxDurationMin: number;
  /** Free: how many of the plan's videos in total are left. */
  freeVideos: { left: number; limit: number } | null;
  /** Has recorded before: the recorder's settings start folded away. */
  recordedBefore?: boolean;
}) {
  return (
    <TeamKeyGate
      workspaceId={props.workspaceId}
      fingerprint={props.fingerprint}
      // Decision 15: a new video can't be locked for the team, or for a client, without the team's key (lib/e2e/crypto.ts),
      // so recording asks for it here and says why. Nothing is ever recorded or sent unencrypted instead.
      why={
        <>
          To record here, enter your recovery key first. Each new video is locked with your team&apos;s key as it records, and sending it to a client uses that
          client&apos;s own private key, which only your team&apos;s key opens. We never hold these keys, so without it in this browser, nobody could open what you record.
        </>
      }
    >
      {(teamKey) => <Recorder maxResolution={props.maxResolution} maxDurationMin={props.maxDurationMin} freeVideos={props.freeVideos} teamKey={teamKey} recordedBefore={props.recordedBefore} />}
    </TeamKeyGate>
  );
}
