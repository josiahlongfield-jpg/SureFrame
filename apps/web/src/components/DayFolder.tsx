"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const KEY = "sf-library-days";

/** Days opened or closed in this browser tab: day -> open. */
function saved(): Record<string, boolean> {
  try {
    const map = JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
    return map && typeof map === "object" && !Array.isArray(map) ? map : {};
  } catch {
    return {};
  }
}

/**
 * One folder of videos in the library: a day, week or month (lib/libraryGroups.ts), or a client. The first
 * folder starts open, the rest closed until clicked; one you opened or closed stays that way when you come back
 * from a video (for this browser tab only). Folders inside another are drawn lighter.
 */
export default function DayFolder({
  day,
  summary,
  children,
  defaultOpen = false,
  kind = "day",
  depth = 0,
  compact = false,
}: {
  day: string;
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  kind?: "day" | "week" | "month" | "client";
  /** 0 at the top, 1 inside another folder, 2 inside two (a month's week, or a client's month). */
  depth?: 0 | 1 | 2;
  /** Smaller rows, for the list layout. */
  compact?: boolean;
}) {
  const nested = depth > 0;
  // Each level its own group name, so an open folder doesn't turn the arrows of closed ones inside it.
  const group = ["group/day", "group/sub", "group/sub2"][depth];
  const turn = ["group-open/day:rotate-180", "group-open/sub:rotate-180", "group-open/sub2:rotate-180"][depth];
  const ref = useRef<HTMLDetailsElement>(null);
  // What's inside is only drawn once the folder has been opened, so a long library doesn't unlock and load
  // every still in every closed folder.
  const [shown, setShown] = useState(defaultOpen);
  useEffect(() => {
    const was = saved()[day];
    if (ref.current && typeof was === "boolean") ref.current.open = was;
    if (was) setShown(true);
  }, [day]);
  const remember = () => {
    const open = !!ref.current?.open;
    if (open) setShown(true);
    try {
      const map = saved();
      // Only what differs from how the day starts is worth keeping.
      if (open === defaultOpen) delete map[day];
      else map[day] = open;
      sessionStorage.setItem(KEY, JSON.stringify(map));
    } catch {
      /* storage blocked: the folder just starts as usual next time */
    }
  };
  return (
    <details
      ref={ref}
      open={defaultOpen}
      onToggle={(e) => {
        // A folder inside this one toggling bubbles up here too: only remember this folder's own.
        if (e.target === ref.current) remember();
      }}
      className={`${group} border border-line ${nested ? "rounded-xl bg-canvas" : "rounded-2xl bg-surface"}`}
      data-testid={`${kind}-folder`}
      data-key={day}
    >
      <summary className={`flex cursor-pointer list-none items-center gap-3 hover:bg-surface-2 [&::-webkit-details-marker]:hidden ${compact ? "px-3 py-2" : "p-3"} ${nested ? "rounded-xl" : compact ? "rounded-2xl" : "rounded-2xl sm:gap-4 sm:p-4"}`}>
        {summary}
        <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`shrink-0 text-dim transition ${turn}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className={`border-t border-line ${nested ? "p-3 sm:p-4" : "p-3 sm:p-6"}`}>{shown && children}</div>
    </details>
  );
}
