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
    <TeamKeyGate workspaceId={props.workspaceId} fingerprint={props.fingerprint}>
      {(teamKey) => <Recorder maxResolution={props.maxResolution} maxDurationMin={props.maxDurationMin} freeVideos={props.freeVideos} teamKey={teamKey} recordedBefore={props.recordedBefore} />}
    </TeamKeyGate>
  );
}
