import { randomBytes } from "node:crypto";
import { rateLimit } from "@/lib/rateLimit";
import type { SupportMessage, SupportTicket } from "@prisma/client";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { notify } from "@/lib/notifications";
import { EMAIL, emailButton, emailColors, emailMark, emailShell } from "@/lib/emailLook";
import { appUrl } from "@/lib/stripe";
import { REPLY_WITHIN } from "@/lib/support/person";

/** Where handed-over conversations are announced. Set SUPPORT_EMAIL in production. */
export const supportInbox = () => process.env.SUPPORT_EMAIL || null;

/** People who can read and answer tickets in /support (comma-separated emails). */
export function isSupportAgent(email: string | null | undefined) {
  if (!email) return false;
  const agents = (process.env.SUPPORT_AGENTS ?? process.env.SUPPORT_EMAIL ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return agents.includes(email.toLowerCase());
}

export const newAccessToken = () => randomBytes(24).toString("base64url");

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const paragraphs = (s: string) => esc(s).split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px;white-space:pre-wrap">${p}</p>`).join("");

/**
 * Marks a ticket as needing a person and emails the support inbox. Without a
 * summary (the customer added to a handed-over conversation) the first one stays.
 */
export async function handToHuman(ticketId: string, summary: string | null, urgent: boolean) {
  // Urgency only goes up here; a person clears it by replying or closing.
  const before = await db.supportTicket.findUnique({ where: { id: ticketId }, select: { urgent: true } });
  const escalated = urgent && !before?.urgent;
  const ticket = await db.supportTicket.update({
    where: { id: ticketId },
    data: { status: "NEEDS_HUMAN", urgent: urgent || !!before?.urgent, ...(summary ? { summary } : {}) },
    include: { user: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  const to = supportInbox();
  if (!to) return;
  // Keep the inbox usable: one email per conversation per half hour, a smaller daily ceiling for
  // visitors who aren't signed in (so they can't crowd out customers), and one overall.
  // Everything still shows at /support.
  const allowed = (key: string, limit: number, windowSec: number) => rateLimit(key, limit, windowSec).then(() => true, () => false);
  // A conversation that's just become urgent always gets through.
  if (!escalated && !(await allowed(`support-mail:${ticketId}`, 1, 1800))) return;
  if (!ticket.userId && !(await allowed("support-mail:visitors", Number(process.env.SUPPORT_MAIL_VISITOR_CAP ?? 50), 86400))) return;
  if (!(await allowed("support-mail:all", Number(process.env.SUPPORT_MAIL_DAILY_CAP ?? 200), 86400))) return;
  const who = ticket.user?.email ?? ticket.email ?? "a website visitor (no email given)";
  const link = appUrl(`/support/${ticket.id}`);
  const transcript = ticket.messages.map((m) => `${m.author === "CUSTOMER" ? "Customer" : m.author === "ASSISTANT" ? "Assistant" : "You"}: ${m.body}`).join("\n\n");
  await sendMail({
    to,
    subject: `${ticket.urgent ? "[Urgent] " : ""}Support${summary ? "" : " (new message)"}: ${who}`,
    text: [`Summary: ${ticket.summary ?? ""}`, "", `Answer it here: ${link}`, "", "Conversation so far:", "", transcript].join("\n"),
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#0f172a">
<p style="margin:0 0 12px"><strong>${ticket.urgent ? "Urgent: " : ""}${esc(who)}</strong> needs a person.</p>
${paragraphs(ticket.summary ?? "")}
<p style="margin:16px 0"><a href="${esc(link)}">Open the conversation and reply</a></p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">
${paragraphs(transcript)}
</div>`,
    replyTo: ticket.user?.email ?? ticket.email,
  }).catch((e) => console.error("support email failed", e));
}

/**
 * A short "your question is with a person" email to the customer, sent once for each new hand-over when there's an
 * address to send it to (a signed-in customer's, or the one a visitor gave in the chat), so they know it happened
 * even after closing the chat (V36). Visitors' addresses aren't checked, so it says what to do if they didn't ask.
 */
export async function acknowledgeHandOver(ticketId: string) {
  const ticket = await db.supportTicket.findUnique({ where: { id: ticketId }, include: { user: { select: { email: true } } } });
  const to = ticket?.user?.email ?? ticket?.email;
  if (!ticket || !to) return;
  const link = appUrl(`/help#t=${ticket.accessToken}`);
  const lines = [
    `Thanks for getting in touch. Your question is with a person on the SureFrame team, and we reply ${REPLY_WITHIN} (Queensland, Australia time), by email and in the help chat.`,
    "You don't need to do anything else. To add details, write in the help chat.",
    ...(ticket.userId ? [] : ["If you didn't ask SureFrame for help, you can ignore this email."]),
  ];
  await sendMail({
    to,
    subject: "Your question is with a person at SureFrame",
    text: [...lines, `See the conversation: ${link}`, "Sent with SureFrame"].join("\n\n"),
    html: emailShell(`${emailMark()}<p style="font-size:13px;font-weight:600;color:${EMAIL.muted};margin:-8px 0 12px">Support</p>
<div style="font-size:15px;line-height:1.5">${lines.map((l) => paragraphs(l)).join("")}</div>
${emailButton(link, "See the conversation", emailColors())}`),
    replyTo: supportInbox(),
  }).catch((e) => console.error("support acknowledgement email failed", e));
}

/** A person's reply: stored on the ticket and emailed to the customer when we have an address. */
export async function staffReply(ticket: SupportTicket & { user: { email: string } | null }, body: string) {
  await db.supportMessage.create({ data: { ticketId: ticket.id, author: "STAFF", body } });
  await db.supportTicket.update({ where: { id: ticket.id }, data: { status: "ANSWERED", urgent: false } });
  // A signed-in customer's bell too (lib/notifications.ts), in the business they asked from.
  if (ticket.userId && ticket.workspaceId)
    await notify([{ userId: ticket.userId, workspaceId: ticket.workspaceId, kind: "SUPPORT", text: "Reply from SureFrame support", href: `/help#t=${ticket.accessToken}`, groupKey: `support:${ticket.id}` }]);
  const to = ticket.user?.email ?? ticket.email;
  if (!to) return false;
  const link = appUrl(`/help#t=${ticket.accessToken}`);
  await sendMail({
    to,
    subject: "Reply from SureFrame support",
    text: [body, "", `See the whole conversation or reply: ${link}`, "", "Sent with SureFrame"].join("\n"),
    html: emailShell(`${emailMark()}<p style="font-size:13px;font-weight:600;color:${EMAIL.muted};margin:-8px 0 12px">Support</p>
<div style="font-size:15px;line-height:1.5">${paragraphs(body)}</div>
${emailButton(link, "See the conversation or reply", emailColors())}`),
    replyTo: supportInbox(),
  });
  return true;
}

/** What the customer's browser sees: never the assistant's hand-over summary. */
export function publicTicket(ticket: SupportTicket & { messages: SupportMessage[] }) {
  return {
    status: ticket.status,
    // Visitors who didn't give an address can add one later, so a person's reply can reach them.
    hasEmail: !!(ticket.userId || ticket.email),
    messages: ticket.messages.map((m) => ({ id: m.id, author: m.author, body: m.body, at: m.createdAt.toISOString() })),
  };
}
