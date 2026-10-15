import { BRAND } from "@/lib/brand";
import { EMAIL, emailButton, emailColors, emailShell, esc } from "@/lib/emailLook";

/** The magic-link email. Pure, so it can be tested and previewed. */
export function signInEmail(url: string, host: string) {
  const subject = `Your ${BRAND.name} sign-in link`;
  const text = [
    `Sign in to ${BRAND.name}:`,
    url,
    "",
    "This link works once and expires in 24 hours.",
    `If you didn't ask to sign in to ${host}, you can ignore this email.`,
  ].join("\n");
  const html = emailShell(`<p style="font-size:18px;font-weight:600;margin:0 0 16px">Sign in to ${esc(BRAND.name)}</p>
${emailButton(url, "Sign in", emailColors().fill)}
<p style="font-size:13px;color:${EMAIL.body};margin:0 0 8px">This link works once and expires in 24 hours.</p>
<p style="font-size:12px;color:${EMAIL.muted};margin:0">If you didn't ask to sign in to ${esc(host)}, you can ignore this email.</p>`, BRAND.name);
  return { subject, text, html };
}
