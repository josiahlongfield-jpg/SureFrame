import { localParts } from "@/lib/schedule";
import { EMAIL, emailButton, emailColors, emailLogo, emailShell, esc } from "@/lib/emailLook";

/**
 * The reminder email. Pure, so the settings page can show a live preview.
 * The to-do's text is end-to-end encrypted and never appears in the email;
 * the recipient opens their list to read it.
 */
export function reminderEmail(o: {
  business: string;
  message?: string | null;
  due: Date;
  now?: Date;
  tz: string;
  link: string;
  /** Client emails carry an unsubscribe link. */
  unsubscribe?: string;
  /** A reminder to the business itself, optionally about one client's list. */
  team?: boolean;
  clientName?: string;
  /** The business's logo (absolute URL) and accent colour, on paid plans. */
  logoUrl?: string | null;
  color?: string | null;
  /** No reply-to is set, so replies would go nowhere: say so. */
  noReply?: boolean;
}) {
  const when = dueText(o.due, o.now ?? new Date(), o.tz);
  // The time is the business's; say whose, since a client or staff member may be in another zone.
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: o.tz, timeZoneName: "short" }).formatToParts(o.due).find((p) => p.type === "timeZoneName")?.value;
  const whenZoned = zone ? `${when} (${zone})` : when;
  const subject = !o.team
    ? `Reminder from ${o.business}: a to-do is due ${when}`
    : o.clientName ? `${o.clientName}: a to-do is due ${when}` : `A to-do on your list is due ${when}`;
  const lead = !o.team
    ? `You have a to-do from ${o.business} due ${whenZoned}.`
    : o.clientName ? `A to-do on ${o.clientName}'s list is due ${whenZoned}.` : `A to-do on your list is due ${whenZoned}.`;
  const message = o.team ? "" : o.message?.trim();
  const text = [
    lead,
    message ? `\n${message}` : "",
    `\nOpen your list: ${o.link}`,
    "\nFor privacy, the details are only shown in the app.",
    o.noReply ? `\nPlease don't reply to this email; contact ${o.business} directly.` : "",
    o.unsubscribe ? `\nStop emails from ${o.business}: ${o.unsubscribe}` : "",
    "\nSent with SureFrame",
  ].join("\n");
  const colors = emailColors(o.color);
  const { link } = colors;
  const html = emailShell(`${emailLogo(o.logoUrl, o.business)}
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${esc(lead)}</p>
${message ? `<p style="font-size:15px;line-height:1.5;white-space:pre-wrap;margin:0 0 16px;color:${EMAIL.body}">${esc(message)}</p>` : ""}
${emailButton(o.link, "Open your list", colors)}
<p style="font-size:12px;color:${EMAIL.muted};margin:0">For privacy, the details are only shown in the app.</p>
${o.noReply ? `<p style="font-size:12px;color:${EMAIL.muted};margin:8px 0 0">Please don&#39;t reply to this email; contact ${esc(o.business)} directly.</p>` : ""}
${o.unsubscribe ? `<p style="font-size:12px;color:${EMAIL.muted};margin:8px 0 0"><a href="${esc(o.unsubscribe)}" style="color:${link}">Stop emails from ${esc(o.business)}</a></p>` : ""}`, undefined, colors.fill);
  return { subject, text, html, when };
}

/** "today at 9am", "tomorrow at 6:30pm", "on Sun, Oct 12 at 9am". */
export function dueText(due: Date, now: Date, tz: string) {
  const d = localParts(due, tz);
  const n = localParts(now, tz);
  const days = Math.round((Date.UTC(d.y, d.m - 1, d.d) - Date.UTC(n.y, n.m - 1, n.d)) / 86_400_000);
  const time = due.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" ", "").toLowerCase();
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days > 1 && days < 7) return `on ${due.toLocaleDateString("en-US", { timeZone: tz, weekday: "long" })} at ${time}`;
  return `on ${due.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" })} at ${time}`;
}
