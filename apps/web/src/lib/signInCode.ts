import crypto from "node:crypto";
import { db } from "@/lib/db";
import { appSecret, safeEqual } from "@/lib/secrets";
import { CODE_MINUTES, CODE_TRIES } from "@/lib/signInCodeRules";

/**
 * The 6-digit code in each sign-in email. Typing it on the Check your email page signs in the window that asked,
 * which matters when the email's link would open somewhere else: a phone's mail app opening links in another
 * browser, or Claude's sign-in window when connecting SureFrame to Claude (lib/connector), which then can't finish.
 *
 * The code stands in for the email's link: a right code sends the browser to the same one-time Auth.js link. The
 * link (which holds Auth.js's token) is kept encrypted, the code only as a hash, and each code allows a few tries.
 */

const key = () => crypto.createHash("sha256").update(`sign-in-code:${appSecret()}`).digest();
const hashOf = (email: string, code: string) => crypto.createHmac("sha256", key()).update(`${email}:${code}`).digest("hex");

function seal(text: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

function open(sealed: string) {
  const raw = Buffer.from(sealed, "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

/** Makes the code for a sign-in email that links to `callbackUrl` (Auth.js's). Only the newest code for an address works. */
export async function makeSignInCode(email: string, callbackUrl: string, now = new Date()) {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const url = new URL(callbackUrl);
  await db.$transaction([
    db.signInCode.deleteMany({ where: { email } }),
    db.signInCode.create({
      data: { email, codeHash: hashOf(email, code), link: seal(url.pathname + url.search), expiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000) },
    }),
  ]);
  return code;
}

export type CodeResult = { link: string } | { error: "code" | "wrong" | "expired" | "tries" };

/** Checks a typed code. A right one is used up and gives the sign-in link to send the browser to. */
export async function redeemSignInCode(email: string, typed: string, now = new Date()): Promise<CodeResult> {
  const code = typed.replace(/\D/g, "");
  if (code.length !== 6) return { error: "code" };
  const row = await db.signInCode.findFirst({ where: { email }, orderBy: { createdAt: "desc" } });
  if (!row || row.expiresAt <= now) return { error: "expired" };
  // Each try is counted in the database before the code is checked, so even tries sent all at once stop at the limit.
  const { count: tried } = await db.signInCode.updateMany({ where: { id: row.id, attempts: { lt: CODE_TRIES } }, data: { attempts: { increment: 1 } } });
  if (!tried) return { error: "tries" };
  if (!safeEqual(row.codeHash, hashOf(email, code))) return { error: "wrong" };
  // Only one request can use it: whoever deletes the row.
  const { count } = await db.signInCode.deleteMany({ where: { id: row.id } });
  if (!count) return { error: "expired" };
  return { link: open(row.link) };
}

/** Codes past their time; called from the daily purge job. */
export async function pruneSignInCodes(now = new Date()) {
  return (await db.signInCode.deleteMany({ where: { expiresAt: { lt: now } } })).count;
}
