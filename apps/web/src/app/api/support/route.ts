import { z } from "zod";
import { db } from "@/lib/db";
import { LEGAL } from "@/lib/legal";
import { handle, HttpError, currentUser } from "@/lib/session";
import { clientIp, limitByIp, rateLimit } from "@/lib/rateLimit";
import { answer, assistantEnabled } from "@/lib/support/assistant";
import { TALK_TO_PERSON } from "@/lib/support/person";
import { handToHuman, newAccessToken, publicTicket } from "@/lib/support/tickets";

// The assistant can take a few turns; leave room to hand over if it's slow.
export const maxDuration = 120;

const MAX_MESSAGES = 60;
const Body = z.object({
  token: z.string().min(20).max(64).optional(),
  body: z.string().trim().min(1).max(4000),
  email: z.string().trim().email().max(254).optional(),
  /** "Talk to a person": hand over straight away, without the assistant (Decision 3, 18 October 2026). */
  person: z.boolean().optional(),
});

async function load(token: string) {
  const ticket = await db.supportTicket.findUnique({ where: { accessToken: token }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!ticket) throw new HttpError(404, "Conversation not found");
  return ticket;
}

/** A signed-in customer's conversation is theirs alone, even on a shared computer after they've been signed out. */
const ownedBySomeoneElse = (ticket: { userId: string | null }, me: { user: { id: string } } | null) => !!ticket.userId && ticket.userId !== me?.user.id;

/** The conversation for the token the browser holds (checked for a person's reply). */
export const GET = handle(async (req: Request) => {
  await limitByIp("support-read", 120, 600);
  const token = req.headers.get("x-support-token");
  if (!token) throw new HttpError(400, "Missing conversation");
  const ticket = await load(token);
  if (ownedBySomeoneElse(ticket, await currentUser().catch(() => null))) throw new HttpError(403, "Sign in to see this conversation");
  return Response.json(publicTicket(ticket));
});

/**
 * A customer's message. Starts a conversation when there's no token. The
 * assistant answers until a person has replied; after that, new messages go
 * to the person and the support inbox hears about each one.
 */
export const POST = handle(async (req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Please write a message (up to 4,000 characters) and check the email address.");
  await limitByIp("support", 30, 3600);
  const { token, body, email, person } = parsed.data;
  const me = await currentUser().catch(() => null);
  // Daily allowances, so one person (signed in or not) can't run up AI costs or flood the inbox.
  await dailyAllowance(me ? `support-day:user:${me.user.id}` : `support-day:ip:${await clientIp()}`, me ? 80 : 25);

  // A token for a conversation that's since been deleted, or that belongs to someone else's account, starts a new one.
  let ticket = token ? await load(token).catch(() => null) : null;
  if (ticket && ownedBySomeoneElse(ticket, me)) ticket = null;
  if (!ticket) {
    await limitByIp("support-new", 15, 86400).catch(() => { throw new HttpError(429, TODAY_LIMIT); });
    ticket = await db.supportTicket.create({
      data: { accessToken: newAccessToken(), userId: me?.user.id, workspaceId: me?.workspace.id, email: me ? null : email },
      include: { messages: true },
    });
  } else if (email && !ticket.email && !ticket.userId) {
    await db.supportTicket.update({ where: { id: ticket.id }, data: { email } });
  }
  if (ticket.messages.length >= MAX_MESSAGES) throw new HttpError(429, "This conversation is very long. Please start a new one.");
  await rateLimit(`support:ticket:${ticket.id}`, 20, 600);
  await db.supportMessage.create({ data: { ticketId: ticket.id, author: "CUSTOMER", body } });

  const say = (body: string) => db.supportMessage.create({ data: { ticketId: ticket.id, author: "ASSISTANT", body } });

  if (person) {
    // The button hands over itself: the conversation goes to the inbox's "Needs you" list and the team is emailed,
    // whatever the assistant would have made of it. The chat then shows "Passed to a person".
    if (ticket.status === "NEEDS_HUMAN" || ticket.status === "ANSWERED") await handToHuman(ticket.id, null, ticket.urgent);
    else await handToHuman(ticket.id, personSummary(ticket.messages, body, !!me), false);
  } else if (ticket.status === "ANSWERED") {
    // A person is talking with them now: pass it on rather than have the assistant cut in.
    await handToHuman(ticket.id, null, ticket.urgent);
    await say("Thanks, I've added that to your conversation with the team. They'll reply here and by email.");
  } else if (assistantEnabled() && (await underDailyAiCap())) {
    // Before a person has replied, the assistant keeps helping, even once the team has been told.
    const waiting = ticket.status === "NEEDS_HUMAN";
    if (ticket.status === "CLOSED") await db.supportTicket.update({ where: { id: ticket.id }, data: { status: "OPEN" } });
    try {
      const { handedOver } = await answer(ticket.id);
      if (waiting && !handedOver) await handToHuman(ticket.id, null, ticket.urgent);
    } catch (e) {
      const err = e as { status?: number; message?: string; error?: unknown };
      console.error("[support] assistant failed", JSON.stringify({ ticket: ticket.id, status: err.status, message: err.message?.slice(0, 500), error: err.error }));
      // If the assistant had already handed over before failing, keep its summary.
      const now = await db.supportTicket.findUnique({ where: { id: ticket.id }, select: { status: true } });
      await handToHuman(ticket.id, waiting || now?.status === "NEEDS_HUMAN" ? null : "The assistant had a technical problem answering. Please reply to the customer.", ticket.urgent);
      await say("Sorry, I hit a problem answering that. I've passed your message to the team, and a person will reply.");
    }
  } else {
    await handToHuman(ticket.id, ticket.status === "NEEDS_HUMAN" ? null : "New message (the assistant is switched off).", ticket.urgent);
    await say("Thanks. Your message is with the team, and a person will reply.");
  }
  const fresh = await load(ticket.accessToken);
  return Response.json({ token: fresh.accessToken, ...publicTicket(fresh) });
});

/** What the team reads first when the customer pressed "Talk to a person": their own words, never the assistant's. */
function personSummary(earlier: { author: string; body: string }[], body: string, signedIn: boolean) {
  const asked = [...earlier.filter((m) => m.author === "CUSTOMER").map((m) => m.body), body].filter((b) => b !== TALK_TO_PERSON);
  const quote = (s: string) => `"${s.length > 300 ? `${s.slice(0, 300)}…` : s}"`;
  return [
    `Asked for a person with the "Talk to a person" button${signedIn ? "" : " (a website visitor, not signed in)"}.`,
    asked.length ? `${asked.length === 1 ? "What they wrote" : "What they wrote first and last"}: ${asked.length === 1 ? quote(asked[0]) : `${quote(asked[0])} … ${quote(asked.at(-1)!)}`}` : "They haven't said what it's about yet.",
  ].join(" ");
}

/** A ceiling on assistant answers per day across everyone, so a flood of new chats can't run up the AI bill. */
const underDailyAiCap = () => rateLimit("support-ai:global", Number(process.env.SUPPORT_AI_DAILY_CAP ?? 2000), 86400).then(() => true, () => false);

const TODAY_LIMIT = `You've reached today's limit for the help chat. Please email ${LEGAL.email} and a person will get back to you.`;
const dailyAllowance = (key: string, limit: number) => rateLimit(key, limit, 86400).catch(() => { throw new HttpError(429, TODAY_LIMIT); });
