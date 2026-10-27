"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * Leaving a team you work for (Settings > Account), without closing your login: asks once more first,
 * since only the team can bring you back (with a new invite) and its owner is asked to reset the keys.
 */
export default function LeaveTeamButton({ team }: { team: string }) {
  const { pending } = useFormStatus();
  const [sure, setSure] = useState(false);
  return !sure ? (
    <button
      type="button"
      onClick={() => setSure(true)}
      data-testid="leave-team-button"
      className="rounded-xl border border-line-strong px-4 py-2 text-sm font-semibold text-danger-fg hover:bg-hover"
    >
      Leave {team}
    </button>
  ) : (
    <div role="alertdialog" aria-label={`Leave ${team}?`} className="rounded-xl border border-danger-line bg-danger-bg p-4 text-sm text-danger-fg" data-testid="leave-team-confirm">
      <p className="font-semibold">Leave {team} now?</p>
      <p className="mt-1">You can&apos;t open its videos or clients from now on. To come back you&apos;d need a new invite.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={pending} className="rounded-xl bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-60" data-testid="leave-team-yes">
          {pending ? "Leaving…" : `Yes, leave ${team}`}
        </button>
        {/* Focus moves here from the button that was replaced, the safe choice. */}
        <button type="button" autoFocus disabled={pending} onClick={() => setSure(false)} className="rounded-xl border border-line-strong bg-surface px-4 py-2 font-medium text-ink hover:bg-hover">
          Cancel
        </button>
      </div>
    </div>
  );
}
