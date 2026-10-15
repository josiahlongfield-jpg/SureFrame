"use client";

import Link from "next/link";
import { useState } from "react";

export type Notice = { id: string; from: string; message: string; link: string | null; linkLabel: string | null; createdAt: string };

/** Reminders an owner or admin sent this staff member, until they dismiss them. */
export default function StaffNotices({ initial }: { initial: Notice[] }) {
  const [notices, setNotices] = useState(initial);
  if (!notices.length) return null;
  async function dismiss(id: string) {
    setNotices((list) => list.filter((n) => n.id !== id));
    await fetch(`/api/team/notices/${id}/dismiss`, { method: "POST" }).catch(() => {});
  }
  return (
    <div className="border-t border-warn-line bg-warn-bg">
      <ul className="mx-auto max-w-6xl divide-y divide-warn-line px-4 sm:px-6">
        {notices.map((n) => (
          <li key={n.id} role="status" data-testid="staff-notice" className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm text-warn-fg">
            <p className="min-w-0 flex-1">
              <span className="font-medium">Reminder from {n.from}:</span> <span className="whitespace-pre-wrap">{n.message}</span>
              {n.link && (
                <>
                  {" "}
                  <Link href={n.link} className="font-medium underline">{n.linkLabel ?? "Open"}</Link>
                </>
              )}
            </p>
            <button onClick={() => dismiss(n.id)} className="shrink-0 rounded-lg px-2 py-0.5 text-warn-fg hover:bg-hover">Dismiss</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
