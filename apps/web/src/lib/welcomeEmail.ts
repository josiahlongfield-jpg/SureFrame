import { BRAND } from "@/lib/brand";
import { EMAIL, emailButton, emailColors, emailDocument, emailMark, emailShell, esc } from "@/lib/emailLook";
import { LEGAL } from "@/lib/legal";

/**
 * The one welcome email a new owner gets after the welcome step
 * (app/welcome): their first steps and where to get help. Pure, so it can be
 * tested and previewed.
 */
export function welcomeEmail(o: { name: string | null; business: string; link: string }) {
  const subject = `Welcome to ${BRAND.name}`;
  const hi = o.name ? `Hi ${o.name},` : "Hi,";
  const lead = `${o.business} is set up on ${BRAND.name}. Here are your first steps:`;
  const steps = [
    "Save your recovery key. It opens your encrypted videos on a new phone or computer, and we can't recover it for you. You can show it again any time under Settings > Account (Show recovery key).",
    "Add a client, with their email if you have it.",
    "Record a video and pick the client in its Send box. Send a new client's first video yourself, with Send from your email or Copy link: they just open it and watch, and it sets them up on that phone or computer.",
    "After that, press Send by email and we'll email them each new video.",
  ];
  const help = `Questions? Press Help in the corner of any ${BRAND.name} page, or email ${LEGAL.email}.`;
  const text = [hi, "", lead, ...steps.map((s, i) => `${i + 1}. ${s}`), "", `Open ${BRAND.name}: ${o.link}`, "", help, "", "Sent with SureFrame"].join("\n");
  const html = emailShell(`${emailMark()}
<p style="font-size:18px;font-weight:600;margin:0 0 16px">${esc(subject)}</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 8px">${esc(hi)}</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${esc(lead)}</p>
<ol style="font-size:14px;line-height:1.5;margin:0 0 8px;padding-left:20px;color:${EMAIL.body}">${steps.map((s) => `<li style="margin:0 0 6px">${esc(s)}</li>`).join("")}</ol>
${emailButton(o.link, `Open ${BRAND.name}`, emailColors())}
<p style="font-size:13px;line-height:1.5;color:${EMAIL.muted};margin:0">${esc(help)}</p>`);
  return { subject, text, html: emailDocument(html, subject) };
}
