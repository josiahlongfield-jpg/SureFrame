import { EMAIL, emailButton, emailColors, emailLogo, emailShell, esc } from "@/lib/emailLook";
import { clientEmailContact, type ClientContact } from "@/lib/clientContact";

/**
 * Sent to a client when their business resets its keys (someone left the
 * team), only if they had opened their old link (lib/rekey.ts). The link
 * carries no key: the device they used upgrades the key it already holds,
 * and a new device needs the full link from the business.
 */
export function newLinkEmail(o: { business: string; clientName: string; link: string; logoUrl?: string | null; color?: string | null; contact?: ClientContact | null }) {
  const subject = `${o.business} sent you a new personal link`;
  const lead = `Hi ${o.clientName}, ${o.business} replaced your personal link to keep your videos secure, so your old link no longer opens them.`;
  const how = "Open this new link on the phone or computer you used before, and your videos and replies are all there, as before. Use it from now on.";
  const reach = clientEmailContact(o.business, o.contact);
  const after = `On a phone or computer you haven't used before, it can't open your videos: ask ${o.business} for your full personal link.${reach ? ` ${reach}` : ""}`;
  const text = [lead, "", how, "", `Your new link: ${o.link}`, "", after, "", "Sent with SureFrame"].join("\n");
  const colors = emailColors(o.color);
  const html = emailShell(`${emailLogo(o.logoUrl, o.business)}
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${esc(lead)}</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 16px;color:${EMAIL.body}">${esc(how)}</p>
${emailButton(o.link, "Open your page", colors)}
<p style="font-size:12px;line-height:1.5;color:${EMAIL.muted};margin:0">${esc(after)}</p>`, undefined, colors.fill);
  return { subject, text, html };
}
