import { EMAIL, emailColors, emailLogo, emailShell, esc } from "@/lib/emailLook";
import { clientEmailContact, type ClientContact } from "@/lib/clientContact";

/**
 * Sent to a client when their business deletes them (lib/clientRemoval.ts), in
 * good faith (Josiah, 24 October 2026). No button: the link no longer works,
 * and nothing of theirs is kept to come back to.
 */
export function clientRemovedEmail(o: { business: string; clientName: string; logoUrl?: string | null; color?: string | null; noReply?: boolean; contact?: ClientContact | null }) {
  const subject = `Your access to ${o.business} on SureFrame has ended`;
  const lead = `Hi ${o.clientName}, ${o.business} has ended your access to your private SureFrame page, so your link no longer opens your videos.`;
  const body = `Your videos, messages and shared to-dos with ${o.business} have been deleted for good. If ${o.business} works with you again, they'll send you a new personal link. Thank you for using SureFrame with them.`;
  const after = clientEmailContact(o.business, o.contact, o.noReply) ?? "";
  const text = [lead, "", body, ...(after ? ["", after] : []), "", "Sent with SureFrame"].join("\n");
  const html = emailShell(`${emailLogo(o.logoUrl, o.business)}
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${esc(lead)}</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 16px;color:${EMAIL.body}">${esc(body)}</p>
${after ? `<p style="font-size:12px;color:${EMAIL.muted};margin:0">${esc(after)}</p>` : ""}`, undefined, emailColors(o.color).fill);
  return { subject, text, html };
}
