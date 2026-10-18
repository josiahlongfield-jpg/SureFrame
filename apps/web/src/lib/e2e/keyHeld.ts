/**
 * A cookie telling the server that this browser holds a client's key (never the key itself). Until it's
 * there, their inbox and video pages show only how to get the key onto this device, not their videos: a
 * device that opened an email link but never the personal link isn't treated as the client's. Titles
 * aren't secret (see About), so this is about not treating a keyless device as theirs, not a lock.
 */
export const keyHeldCookie = (clientId: string) => `fc_key_${clientId}`;

/** Set or clear it from the browser, alongside the key in this device's storage (lib/e2e/keystore.ts). */
export function markKeyHeld(clientId: string, held: boolean) {
  if (typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${keyHeldCookie(clientId)}=${held ? "1" : ""}; path=/; samesite=lax; max-age=${held ? 60 * 60 * 24 * 365 : 0}${secure}`;
}
