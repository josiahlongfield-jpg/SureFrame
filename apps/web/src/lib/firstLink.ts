import { BRAND } from "./brand";

/**
 * The note a business sends a client with their personal link, ready to paste
 * into a text, chat or its own email. The link holds the client's key, so it
 * goes from the business itself, never from us (see components/FirstLinkSender.tsx).
 */
export function firstLinkMessage({ name, business, link, video, email }: { name: string; business: string; link: string; video?: boolean; email?: boolean }) {
  const subject = video ? `A video for you from ${business}` : `Your personal link from ${business}`;
  const body = [
    `Hi ${name},`,
    "",
    video ? `I've recorded a video for you. Watch it here (no account or app needed):` : `I'll be sending you videos through ${BRAND.name}. Here's your personal link:`,
    link,
    "",
    video
      ? `Open it on the phone or computer you'd like to watch on, and it remembers you there. ${email ? "My next videos will come straight to your email." : "My next videos will show up there too."}`
      : `Open it once on the phone or computer you'll watch on, and it remembers you there. ${email ? "After that, new videos come straight to your email." : "After that, all my videos show up there."}`,
    "",
    "This link is just for you, so please keep it private.",
    "",
    business,
  ].join("\n");
  return { subject, body };
}

/** The business's own email app, filled in: to the client, with the message. */
export function mailtoFor(to: string, msg: { subject: string; body: string }) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(msg.body.replace(/\n/g, "\r\n"))}`;
}
