"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** A client's name as the page heading, with Rename to change it in place. */
export default function ClientName({ clientId, initial }: { clientId: string; initial: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  // The saved name shows at once; the refresh brings the rest of the page along.
  const [current, setCurrent] = useState(initial);
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim() === current) return setEditing(false);
    setBusy(true);
    const res = await fetch(`/api/clients/${clientId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return setError(data?.error ?? "Couldn't save the name. Check your connection and try again.");
    setError(undefined);
    setCurrent(name.trim());
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <form onSubmit={save} className="flex flex-wrap items-center gap-2" data-testid="rename-client">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          aria-label="Client name"
          autoFocus
          className="min-w-0 flex-1 rounded-lg border border-line-strong px-3 py-1.5 text-lg font-semibold text-ink"
        />
        <button disabled={busy} className="rounded-lg bg-solid px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">Save</button>
        <button type="button" onClick={() => { setName(current); setError(undefined); setEditing(false); }} className="text-sm text-dim">Cancel</button>
        {error && <p role="alert" className="w-full text-sm text-danger-fg">{error}</p>}
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="break-words text-2xl font-semibold tracking-tight text-ink">{current}</h1>
      <button onClick={() => setEditing(true)} className="text-sm font-medium text-accent hover:underline" data-testid="rename-open">
        Rename
      </button>
    </div>
  );
}
