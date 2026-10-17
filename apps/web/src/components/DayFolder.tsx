"use client";

import { useEffect, useRef, type ReactNode } from "react";

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
 * One day's videos in the library. The newest day starts open, the rest
 * closed until clicked; a day you opened or closed stays that way when you
 * come back from a video (for this browser tab only).
 */
export default function DayFolder({ day, summary, children, defaultOpen = false }: { day: string; summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const was = saved()[day];
    if (ref.current && typeof was === "boolean") ref.current.open = was;
  }, [day]);
  const remember = () => {
    const open = !!ref.current?.open;
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
    <details ref={ref} open={defaultOpen} onToggle={remember} className="group/day rounded-2xl border border-line bg-surface" data-testid="day-folder">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl p-3 hover:bg-surface-2 sm:gap-4 sm:p-4 [&::-webkit-details-marker]:hidden">
        {summary}
        <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-dim transition group-open/day:rotate-180">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-line p-4 sm:p-6">{children}</div>
    </details>
  );
}
