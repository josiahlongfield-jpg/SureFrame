import { BRAND } from "@/lib/brand";
import { EMAIL, emailButton, emailColors, emailShell, esc } from "@/lib/emailLook";
import { LEGAL } from "@/lib/legal";
import { emailDocument } from "@/lib/signInEmail";

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
    "Save your recovery key. It opens your encrypted videos on a new phone or computer, and we can't recover it for you. You can show it again any time under Account, Show recovery key.",
    "Add your first client, with their email address.",
    "Record a video and send it to them.",
  ];
  const help = `Questions? Press Help in the corner of any ${BRAND.name} page, or email ${LEGAL.email}.`;
  const text = [hi, "", lead, ...steps.map((s, i) => `${i + 1}. ${s}`), "", `Open ${BRAND.name}: ${o.link}`, "", help].join("\n");
  const html = emailShell(`<p style="font-size:18px;font-weight:600;margin:0 0 16px">${esc(subject)}</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 8px">${esc(hi)}</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${esc(lead)}</p>
<ol style="font-size:14px;line-height:1.5;margin:0 0 8px;padding-left:20px;color:${EMAIL.body}">${steps.map((s) => `<li style="margin:0 0 6px">${esc(s)}</li>`).join("")}</ol>
${emailButton(o.link, `Open ${BRAND.name}`, emailColors())}
<p style="font-size:13px;line-height:1.5;color:${EMAIL.muted};margin:0">${esc(help)}</p>`, BRAND.name);
  return { subject, text, html: emailDocument(html, subject) };
}
