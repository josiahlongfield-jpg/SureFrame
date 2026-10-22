import { BRAND } from "@/lib/brand";
import { CODE_MINUTES } from "@/lib/signInCodeRules";
import { EMAIL, emailButton, emailColors, emailDocument, emailMark, emailShell, esc } from "@/lib/emailLook";

/** The magic-link email. Pure, so it can be tested and previewed. */
export function signInEmail(url: string) {
  const subject = `Your ${BRAND.name} sign-in link`;
  const text = [
    `Sign in to ${BRAND.name}:`,
    url,
    "",
    "This link works once and expires in 24 hours.",
    `If you didn't ask to sign in to ${BRAND.name}, you can ignore this email.`,
    "",
    `Sent with ${BRAND.name}`,
  ].join("\n");
  const html = emailShell(`${emailMark()}
<p style="font-size:18px;font-weight:600;margin:0 0 16px">Sign in to ${esc(BRAND.name)}</p>
${emailButton(url, "Sign in", emailColors())}
<p style="font-size:14px;line-height:1.5;color:${EMAIL.body};margin:0 0 8px">This link works once and expires in 24 hours.</p>
<p style="font-size:13px;line-height:1.5;color:${EMAIL.muted};margin:0">If you didn't ask to sign in to ${esc(BRAND.name)}, you can ignore this email.</p>`);
  return { subject, text, html: emailDocument(html, subject) };
}

/** Connecting Claude (lib/signInLink.ts forClaude): a code to type in the window Claude opened, and no link. */
export function signInCodeEmail(code: string) {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const subject = `Your ${BRAND.name} code to connect Claude`;
  const text = [
    `Your code to connect Claude to ${BRAND.name}: ${spaced}`,
    "",
    `Type it in the ${BRAND.name} window that Claude opened. It works for ${CODE_MINUTES} minutes.`,
    `If you didn't ask to sign in to ${BRAND.name}, you can ignore this email.`,
    "",
    `Sent with ${BRAND.name}`,
  ].join("\n");
  const html = emailShell(`${emailMark()}
<p style="font-size:18px;font-weight:600;margin:0 0 16px">Your code to connect Claude to ${esc(BRAND.name)}</p>
<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:0 0 12px;font-family:ui-monospace,Menlo,Consolas,monospace">${spaced}</p>
<p style="font-size:14px;line-height:1.5;color:${EMAIL.body};margin:0 0 8px">Type it in the ${esc(BRAND.name)} window that Claude opened. It works for ${CODE_MINUTES} minutes.</p>
<p style="font-size:13px;line-height:1.5;color:${EMAIL.muted};margin:0">If you didn't ask to sign in to ${esc(BRAND.name)}, you can ignore this email.</p>`);
  return { subject, text, html: emailDocument(html, subject) };
}
