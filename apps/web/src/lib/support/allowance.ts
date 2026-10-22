import crypto from "node:crypto";
import type { Plan } from "@prisma/client";
import { db } from "@/lib/db";
import { limitsOff } from "@/lib/rateLimit";
import { appSecret } from "@/lib/secrets";
import { qldTime } from "@/lib/support/when";

/**
 * Help-chat allowances for people who aren't paying (Josiah, 18 October 2026): the AI help chat and "Talk to a person"
 * cost money and the founder's time, so website visitors and Free plans get a small, fixed allowance over rolling days,
 * and the AI gives them brief answers to general questions only (lib/support/assistant.ts). Paying
 * businesses (and plans the team gave free) keep the usual limits and can talk to a person any time.
 *
 * Every AI answer and new hand-over by a non-paying person is a SupportUse row, counted by account and by a one-way
 * fingerprint of their network (IP) and email address, so a new conversation, a new free account or a new browser
 * doesn't reset it. Site-wide ceilings stop a crowd of visitors (or one person hopping networks) from crowding out
 * paying customers. Rows are deleted after 31 days (pruneSupportUse, from the daily purge job).
 */
export const SUPPORT_LIMITS = {
  visitor: { aiPerDay: 8, aiPerWeek: 20, personEveryDays: 30, newChatsPerDay: 3, messagesPerChat: 20 },
  free: { aiPerDay: 15, aiPerWeek: 40, personEveryDays: 7, newChatsPerDay: 5, messagesPerChat: 20 },
  /** Across everyone who isn't paying, per rolling 24 hours. */
  siteWide: { visitorAiPerDay: 250, unpaidAiPerDay: 400, visitorPersonPerDay: 5, freePersonPerDay: 10 },
} as const;

export type SupportTier = "paying" | "free" | "visitor";

/** Signed out, on Free, or on a plan (paid, or given free by the team, which counts as a customer here). */
export const supportTier = (workspace: { plan: Plan } | null | undefined): SupportTier => (!workspace ? "visitor" : workspace.plan === "FREE" ? "free" : "paying");

/**
 * The allowance in one line, for the help panel itself (O80, V40: the /help page says it above its chat, but the
 * floating panel didn't until someone hit a limit). Nothing for paying businesses.
 */
export function limitsNote(tier: SupportTier) {
  if (tier === "paying") return null;
  const L = SUPPORT_LIMITS[tier];
  const person = L.personEveryDays === 7 ? "once a week" : `once every ${L.personEveryDays} days`;
  return tier === "visitor"
    ? `Without an account: up to ${L.aiPerDay} answers a day (${L.aiPerWeek} a week), and Talk to a person ${person}, with your email address.`
    : `On the Free plan: up to ${L.aiPerDay} answers a day (${L.aiPerWeek} a week), and Talk to a person ${person}. Paid plans get full help and can talk to a person any time.`;
}

export type Asker = { tier: SupportTier; workspaceId?: string | null; network: string; email?: string | null };

const DAY = 86_400_000;
const fingerprint = (kind: string, value: string) => crypto.createHmac("sha256", appSecret()).update(`support-use:${kind}:${value.trim().toLowerCase()}`).digest("base64url").slice(0, 22);
const netKey = (a: Asker) => `net:${fingerprint("ip", a.network)}`;
const emailKey = (email: string) => `email:${fingerprint("email", email)}`;
const everyone = (tier: SupportTier) => `all:${tier}`;

/** When `key` drops back under `limit` uses of `kind` in the last `ms`, or null when it's under now. */
async function freeFrom(key: string, kind: string, limit: number, ms: number) {
  const rows = await db.supportUse.findMany({ where: { key, kind, at: { gt: new Date(Date.now() - ms) } }, orderBy: { at: "asc" }, select: { at: true } });
  return rows.length < limit ? null : new Date(rows[rows.length - limit].at.getTime() + ms);
}
const latest = (dates: (Date | null)[]) => dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);

async function record(kind: string, a: Asker, extra: (string | null | undefined)[] = []) {
  const keys = [netKey(a), everyone(a.tier), a.workspaceId ? `ws:${a.workspaceId}` : null, ...extra].filter((k): k is string => !!k);
  await db.supportUse.createMany({ data: [...new Set(keys)].map((key) => ({ kind, key })) });
}

export type Refusal = { message: string; until: Date | null };

const askAgain = (until: Date) => `You can ask again from ${qldTime(until)}.`;
/** How the chat names a shared network, for someone who didn't use the allowance themselves. */
const NETWORK = "the same Wi-Fi or mobile connection";

/** Whether this person can have another AI answer now. Always yes for paying businesses. */
export async function aiRefusal(a: Asker): Promise<Refusal | null> {
  if (a.tier === "paying" || limitsOff) return null;
  const L = SUPPORT_LIMITS[a.tier];
  const S = SUPPORT_LIMITS.siteWide;
  // Each key on its own, so the message can say whose use it was: this business's, or someone else's on the same network.
  const [netDay, wsDay, netWeek, wsWeek] = await Promise.all([
    freeFrom(netKey(a), "ai", L.aiPerDay, DAY),
    a.workspaceId ? freeFrom(`ws:${a.workspaceId}`, "ai", L.aiPerDay, DAY) : null,
    freeFrom(netKey(a), "ai", L.aiPerWeek, 7 * DAY),
    a.workspaceId ? freeFrom(`ws:${a.workspaceId}`, "ai", L.aiPerWeek, 7 * DAY) : null,
  ]);
  const day = latest([netDay, wsDay]);
  const week = latest([netWeek, wsWeek]);
  const upsell = a.tier === "free" ? " Paid plans get full help in the chat, and can talk to a person any time." : "";
  if (week || day) {
    const until = latest([day, week])!;
    const used = week ? `${L.aiPerWeek} answers a week` : `${L.aiPerDay} answers a day`;
    // A visitor is only counted by network; a Free business by its own use too. Say "you" only when it was theirs.
    const theirs = !!(week ? wsWeek : wsDay);
    const who = theirs ? "you've used them" : `they've been used on your network (${NETWORK})`;
    return { until, message: `The help chat gives ${a.tier === "free" ? "Free plans" : "website visitors"} ${used}, and ${who}. ${askAgain(until)} Most questions are answered in the FAQ.${upsell}` };
  }
  const visitorsBusy = a.tier === "visitor" ? await freeFrom(everyone("visitor"), "ai", S.visitorAiPerDay, DAY) : null;
  const unpaidBusy = (await countSince("ai", [everyone("visitor"), everyone("free")], DAY)) >= S.unpaidAiPerDay;
  if (visitorsBusy || unpaidBusy) {
    return { until: visitorsBusy, message: `The help chat is very busy and can't answer more questions from ${a.tier === "free" ? "Free plans" : "website visitors"} just now. Please try again later, or look in the FAQ.${upsell}` };
  }
  return null;
}

const countSince = (kind: string, keys: string[], ms: number) => db.supportUse.count({ where: { kind, key: { in: keys }, at: { gt: new Date(Date.now() - ms) } } });

/** Counts an AI answer against a non-paying person's allowance. */
export async function recordAi(a: Asker) {
  if (a.tier !== "paying") await record("ai", a);
}

/**
 * Whether this person can be passed to a person now (a new hand-over, not a message added to one already handed
 * over). Paying businesses always can. Website visitors once every 30 days (by network and email, and they must
 * give an email address), Free plans once a week (by workspace and network), with site-wide daily ceilings.
 */
export async function personRefusal(a: Asker): Promise<Refusal | null> {
  if (a.tier === "paying") return null;
  if (a.tier === "visitor" && !a.email) return { until: null, message: "Please add your email address below the chat first, so a person can reply to you." };
  if (limitsOff) return null;
  const L = SUPPORT_LIMITS[a.tier];
  const window = L.personEveryDays * DAY;
  const [byNet, byWs, byEmail] = await Promise.all([
    freeFrom(netKey(a), "handover", 1, window),
    a.workspaceId ? freeFrom(`ws:${a.workspaceId}`, "handover", 1, window) : null,
    a.email ? freeFrom(emailKey(a.email), "handover", 1, window) : null,
  ]);
  const mine = latest([byNet, byWs, byEmail]);
  if (mine) {
    // Refused only because someone else on the same network (an office, a shared connection) used it: say so, rather than "you".
    const network = !byWs && !byEmail;
    const done =
      a.tier === "free"
        ? network
          ? `someone on your network (${NETWORK}) has already done that this week`
          : "you've already done that this week"
        : network
          ? `someone on your network (${NETWORK}) has already done that`
          : "you've already done that";
    return {
      until: mine,
      message:
        a.tier === "free"
          ? `On the Free plan you can talk to a person once a week, and ${done}. ${askAgain(mine)} Paid plans can talk to a person any time. The assistant can still answer general questions.`
          : `Website visitors can talk to a person once every ${L.personEveryDays} days, and ${done}. ${askAgain(mine)} The assistant can still answer general questions.`,
    };
  }
  const cap = a.tier === "visitor" ? SUPPORT_LIMITS.siteWide.visitorPersonPerDay : SUPPORT_LIMITS.siteWide.freePersonPerDay;
  const busy = await freeFrom(everyone(a.tier), "handover", cap, DAY);
  if (busy) {
    return {
      until: busy,
      message: `The team can't take more questions from ${a.tier === "free" ? "Free plans" : "website visitors"} today. ${askAgain(busy)} The assistant can still answer general questions.`,
    };
  }
  return null;
}

/** Counts a new hand-over against a non-paying person's allowance. */
export async function recordPerson(a: Asker) {
  if (a.tier !== "paying") await record("handover", a, [a.email ? emailKey(a.email) : null]);
}

/** Drops rows older than the longest allowance window; called from the daily purge job. */
export async function pruneSupportUse(now = new Date()) {
  await db.supportUse.deleteMany({ where: { at: { lt: new Date(now.getTime() - 31 * DAY) } } });
}
