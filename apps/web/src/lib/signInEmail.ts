import { BRAND } from "@/lib/brand";
import { CODE_MINUTES } from "@/lib/signInCodeRules";
import { EMAIL, emailButton, emailColors, emailDocument, emailMark, emailShell, esc } from "@/lib/emailLook";

/** The magic-link email, with the code to type instead (lib/signInCode.ts). Pure, so it can be tested and previewed. */
export function signInEmail(url: string, host: string, code?: string) {
  const spaced = code && `${code.slice(0, 3)} ${code.slice(3)}`;
  const subject = `Your ${BRAND.name} sign-in link`;
  const text = [
    `Sign in to ${BRAND.name}:`,
    url,
    "",
    "This link works once and expires in 24 hours.",
    ...(spaced ? ["", `Or type this code on the sign-in page: ${spaced}`, `The code works for ${CODE_MINUTES} minutes.`] : []),
    `If you didn't ask to sign in to ${host}, you can ignore this email.`,
    "",
    "Sent with SureFrame",
  ].join("\n");
  const html = emailShell(`${emailMark()}
<p style="font-size:18px;font-weight:600;margin:0 0 16px">Sign in to ${esc(BRAND.name)}</p>
${emailButton(url, "Sign in", emailColors())}
<p style="font-size:14px;line-height:1.5;color:${EMAIL.body};margin:0 0 8px">This link works once and expires in 24 hours.</p>
${
  spaced
    ? `<p style="font-size:14px;line-height:1.5;color:${EMAIL.body};margin:16px 0 4px">Or type this code on the sign-in page:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:0 0 4px;font-family:ui-monospace,Menlo,Consolas,monospace">${spaced}</p>
<p style="font-size:13px;line-height:1.5;color:${EMAIL.muted};margin:0 0 16px">The code works for ${CODE_MINUTES} minutes.</p>`
    : ""
}
<p style="font-size:13px;line-height:1.5;color:${EMAIL.muted};margin:0">If you didn't ask to sign in to ${esc(host)}, you can ignore this email.</p>`);
  return { subject, text, html: emailDocument(html, subject) };
}
