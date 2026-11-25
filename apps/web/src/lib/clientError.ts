/**
 * A page's path as it may be written to the logs: a staff invite (/join), a client's personal link (/c) and a
 * discount code (/offer) are secrets held in the address itself, so the part after them is left out.
 */
export const loggablePath = (path: string) => path.replace(/^\/(join|c|offer)\/[^/]+/, "/$1/…");

/** Tells the server what broke in a visitor's browser, so it shows up in the logs. */
export function reportClientError(where: string, error: unknown) {
  try {
    const e = error as { name?: string; message?: string; stack?: string };
    const body = JSON.stringify({ where, name: e?.name, message: String(e?.message ?? error).slice(0, 500), stack: e?.stack?.slice(0, 1500), url: loggablePath(location.pathname), ua: navigator.userAgent });
    navigator.sendBeacon?.("/api/support/client-error", new Blob([body], { type: "application/json" }));
  } catch {}
}
