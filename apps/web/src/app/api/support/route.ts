import { z } from "zod";
import { db } from "@/lib/db";
import { LEGAL } from "@/lib/legal";
import { handle, HttpError, currentUser } from "@/lib/session";
import { clientIp, limitByIp, rateLimit } from "@/lib/rateLimit";
import { answer, assistantEnabled } from "@/lib/support/assistant";
import { TALK_TO_PERSON } from "@/lib/support/person";
import { acknowledgeHandOver, handToHuman, newAccessToken, publicTicket } from "@/lib/support/tickets";
import { aiRefusal, personRefusal, recordAi, recordPerson, SUPPORT_LIMITS, supportTier, type Asker, type Refusal, type SupportTier } from "@/lib/support/allowance";
import { qldTime } from "@/lib/support/when";
import { browserFrom } from "@/lib/support/browser";

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
 * A limit the chat has reached: the browser gets when it lifts and what it stops ("ai": asking the assistant,
 * "person": Talk to a person, "all": both), so it can turn Send or the button off until then (O80, V88).
 */
class Refused extends HttpError {
  constructor(message: string, public until: Date | null, public stops: "ai" | "person" | "all") {
    super(429, message);
  }
}
const refused = (r: Refusal, stops: Refused["stops"]) => new Refused(r.message, r.until, stops);

/** When a fixed rate-limit window (lib/rateLimit.ts) ends, said the way the chat says it. */
function windowEnd(windowSec: number) {
  const ms = windowSec * 1000;
  const until = new Date((Math.floor(Date.now() / ms) + 1) * ms);
  const minutes = Math.ceil((until.getTime() - Date.now()) / 60_000);
  return { until, when: minutes <= 60 ? `Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` : `You can ask again from ${qldTime(until)}.` };
}
/** A rate limit with the chat's own message and when it lifts. */
async function limited(check: Promise<unknown>, windowSec: number, message: string, stops: Refused["stops"] = "all") {
  await check.catch((e) => {
    if (!(e instanceof HttpError) || e.status !== 429) throw e;
    const { until, when } = windowEnd(windowSec);
    throw new Refused(`${message} ${when}`, until, stops);
  });
}

/**
 * A customer's message. Starts a conversation when there's no token. The
 * assistant answers until a person has replied; after that, new messages go
 * to the person and the support inbox hears about each one.
 */
export const POST = handle(async (req: Request) => {
  try {
    return await post(req);
  } catch (e) {
    if (e instanceof Refused) return Response.json({ error: e.message, until: e.until?.toISOString() ?? null, stops: e.stops }, { status: 429 });
    throw e;
  }
});

async function post(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Please write a message (up to 4,000 characters) and check the email address.");
  await limited(limitByIp("support", 30, 3600), 3600, "You've sent a lot of messages in a short time.");
  const { token, body, email, person } = parsed.data;
  const me = await currentUser().catch(() => null);
  // Anyone who isn't paying has a smaller, fixed allowance on top (lib/support/allowance.ts).
  const tier = supportTier(me?.workspace);
  const unpaid = tier === "paying" ? null : SUPPORT_LIMITS[tier];
  // Daily allowances, so one person (signed in or not) can't run up AI costs or flood the inbox.
  await limited(rateLimit(me ? `support-day:user:${me.user.id}` : `support-day:ip:${await clientIp()}`, me ? 80 : 25, 86400), 86400, unpaid ? UNPAID_TODAY_LIMIT : TODAY_LIMIT);

  // A token for a conversation that's since been deleted, or that belongs to someone else's account, starts a new one.
  let ticket = token ? await load(token).catch(() => null) : null;
  if (ticket && ownedBySomeoneElse(ticket, me)) ticket = null;
  const asker: Asker = { tier, workspaceId: me?.workspace.id, network: await clientIp(), email: me ? null : (email ?? ticket?.email ?? null) };
  const withTeam = ticket?.status === "NEEDS_HUMAN" || ticket?.status === "ANSWERED";

  // Checked before anything is stored, so a refused message stays in the box and costs nothing.
  const personRefused = withTeam ? null : await personRefusal(asker);
  if (person && personRefused) throw refused(personRefused, "person");
  // An AI answer is needed unless a person is already talking with them or they pressed "Talk to a person".
  const aiRefused = person || ticket?.status === "ANSWERED" ? null : await aiRefusal(asker);
  // Once the team has the conversation, their message still reaches the team without an AI answer.
  if (aiRefused && !withTeam) throw refused(aiRefused, "ai");

  if (!ticket) {
    await limited(limitByIp(unpaid ? `support-new-${tier}` : "support-new", unpaid?.newChatsPerDay ?? 15, 86400), 86400, unpaid ? NEW_CHAT_LIMIT : TODAY_LIMIT);
    ticket = await db.supportTicket.create({
      data: { accessToken: newAccessToken(), userId: me?.user.id, workspaceId: me?.workspace.id, email: me ? null : email },
      include: { messages: true },
    });
  } else if (email && !ticket.email && !ticket.userId) {
    await db.supportTicket.update({ where: { id: ticket.id }, data: { email } });
  }
  if (ticket.messages.length >= (unpaid?.messagesPerChat ?? MAX_MESSAGES)) throw new HttpError(429, "This conversation is very long. Please start a new one.");
  await limited(rateLimit(`support:ticket:${ticket.id}`, 20, 600), 600, "You've sent a lot of messages in this conversation in a short time.");
  await db.supportMessage.create({ data: { ticketId: ticket.id, author: "CUSTOMER", body } });

  const say = (body: string) => db.supportMessage.create({ data: { ticketId: ticket.id, author: "ASSISTANT", body } });
  /**
   * Passes the conversation to a person. A new hand-over from someone who isn't paying uses their allowance, and is
   * refused (with why) once it's used up; a message added to a conversation the team already has always gets through.
   * The allowance is counted only once the hand-over has happened (so the chat shows "Passed to a person" for every
   * one counted), and the customer gets a short email saying so when there's an address for them.
   */
  const handOver = async (summary: string | null, urgent: boolean): Promise<string | null> => {
    const now = await db.supportTicket.findUnique({ where: { id: ticket.id }, select: { status: true } });
    const isNew = now?.status !== "NEEDS_HUMAN" && now?.status !== "ANSWERED";
    if (isNew) {
      const refused = await personRefusal(asker);
      if (refused) return refused.message;
    }
    await handToHuman(ticket.id, summary, urgent);
    if (isNew) {
      await recordPerson(asker);
      await acknowledgeHandOver(ticket.id);
    }
    return null;
  };

  if (person) {
    // The button hands over itself: the conversation goes to the inbox's "Needs you" list and the team is emailed,
    // whatever the assistant would have made of it. The chat then shows "Passed to a person".
    const no = await handOver(withTeam ? null : personSummary(ticket.messages, body, !!me, tier), withTeam && ticket.urgent);
    // Only if the allowance ran out since the check above (another tab): the message is kept, and the chat says why.
    if (no) throw new Refused(no, null, "person");
  } else if (ticket.status === "ANSWERED" || aiRefused) {
    // A person is talking with them now (or has the conversation, and the AI allowance is used up): pass it on.
    await handToHuman(ticket.id, null, ticket.urgent);
    await say("Thanks, I've added that to your conversation with the team. They'll reply here and by email.");
  } else if (assistantEnabled() && (await underDailyAiCap())) {
    // Before a person has replied, the assistant keeps helping, even once the team has been told.
    const waiting = ticket.status === "NEEDS_HUMAN";
    if (ticket.status === "CLOSED") await db.supportTicket.update({ where: { id: ticket.id }, data: { status: "OPEN" } });
    await recordAi(asker);
    try {
      const { handedOver } = await answer(ticket.id, { tier, handOver, personRefused: personRefused?.message, browser: browserFrom(req.headers) });
      if (waiting && !handedOver) await handToHuman(ticket.id, null, ticket.urgent);
    } catch (e) {
      const err = e as { status?: number; message?: string; error?: unknown };
      console.error("[support] assistant failed", JSON.stringify({ ticket: ticket.id, status: err.status, message: err.message?.slice(0, 500), error: err.error }));
      // If the assistant had already handed over before failing, keep its summary.
      const now = await db.supportTicket.findUnique({ where: { id: ticket.id }, select: { status: true } });
      const refused = await handOver(waiting || now?.status === "NEEDS_HUMAN" ? null : "The assistant had a technical problem answering. Please reply to the customer.", ticket.urgent);
      await say(refused ? "Sorry, I hit a problem answering that. Please try again in a little while." : "Sorry, I hit a problem answering that. I've passed your message to the team, and a person will reply.");
    }
  } else {
    const refused = await handOver(ticket.status === "NEEDS_HUMAN" ? null : "New message (the assistant is switched off).", ticket.urgent);
    await say(refused ? "Sorry, the help chat can't answer right now. Please try again later, or look in the FAQ." : "Thanks. Your message is with the team, and a person will reply.");
  }
  const fresh = await load(ticket.accessToken);
  return Response.json({ token: fresh.accessToken, ...publicTicket(fresh) });
}

/** What the team reads first when the customer pressed "Talk to a person": their own words, never the assistant's. */
function personSummary(earlier: { author: string; body: string }[], body: string, signedIn: boolean, tier: SupportTier) {
  const asked = [...earlier.filter((m) => m.author === "CUSTOMER").map((m) => m.body), body].filter((b) => b !== TALK_TO_PERSON);
  const quote = (s: string) => `"${s.length > 300 ? `${s.slice(0, 300)}…` : s}"`;
  return [
    `Asked for a person with the "Talk to a person" button${signedIn ? (tier === "free" ? " (on the Free plan)" : "") : " (a website visitor, not signed in)"}.`,
    asked.length ? `${asked.length === 1 ? "What they wrote" : "What they wrote first and last"}: ${asked.length === 1 ? quote(asked[0]) : `${quote(asked[0])} … ${quote(asked.at(-1)!)}`}` : "They haven't said what it's about yet.",
  ].join(" ");
}

/** A ceiling on assistant answers per day across everyone, so a flood of new chats can't run up the AI bill. */
const underDailyAiCap = () => rateLimit("support-ai:global", Number(process.env.SUPPORT_AI_DAILY_CAP ?? 2000), 86400).then(() => true, () => false);

const TODAY_LIMIT = `You've reached today's limit for the help chat. Please email ${LEGAL.email} and a person will get back to you.`;
const NEW_CHAT_LIMIT = "You've started the most new conversations allowed today. Please carry on in your current one.";
const UNPAID_TODAY_LIMIT = "You've reached today's limit for the help chat. Most questions are answered in the FAQ.";
