import crypto from "node:crypto";
import { BRAND } from "@/lib/brand";
import { EMAIL, emailButton, emailColors, emailDocument, emailMark, emailShell, esc } from "@/lib/emailLook";
import { appSecret, safeEqual } from "@/lib/secrets";

/** How long the link to confirm a new sign-in email works. */
export const EMAIL_CHANGE_HOURS = 24;

type Change = { u: string; from: string; to: string; exp: number };

const sign = (body: string) => crypto.createHmac("sha256", `${appSecret()}:email-change`).update(body).digest("base64url");

/**
 * Changing the sign-in email (Settings > Account, O104): a signed link sent to the new address proves it's
 * theirs. Nothing is stored: the link names the account, the old and new address and when it ends, and works
 * only while the account still has the old address, so it can't be used twice.
 */
export function emailChangeToken(userId: string, from: string, to: string, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ u: userId, from, to, exp: now + EMAIL_CHANGE_HOURS * 3_600_000 } satisfies Change)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The change a link asks for, or null when it's been altered or has ended. */
export function readEmailChange(token: string | undefined | null, now = Date.now()): Change | null {
  const [body, mac] = (token ?? "").split(".");
  if (!body || !mac || !safeEqual(mac, sign(body))) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Change;
    if (typeof c.u !== "string" || typeof c.from !== "string" || typeof c.to !== "string" || typeof c.exp !== "number") return null;
    return c.exp > now ? c : null;
  } catch {
    return null;
  }
}

/** To the new address: the button that makes the change. */
export function emailChangeConfirmEmail(link: string, from: string, to: string) {
  const subject = `Confirm your new ${BRAND.name} sign-in email`;
  const lead = `Someone signed in to ${BRAND.name} as ${from} asked to sign in with this address (${to}) from now on.`;
  const after = `The link works for ${EMAIL_CHANGE_HOURS} hours. If you didn't ask for this, ignore this email: nothing changes.`;
  const text = [lead, "", `Confirm the change: ${link}`, "", after, "", "Sent with SureFrame"].join("\n");
  const html = emailShell(`${emailMark()}
<p style="font-size:18px;font-weight:600;margin:0 0 16px">Confirm your new sign-in email</p>
<p style="font-size:15px;line-height:1.5;color:${EMAIL.body};margin:0 0 16px">${esc(lead)}</p>
${emailButton(link, "Confirm the change", emailColors())}
<p style="font-size:13px;line-height:1.5;color:${EMAIL.muted};margin:0">${esc(after)}</p>`);
  return { subject, text, html: emailDocument(html, subject) };
}

/** To the old address: asked for, and then done, so a change nobody asked for is noticed. */
export function emailChangeNoticeEmail(kind: "asked" | "done", from: string, to: string) {
  const subject = kind === "asked" ? `A change of your ${BRAND.name} sign-in email was asked for` : `Your ${BRAND.name} sign-in email was changed`;
  const lead =
    kind === "asked"
      ? `Someone signed in to your ${BRAND.name} account asked to change its sign-in email from ${from} to ${to}. It only changes once that new address confirms it.`
      : `Your ${BRAND.name} account now signs in with ${to} instead of ${from}. Your videos, clients and settings are unchanged.`;
  const help = `Wasn't you? Email support@sureframe.app straight away.`;
  const text = [lead, "", help, "", "Sent with SureFrame"].join("\n");
  const html = emailShell(`${emailMark()}
<p style="font-size:15px;line-height:1.5;color:${EMAIL.body};margin:0 0 16px">${esc(lead)}</p>
<p style="font-size:13px;line-height:1.5;color:${EMAIL.muted};margin:0">${esc(help)}</p>`);
  return { subject, text, html: emailDocument(html, subject) };
}
