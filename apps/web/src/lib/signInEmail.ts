import { BRAND } from "@/lib/brand";
import { EMAIL, emailButton, emailColors, emailShell, esc } from "@/lib/emailLook";

/**
 * A whole HTML document around an email, with a viewport tag, so a phone
 * shows it at its own width instead of a zoomed-out desktop page.
 */
export const emailDocument = (html: string, title: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="margin:0;padding:0">${html}</body></html>`;

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
${emailButton(url, "Sign in", emailColors())}
<p style="font-size:14px;line-height:1.5;color:${EMAIL.body};margin:0 0 8px">This link works once and expires in 24 hours.</p>
<p style="font-size:13px;line-height:1.5;color:${EMAIL.muted};margin:0">If you didn't ask to sign in to ${esc(host)}, you can ignore this email.</p>`, BRAND.name);
  return { subject, text, html: emailDocument(html, subject) };
}
