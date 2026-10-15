import { EMAIL, emailButton, emailColors, emailLogo, emailShell, esc } from "@/lib/emailLook";

/**
 * Tells a client a video is waiting. The video's title isn't included (it
 * can be personal) and the link carries no key: the client's device already
 * holds it from their personal link. Names the person who recorded it when
 * they've set a name, as the app does ("Sam from Peak Fitness").
 */
export function newVideoEmail(o: { business: string; sender?: string | null; clientName: string; link: string; logoUrl?: string | null; color?: string | null; unsubscribe?: string; noReply?: boolean }) {
  const from = o.sender?.trim() ? `${o.sender.trim()} from ${o.business}` : o.business;
  const subject = `${from} sent you a video`;
  const lead = `Hi ${o.clientName}, ${from} sent you a new video on SureFrame.`;
  const after = "It's private to you. If it doesn't open on this device, use the personal link they gave you first." + (o.noReply ? ` Please don't reply to this email; contact ${o.business} directly.` : "");
  const stop = o.unsubscribe ? `Don't want emails from ${o.business}? Turn them off: ${o.unsubscribe}` : "";
  const text = [lead, "", `Watch it: ${o.link}`, "", after, ...(stop ? ["", stop] : [])].join("\n");
  const { fill, link } = emailColors(o.color);
  const html = emailShell(`${emailLogo(o.logoUrl, o.business)}
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${esc(lead)}</p>
${emailButton(o.link, "Watch the video", fill)}
<p style="font-size:12px;line-height:1.5;color:${EMAIL.muted};margin:0">${esc(after)}</p>
${o.unsubscribe ? `<p style="font-size:11px;color:${EMAIL.dim};margin:16px 0 0">Don&#39;t want emails from ${esc(o.business)}? <a href="${esc(o.unsubscribe)}" style="color:${link}">Turn them off</a></p>` : ""}`);
  return { subject, text, html };
}
