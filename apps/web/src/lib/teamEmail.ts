import { EMAIL, emailButton, emailColors, emailLogo, emailShell, esc } from "@/lib/emailLook";

/**
 * Short emails to the team (client replies, videos sent by staff, staff
 * reminders). Encrypted content (replies, to-dos, video titles) never
 * appears; links open the app, where it's decrypted on the device.
 */
export function teamEmail(o: {
  business: string;
  subject: string;
  lead: string;
  /** Optional extra lines, each optionally linked. */
  lines?: { text: string; link?: string }[];
  /** A plain-text note from a person (staff reminders), shown as written. */
  note?: string;
  button: { label: string; link: string };
  footer?: string;
  logoUrl?: string | null;
  color?: string | null;
}) {
  const lines = o.lines ?? [];
  const text = [
    o.lead,
    o.note ? `\n${o.note}` : "",
    ...lines.map((l) => `- ${l.text}${l.link ? `: ${l.link}` : ""}`),
    `\n${o.button.label}: ${o.button.link}`,
    o.footer ? `\n${o.footer}` : "",
    "\nSent with SureFrame",
  ].join("\n");
  const colors = emailColors(o.color);
  const { link } = colors;
  const html = emailShell(`${emailLogo(o.logoUrl, o.business)}
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${esc(o.lead)}</p>
${o.note ? `<p style="font-size:15px;line-height:1.5;white-space:pre-wrap;margin:0 0 16px;color:${EMAIL.body}">${esc(o.note)}</p>` : ""}
${lines.length ? `<ul style="font-size:14px;line-height:1.5;margin:0 0 16px;padding-left:20px;color:${EMAIL.body}">${lines.map((l) => `<li>${l.link ? `<a href="${esc(l.link)}" style="color:${link}">${esc(l.text)}</a>` : esc(l.text)}</li>`).join("")}</ul>` : ""}
${emailButton(o.button.link, o.button.label, colors)}
${o.footer ? `<p style="font-size:12px;line-height:1.5;color:${EMAIL.muted};margin:0">${esc(o.footer)}</p>` : ""}`, undefined, colors.fill);
  return { subject: o.subject, text, html };
}
