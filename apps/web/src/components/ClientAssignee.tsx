"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Person = { id: string; name: string };

/**
 * On a client's page: who looks after them, and for owners and admins on a team, the same control as on the
 * Clients list to change it (it saves straight away and says so).
 */
export default function ClientAssignee({
  clientId,
  clientName,
  initial,
  staff,
  meId,
  canAssign,
}: {
  clientId: string;
  clientName: string;
  initial: string | null;
  staff: Person[];
  meId: string;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [assignedToId, setAssigned] = useState(initial);
  const [saved, setSaved] = useState<string>();
  const [error, setError] = useState<string>();
  const nameOf = (id: string | null) => staff.find((p) => p.id === id)?.name;
  const who = (id: string | null) => (id ? (id === meId ? "you" : (nameOf(id) ?? "a former team member")) : "the owner and admins (unassigned)");

  async function change(next: string | null) {
    setError(undefined);
    setSaved(undefined);
    const res = await fetch(`/api/clients/${clientId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignedToId: next }) }).catch(() => null);
    if (!res?.ok) return setError((await res?.json().catch(() => ({})))?.error ?? "Couldn't change who looks after them. Try again.");
    setAssigned(next);
    setSaved(next ? `Saved: ${next === meId ? "you look" : `${nameOf(next) ?? "they"} looks`} after ${clientName}.` : `Saved: ${clientName} is unassigned.`);
    // The to-do form's "Email …" reminder choice follows who looks after them.
    router.refresh();
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="looked-after-by">
      {canAssign ? (
        <label className="flex flex-wrap items-center gap-2">
          <span>Looked after by</span>
          <select
            value={assignedToId ?? ""}
            onChange={(e) => change(e.target.value || null)}
            aria-label={`Who looks after ${clientName}`}
            className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-sm text-ink"
          >
            <option value="">Unassigned (owner and admins)</option>
            {staff.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === meId ? `${p.name} (you)` : p.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>Looked after by {who(assignedToId)}.</p>
      )}
      {saved && (
        <span role="status" className="text-xs text-ok-fg" data-testid="client-assign-saved">
          {saved}
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-danger-fg">
          {error}
        </span>
      )}
    </div>
  );
}
