import { EMAIL, emailButton, emailColors, emailLogo, emailShell, esc } from "@/lib/emailLook";
import { clientTitle, isDefaultTitle } from "@/lib/videoTitle";
import { nameWithBusiness } from "@/lib/senderLine";
import { clientEmailContact, type ClientContact } from "@/lib/clientContact";

/**
 * Tells a client a video is waiting, under the business's logo (or, without
 * one, the SureFrame mark) and name. The video is named by its title once the
 * business has given it one, else "A video from Business A" (the date-made
 * default says nothing; Decision 10). The link carries no key: the client's device already holds
 * it from their personal link, which is why only clients who have opened it
 * are emailed. Names the person who recorded it when they've set a name, as
 * the app does ("Team member 1 from Business A").
 */
export function newVideoEmail(o: {
  business: string;
  sender?: string | null;
  clientName: string;
  link: string;
  title?: string | null;
  logoUrl?: string | null;
  color?: string | null;
  unsubscribe?: string;
  noReply?: boolean;
  /** How long it is, said beside the title so the client knows what's waiting (C39). */
  durationMs?: number | null;
  /** The business's contact line for its clients (Settings > Branding), if it set one. */
  contact?: ClientContact | null;
}) {
  const sender = o.sender?.trim() || null;
  // Just the name once when it is the business's own ("Checker D", not "Checker D from Checker D", D3).
  const from = sender ? nameWithBusiness(sender, o.business, "from") : o.business;
  const title = o.title?.trim() && !isDefaultTitle(o.title) ? o.title.trim() : null;
  // What the video is called in the email, as on the client's pages: "A video from Business A" until it's given a title (Decision 10).
  const heading = clientTitle(title, o.business);
  const length = o.durationMs && o.durationMs >= 1000 ? lengthOf(o.durationMs) : null;
  // Names the business too (a client may know "Business A" but not "Owner A"), and a sole trader's name only once (C39).
  const subject = `${sender ? nameWithBusiness(sender, o.business, "at") : o.business} sent you a video${title ? `: ${title}` : ""}`;
  const lead = `Hi ${o.clientName}, ${from} sent you a new video on SureFrame.`;
  // Short (S50, C38): most people tap the button on the phone or computer they always use. The page it opens on a new one
  // explains the rest and can ask the business for the link again (app/v/[id], locked).
  const device = `It's private to you. Doesn't open? Open the personal link ${o.business} sent you on that phone or computer first, then the button works there too.`;
  const reach = clientEmailContact(o.business, o.contact, o.noReply);
  const after = device + (reach ? ` ${reach}` : "");
  const stop = o.unsubscribe ? `Don't want emails from ${o.business}? Turn them off: ${o.unsubscribe}` : "";
  const text = [o.business, "", lead, "", heading, ...(length ? [length] : []), "", `Watch it: ${o.link}`, "", after, ...(stop ? ["", stop] : []), "", "Sent with SureFrame"].join("\n");
  const colors = emailColors(o.color);
  const { link } = colors;
  const html = emailShell(`${emailLogo(o.logoUrl, o.business)}
<p style="font-size:15px;font-weight:600;color:${EMAIL.ink};margin:0 0 12px">${esc(o.business)}</p>
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${esc(lead)}</p>
<p style="font-size:18px;line-height:1.4;font-weight:600;color:${EMAIL.ink};margin:0">${esc(heading)}</p>
${length ? `<p style="font-size:13px;color:${EMAIL.muted};margin:2px 0 0">${esc(length)}</p>` : ""}
${emailButton(o.link, "Watch the video", colors)}
<p style="font-size:12px;line-height:1.5;color:${EMAIL.muted};margin:0">${esc(after)}</p>
${o.unsubscribe ? `<p style="font-size:12px;color:${EMAIL.dim};margin:16px 0 0">Don&#39;t want emails from ${esc(o.business)}? <a href="${esc(o.unsubscribe)}" style="color:${link}">Turn them off</a></p>` : ""}`, undefined, colors.fill);
  return { subject, text, html };
}

/** "45 seconds", "2 minutes", "1 hr 5 min". */
function lengthOf(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} ${s === 1 ? "second" : "seconds"}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"}`;
  return `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ""}`;
}
