"use client";

import { useEffect, useId, useState } from "react";
import { CONTACT_EMAIL_MAX, emailProblem, phoneProblem } from "@/lib/clientContact";

/** How a client gets their videos: we email them, or the business copies their link and sends it its own way. */
export type Route = "email" | "link";

/** A client's route: an email address saved means Email; none means Copy link. */
export const routeOf = (c: { email?: string | null }): Route => (c.email ? "email" : "link");

/** The line confirming a client's route once it's chosen (Josiah, 23 October 2026: said once, when they're added or changed). */
export function routeLine(name: string, route: Route) {
  return route === "email"
    ? `${name} will receive their videos by email. You can change this in Clients at any time.`
    : `${name} will receive their videos by copy link, sent however you choose. You can change this in Clients at any time.`;
}

/**
 * "How would you like this client to receive their video?": Email (with their address) or Copy link. Chosen when a
 * client is added (Send box and Clients page) and changed on the client's own page. One choice, not both (Josiah,
 * 23 October 2026), so nobody lands on a to-do list after already being emailed.
 */
export default function RouteChoice({
  route,
  onRoute,
  email,
  onEmail,
}: {
  route: Route | null;
  onRoute: (r: Route) => void;
  email: string;
  onEmail: (email: string) => void;
}) {
  const name = useId();
  return (
    <fieldset className="grid min-w-0 gap-2" data-testid="route-choice">
      <legend className="mb-1 text-sm font-medium text-ink">How would you like this client to receive their video?</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name={name} value="email" checked={route === "email"} onChange={() => onRoute("email")} data-testid="route-email" />
        Email
      </label>
      {route === "email" && (
        <input
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          type="email"
          required
          autoFocus
          placeholder="Their email address"
          aria-label="Client email"
          className="ml-6 min-w-0 rounded-lg border border-line-strong px-3 py-2 text-sm"
        />
      )}
      {route === "email" && <ContactAsk />}
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name={name} value="link" checked={route === "link"} onChange={() => onRoute("link")} data-testid="route-link" />
        Copy link (to be sent however you choose)
      </label>
    </fieldset>
  );
}

/**
 * Asked under Email while the business has no reply-to email and no contact line (MAIL-11, owners and admins only:
 * api/workspace/settings GET), so the emails we send clients say how to reach it. Saved as the business's contact
 * line (Settings > Branding) when the box is left or Enter is pressed. Optional: the client is added either way.
 */
function ContactAsk() {
  const [ask, setAsk] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/workspace/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setAsk(!!d?.askContact), () => {});
    return () => {
      live = false;
    };
  }, []);

  async function save() {
    const v = value.trim();
    if (!v) return setError(undefined);
    const isEmail = v.includes("@");
    const problem = isEmail ? emailProblem(v) : phoneProblem(v);
    if (problem) return setError(problem);
    const r = await fetch("/api/workspace/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isEmail ? { contactEmail: v } : { contactPhone: v }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) return setError(d.error ?? "Couldn't save. Check your connection and try again.");
    setError(undefined);
    setSaved(true);
  }

  if (saved) return <p role="status" className="ml-6 text-xs text-ok-fg" data-testid="route-contact-saved">Saved. You can change it on Settings &gt; Branding.</p>;
  if (!ask) return null;
  return (
    <label className="ml-6 grid min-w-0 gap-1 text-xs text-dim" data-testid="route-contact-ask">
      <span>How can clients reach you? We add it to the emails we send them.</span>
      <input
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(undefined); }}
        onBlur={save}
        // Enter saves this, rather than sending the form it sits in.
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }}
        maxLength={CONTACT_EMAIL_MAX}
        autoComplete="off"
        placeholder="Your email or phone number"
        aria-label="How clients can reach you"
        aria-invalid={!!error}
        className="min-w-0 rounded-lg border border-line-strong px-3 py-2 text-sm text-ink"
      />
      {error && <span role="alert" className="text-danger-fg">{error}</span>}
    </label>
  );
}
