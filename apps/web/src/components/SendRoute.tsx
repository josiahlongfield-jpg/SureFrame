"use client";

import { useId } from "react";

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
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name={name} value="link" checked={route === "link"} onChange={() => onRoute("link")} data-testid="route-link" />
        Copy link (to be sent however you choose)
      </label>
    </fieldset>
  );
}
