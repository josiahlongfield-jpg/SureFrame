"use client";

import { useEffect, useRef, type ReactNode } from "react";

const KEY = "sf-library-open-days";

function openDays(): string[] {
  try {
    const list = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((d) => typeof d === "string") : [];
  } catch {
    return [];
  }
}

/**
 * One day's videos in the library, closed until clicked. A day you opened stays
 * open when you come back from a video (for this browser tab only).
 */
export default function DayFolder({ day, summary, children }: { day: string; summary: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && openDays().includes(day)) ref.current.open = true;
  }, [day]);
  const remember = () => {
    const open = !!ref.current?.open;
    try {
      const rest = openDays().filter((d) => d !== day);
      sessionStorage.setItem(KEY, JSON.stringify(open ? [...rest, day] : rest));
    } catch {
      /* storage blocked: the folder just starts closed next time */
    }
  };
  return (
    <details ref={ref} onToggle={remember} className="group/day rounded-2xl border border-line bg-surface" data-testid="day-folder">
      <summary className="flex cursor-pointer list-none items-center gap-4 rounded-2xl p-3 hover:bg-surface-2 sm:p-4 [&::-webkit-details-marker]:hidden">
        {summary}
        <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-dim transition group-open/day:rotate-180">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-line p-4 sm:p-6">{children}</div>
    </details>
  );
}
