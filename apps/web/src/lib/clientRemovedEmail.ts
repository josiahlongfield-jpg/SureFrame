import { EMAIL, emailLogo, emailShell, esc } from "@/lib/emailLook";

/**
 * Sent to a client when their business removes them, if the business chose
 * to tell them. No button: the link no longer works. Says how long the
 * business can still restore their access.
 */
export function clientRemovedEmail(o: { business: string; clientName: string; until: string; logoUrl?: string | null; noReply?: boolean }) {
  const subject = `Your access to ${o.business} on SureFrame has ended`;
  const lead = `Hi ${o.clientName}, ${o.business} has ended your access to your private SureFrame page, so your link no longer opens your videos.`;
  const body = `If that's a mistake, contact ${o.business}. They can restore your access until ${o.until}. After that, your videos, messages and shared to-dos with them are deleted for good.`;
  const after = o.noReply ? `Please don't reply to this email; contact ${o.business} directly.` : "";
  const text = [lead, "", body, ...(after ? ["", after] : []), "", "Sent with SureFrame"].join("\n");
  const html = emailShell(`${emailLogo(o.logoUrl, o.business)}
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${esc(lead)}</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 16px;color:${EMAIL.body}">${esc(body)}</p>
${after ? `<p style="font-size:12px;color:${EMAIL.muted};margin:0">${esc(after)}</p>` : ""}`);
  return { subject, text, html };
}
