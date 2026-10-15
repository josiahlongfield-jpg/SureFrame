import { EMAIL, emailButton, emailColors, emailLogo, emailShell, esc } from "@/lib/emailLook";

/**
 * Sent to a client when their business resets its keys (someone left the
 * team). The link carries no key: the client's device upgrades the key it
 * already holds, and a new device needs the full link from the business.
 */
export function newLinkEmail(o: { business: string; clientName: string; link: string; logoUrl?: string | null; color?: string | null }) {
  const subject = `${o.business} sent you a new private link`;
  const lead = `Hi ${o.clientName}, ${o.business} has refreshed the security on your private SureFrame page, so your old link no longer works.`;
  const after = "Use this new link from now on. On a phone or computer you haven't used before, ask them for your full personal link.";
  const text = [lead, "", `Your new link: ${o.link}`, "", after].join("\n");
  const colors = emailColors(o.color);
  const html = emailShell(`${emailLogo(o.logoUrl, o.business)}
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${esc(lead)}</p>
${emailButton(o.link, "Open your page", colors)}
<p style="font-size:12px;line-height:1.5;color:${EMAIL.muted};margin:0">${esc(after)}</p>`, undefined, colors.fill);
  return { subject, text, html };
}
