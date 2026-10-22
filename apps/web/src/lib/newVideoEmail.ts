import { EMAIL, emailButton, emailColors, emailLogo, emailShell, esc } from "@/lib/emailLook";
import { isDefaultTitle } from "@/lib/videoTitle";

/**
 * Tells a client a video is waiting, under the business's logo (or, without
 * one, the SureFrame mark) and name. The
 * title is included once the business has given it one (the date-made default
 * says nothing). The link carries no key: the client's device already holds
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
}) {
  const sender = o.sender?.trim() || null;
  const from = sender ? `${sender} from ${o.business}` : o.business;
  const title = o.title?.trim() && !isDefaultTitle(o.title) ? o.title.trim() : null;
  const length = o.durationMs && o.durationMs >= 1000 ? lengthOf(o.durationMs) : null;
  // The email already comes from "Business A via SureFrame", so the subject names just the person (or the business without one).
  const subject = `${sender ?? o.business} sent you a video${title ? `: ${title}` : ""}`;
  const lead = `Hi ${o.clientName}, ${from} sent you a new video on SureFrame.`;
  const device =
    `It's private to you. The button opens it on any phone or computer where you've opened your personal link from ${o.business} before. ` +
    `On a different one, open that personal link first (${o.business} sent it to you themselves, for example by text or message), then the button works there too. ` +
    `Can't find it? Ask ${o.business} to send it again.`;
  const after = device + (o.noReply ? ` Please don't reply to this email; contact ${o.business} directly.` : "");
  const stop = o.unsubscribe ? `Don't want emails from ${o.business}? Turn them off: ${o.unsubscribe}` : "";
  const text = [o.business, "", lead, ...(title ? ["", title] : []), ...(length ? [title ? length : `Length: ${length}`] : []), "", `Watch it: ${o.link}`, "", after, ...(stop ? ["", stop] : []), "", "Sent with SureFrame"].join("\n");
  const colors = emailColors(o.color);
  const { link } = colors;
  const html = emailShell(`${emailLogo(o.logoUrl, o.business)}
<p style="font-size:15px;font-weight:600;color:${EMAIL.ink};margin:0 0 12px">${esc(o.business)}</p>
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${esc(lead)}</p>
${title ? `<p style="font-size:18px;line-height:1.4;font-weight:600;color:${EMAIL.ink};margin:0">${esc(title)}</p>` : ""}
${length ? `<p style="font-size:13px;color:${EMAIL.muted};margin:${title ? "2px" : "0"} 0 0">${title ? "" : "Length: "}${esc(length)}</p>` : ""}
${emailButton(o.link, "Watch the video", colors)}
<p style="font-size:12px;line-height:1.5;color:${EMAIL.muted};margin:0">${esc(after)}</p>
${o.unsubscribe ? `<p style="font-size:11px;color:${EMAIL.dim};margin:16px 0 0">Don&#39;t want emails from ${esc(o.business)}? <a href="${esc(o.unsubscribe)}" style="color:${link}">Turn them off</a></p>` : ""}`, undefined, colors.fill);
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
