"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** The client's email, used for reminders. Editable in place. */
export default function ClientEmail({ clientId, firstName, initial, optedOut }: { clientId: string; firstName: string; initial: string | null; optedOut: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(initial ?? "");
  const [error, setError] = useState<string>();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/clients/${clientId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? "Could not save");
    setError(undefined);
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <form onSubmit={save} className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" aria-label="Client email" autoFocus className="rounded-lg border border-line-strong px-2 py-1" />
        <button className="rounded-lg bg-solid px-3 py-1 font-medium text-white">Save</button>
        <button type="button" onClick={() => setEditing(false)} className="text-dim">Cancel</button>
        {error && <span role="alert" className="text-danger-fg">{error}</span>}
      </form>
    );
  }
  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-dim">
      {initial ? initial : <span>No email yet, so {firstName} can&apos;t get reminders.</span>}
      <button onClick={() => setEditing(true)} className="font-medium text-accent hover:underline">
        {initial ? "Change" : "Add email"}
      </button>
      {initial && optedOut && <span className="rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn-fg">{firstName} turned reminder emails off</span>}
    </p>
  );
}
