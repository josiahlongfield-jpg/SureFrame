"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import RouteChoice, { routeLine, routeOf, type Route } from "./SendRoute";

/**
 * How the client receives their videos: by email (their address, also used for reminders) or by a link the business
 * copies and sends its own way. Changed in place (Josiah, 23 October 2026: "you can change this in Clients at any
 * time"). Names the client in full (O36: "Client B2", not "Client").
 */
export default function ClientEmail({ clientId, name, initial, optedOut }: { clientId: string; name: string; initial: string | null; optedOut: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [route, setRoute] = useState<Route>(routeOf({ email: initial }));
  const [email, setEmail] = useState(initial ?? "");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/clients/${clientId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: route === "email" ? email : "" }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? "Could not save");
    setError(undefined);
    setEditing(false);
    setSaved(routeLine(name, route));
    router.refresh();
  }

  if (editing) {
    return (
      <form onSubmit={save} className="mt-2 grid max-w-md gap-2 text-sm" data-testid="route-edit">
        <RouteChoice route={route} onRoute={setRoute} email={email} onEmail={setEmail} />
        {/* Copy link means no email address is kept, so nothing at all is emailed to them. */}
        {route === "link" && initial && <p className="text-xs text-dim">{initial} is removed, so we won&apos;t email {name} anything, reminders included.</p>}
        <div className="flex gap-2">
          <button disabled={route === "email" && !email.trim()} className="rounded-lg bg-solid px-3 py-1 font-medium text-white disabled:opacity-50">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="text-dim">Cancel</button>
        </div>
        {error && <span role="alert" className="text-danger-fg">{error}</span>}
      </form>
    );
  }
  return (
    <>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-dim" data-testid="client-route">
        {initial ? <span>Receives videos by email: {initial}</span> : <span>Receives videos by copy link, sent however you choose.</span>}
        <button
          onClick={() => {
            setRoute(routeOf({ email: initial }));
            setEmail(initial ?? "");
            setSaved(undefined);
            setEditing(true);
          }}
          className="font-medium text-accent hover:underline"
          data-testid="route-change"
        >
          Change
        </button>
        {initial && optedOut && <span className="rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn-fg">Emails turned off by client</span>}
      </p>
      {saved && <p role="status" className="mt-1 text-sm text-ok-fg" data-testid="route-saved">{saved}</p>}
    </>
  );
}
