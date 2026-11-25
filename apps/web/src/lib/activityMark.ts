/**
 * Signed values for the activity cookie and the "keep me signed in" cookie (lib/activity.ts, src/middleware.ts).
 *
 * These used to be a bare time and a bare "1", so anyone at the keyboard could type them into the browser and bring
 * back a sign-in that had ended (browser closed, or 8 hours unused). Each now carries an HMAC made with AUTH_SECRET
 * over its value and the account it was issued to: only the server can make one, and one account's can't be used
 * beside another account's session. A missing, altered or borrowed value counts the same as an expired one.
 *
 * Tied to the account inside the session cookie, not to that cookie's text: Auth.js re-issues the text
 * (GET /api/auth/session), and it doesn't exist yet at the moment a sign-in sets these.
 *
 * Runs in the middleware too, so only Web APIs here.
 */
import { KEEP_DAYS } from "@/lib/activity";
import { sameText } from "@/lib/maintenance";

/** The app's signing secret, as appSecret() in lib/secrets.ts (which needs Node, so the middleware can't load it). */
export function sessionSecret() {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is not set");
    return "dev";
  }
  return s;
}

type Kind = "active" | "keep";

async function signature(kind: Kind, value: string, userId: string) {
  const text = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", text.encode(sessionSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, text.encode(`sureframe-${kind}:${value}:${userId}`)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const signed = async (kind: Kind, value: number, userId: string) => `${value}.${await signature(kind, String(value), userId)}`;

/** The time inside a signed cookie value, or null unless the server made it, for this account. */
async function read(kind: Kind, cookie: string | undefined, userId: string) {
  const [value, sig, ...rest] = (cookie ?? "").split(".");
  if (!sig || rest.length || !/^[1-9]\d{0,15}$/.test(value)) return null;
  return sameText(sig, await signature(kind, value, userId)) ? Number(value) : null;
}

/** The activity cookie's value: the time of the last request (now), signed for this account. */
export const activityMark = (userId: string, at = Date.now()) => signed("active", at, userId);

/** The time in an activity cookie, or null when it is missing, altered or another account's. */
export const activityAt = (cookie: string | undefined, userId: string) => read("active", cookie, userId);

/** The KEEP cookie's value: when "keep me signed in" ends (KEEP_DAYS from now), signed for this account. */
export const keepMark = (userId: string, until = Date.now() + KEEP_DAYS * 86_400_000) => signed("keep", until, userId);

/** Whether a KEEP cookie is the server's, for this account, and hasn't run out. */
export async function keeps(cookie: string | undefined, userId: string) {
  const until = await read("keep", cookie, userId);
  return until !== null && until > Date.now();
}
