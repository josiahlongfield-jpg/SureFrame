import crypto from "node:crypto";
import { Prisma, type Item, type Membership } from "@prisma/client";
import { db, type Workspace } from "@/lib/db";
import { appUrl } from "@/lib/stripe";
import { sendMail } from "@/lib/mail";
import { reminderEmail } from "@/lib/reminderEmail";
import { brandOf } from "@/lib/branding";
import { appSecret } from "@/lib/secrets";
import { rateLimit } from "@/lib/rateLimit";
import { clientTeam } from "@/lib/permissions";
import { DEFAULT_REMINDERS, isTimeZone, nextOccurrence, reminderTime, type ReminderRule } from "@/lib/schedule";
import { Repeat, ReminderRules } from "@/lib/scheduleSchema";
import { teamPath } from "@/lib/teamLink";
import { activeMember } from "@/lib/team";

export const workspaceTz = (w: Pick<Workspace, "timezone">) => w.timezone ?? "UTC";

/** Adopt the browser's time zone the first time a workspace schedules something. */
export async function ensureTimezone(workspaceId: string, tz?: string) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (ws.timezone || !tz || !isTimeZone(tz)) return workspaceTz(ws);
  await db.workspace.update({ where: { id: workspaceId }, data: { timezone: tz } });
  return tz;
}

export function workspaceReminderDefaults(w: Workspace) {
  const parsed = ReminderRules.safeParse(w.reminderDefaults);
  return {
    reminders: parsed.success ? parsed.data : DEFAULT_REMINDERS,
    remindClient: w.remindClientDefault,
    remindTeam: w.remindTeamDefault,
  };
}

type OwnSettings = Pick<Membership, "role" | "myReminderDefaults" | "myRemindClientDefault" | "myRemindTeamDefault" | "myReminderMessage" | "myReminderReplyTo">;

/**
 * What new to-dos start with for this person: a staff member's own defaults
 * (Settings > Reminders) where they set them, else the business's. Owners and
 * admins use the business's defaults.
 */
export function reminderDefaultsFor(w: Workspace, m?: OwnSettings | null) {
  const base = workspaceReminderDefaults(w);
  if (!m || m.role !== "MEMBER") return base;
  const own = ReminderRules.safeParse(m.myReminderDefaults);
  return {
    reminders: m.myReminderDefaults != null && own.success ? own.data : base.reminders,
    remindClient: m.myRemindClientDefault ?? base.remindClient,
    remindTeam: m.myRemindTeamDefault ?? base.remindTeam,
  };
}

/**
 * The message and reply-to address on emails to a client (reminders and new
 * videos): those of the staff member assigned to the client, where they set
 * their own, else the business's. Owners and admins use the business's.
 */
export function clientMailSettings(w: Pick<Workspace, "reminderMessage" | "reminderReplyTo">, assigned?: (OwnSettings & { pausedAt?: Date | null }) | null) {
  // A paused staff member can't answer, so their clients' emails go back to the business's settings.
  const own = assigned?.role === "MEMBER" && !assigned.pausedAt ? assigned : null;
  return { message: own?.myReminderMessage ?? w.reminderMessage, replyTo: own?.myReminderReplyTo ?? w.reminderReplyTo };
}

const rulesOf = (i: Item): ReminderRule[] => {
  const p = ReminderRules.safeParse(i.reminders);
  return p.success ? p.data : [];
};
const repeatOf = (i: Item) => {
  const p = Repeat.safeParse(i.repeat);
  return p.success ? p.data : null;
};

/** Replace an item's pending reminders with ones matching its current due date and rules. */
export async function scheduleReminders(item: Item, tz: string, now = new Date()) {
  await db.reminder.deleteMany({ where: { itemId: item.id, sentAt: null } });
  if (item.kind !== "TASK" || item.done || !item.dueAt) return;
  const targets: ("CLIENT" | "TEAM")[] = [];
  if (item.remindClient && item.shared && item.clientId) targets.push("CLIENT");
  if (item.remindTeam) targets.push("TEAM");
  if (!targets.length) return;
  const times = [...new Set(rulesOf(item).map((r) => reminderTime(item.dueAt!, r, tz).getTime()))].filter((t) => t > now.getTime());
  const rows = times.flatMap((t) => targets.map((to) => ({ itemId: item.id, sendAt: new Date(t), to })));
  if (rows.length) await db.reminder.createMany({ data: rows });
}

/**
 * Create the next occurrence of a repeating to-do (once per occurrence).
 * The encrypted text is copied as is; the server never needs to read it.
 */
export async function spawnNext(item: Item, tz: string) {
  const repeat = repeatOf(item);
  if (!repeat || !item.dueAt || item.spawnedNext) return null;
  const claimed = await db.item.updateMany({ where: { id: item.id, spawnedNext: false }, data: { spawnedNext: true } });
  if (claimed.count === 0) return null;
  // The next one still to come: a to-do missed for days (or ticked late) doesn't create a backlog of past ones.
  const now = new Date();
  let due = nextOccurrence(item.dueAt, repeat, tz);
  for (let i = 0; due && due <= now && i < 1000; i++) due = nextOccurrence(due, repeat, tz);
  if (!due) return null;
  const next = await db.item.create({
    data: {
      kind: item.kind,
      body: item.body,
      shared: item.shared,
      dueAt: due,
      repeat: item.repeat as Prisma.InputJsonValue,
      reminders: (item.reminders ?? undefined) as Prisma.InputJsonValue | undefined,
      remindClient: item.remindClient,
      remindTeam: item.remindTeam,
      seriesId: item.seriesId ?? item.id,
      authorName: item.authorName,
      workspaceId: item.workspaceId,
      clientId: item.clientId,
    },
  });
  await scheduleReminders(next, tz);
  return next;
}

// ---- Client opt-out links ----

const sign = (clientId: string) => crypto.createHmac("sha256", appSecret()).update(`reminders:${clientId}`).digest("base64url").slice(0, 22);
export const unsubscribeUrl = (clientId: string) => appUrl(`/reminders/off?c=${clientId}&s=${sign(clientId)}`);
export const validUnsubscribe = (clientId: string, sig: string) => {
  const a = Buffer.from(sign(clientId));
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** Run every few minutes: roll repeating to-dos forward and send reminders that are due. */
export async function runReminders(now = new Date()) {
  // A repeating to-do whose time has passed gets its next occurrence even if nobody ticked it.
  const overdue = await db.item.findMany({
    // Not for a client who has been removed: their to-dos stop with them.
    where: { spawnedNext: false, done: false, dueAt: { lte: now }, NOT: { repeat: { equals: Prisma.AnyNull } }, OR: [{ clientId: null }, { client: { removedAt: null } }] },
    include: { workspace: { select: { timezone: true } } },
    take: 500,
  });
  let spawned = 0;
  for (const i of overdue) if (await spawnNext(i, workspaceTz(i.workspace))) spawned++;

  const due = await db.reminder.findMany({
    // Nothing goes out while support has the workspace suspended (lib/support/admin.ts); the reminders stay unsent and
    // any more than an hour late by the time it's lifted are skipped below.
    where: { sentAt: null, sendAt: { lte: now }, item: { workspace: { suspendedAt: null, closedAt: null } } },
    include: {
      item: {
        include: {
          client: true,
          // Paused or suspended staff aren't sent anything; their clients' reminders go to the owner and admins.
          workspace: { include: { members: { where: activeMember, include: { user: { select: { email: true } } }, orderBy: { id: "asc" } } } },
        },
      },
    },
    orderBy: { sendAt: "asc" },
    take: 200,
  });

  let sent = 0;
  let skipped = 0;
  for (const r of due) {
    const { item } = r;
    const ws = item.workspace;
    const skip = async (why: string) => {
      skipped++;
      await db.reminder.update({ where: { id: r.id }, data: { sentAt: now, error: why } });
    };
    if (item.done) { await skip("done"); continue; }
    // The owner closed their account (lib/accountDeletion.ts): nothing goes out in the business's name.
    if (ws.deleteAt) { await skip("account closed"); continue; }
    if (item.client?.removedAt) { await skip("client removed"); continue; }
    if (!item.dueAt || item.dueAt.getTime() < now.getTime() - 3_600_000) { await skip("late"); continue; }

    const base = { business: ws.name, due: item.dueAt, now, tz: workspaceTz(ws) };
    // Clients' reminders come from "Business A via SureFrame"; the team's own from SureFrame (lib/mail.ts).
    const mails: { to: string; m: ReturnType<typeof reminderEmail>; replyTo?: string | null; fromName?: string }[] = [];
    if (r.to === "CLIENT") {
      const c = item.client;
      if (!c || c.removedAt || c.pausedAt || c.linkDisabledAt || c.remindersOff || !c.email || !item.shared) { await skip("client unavailable"); continue; }
      // The staff member looking after the client speaks for themselves when they've set their own message and reply-to.
      const own = clientMailSettings(ws, ws.members.find((m) => m.userId === c.assignedToId));
      mails.push({
        to: c.email,
        replyTo: own.replyTo,
        fromName: ws.name,
        m: reminderEmail({ ...base, ...brandOf(ws, appUrl("")), message: own.message, link: appUrl(`/c/${c.token}`), unsubscribe: unsubscribeUrl(c.id), noReply: !own.replyTo }),
      });
    } else {
      const link = appUrl(teamPath(item.clientId ? `/clients/${item.clientId}` : "/library", ws.id));
      // A client's to-do goes to the staff member looking after that client
      // (or, when nobody is, to those who can see unassigned clients); general
      // to-dos go to the whole team.
      for (const mem of item.client ? clientTeam(ws.members, item.client) : ws.members) {
        mails.push({ to: mem.user.email, m: reminderEmail({ ...base, link, team: true, clientName: item.client?.name }) });
      }
    }
    // A daily ceiling per business keeps reminders from being used to send bulk mail.
    try {
      await rateLimit(`reminder-mail:${ws.id}`, ws.plan === "FREE" ? 100 : 2000, 86_400);
    } catch {
      await skip("daily email limit");
      continue;
    }
    // Claim it first, so a run that overlaps this one can't send it again.
    const claimed = await db.reminder.updateMany({ where: { id: r.id, sentAt: null }, data: { sentAt: now } });
    if (claimed.count === 0) continue;
    const failed: string[] = [];
    let delivered = 0;
    for (const { to, m, replyTo, fromName } of mails) {
      try {
        await sendMail({ to, subject: m.subject, text: m.text, html: m.html, fromName, replyTo });
        delivered++;
      } catch (e) {
        failed.push(String(e).slice(0, 200));
      }
    }
    if (!mails.length || delivered > 0) {
      sent++;
      // Some went: don't resend to those who already have it.
      if (failed.length) await db.reminder.update({ where: { id: r.id }, data: { error: failed.join("; ").slice(0, 300) } });
    } else {
      // Nothing went: release it so the next run retries; record why.
      await db.reminder.update({ where: { id: r.id }, data: { sentAt: null, error: failed.join("; ").slice(0, 300) } });
    }
  }
  return { sent, skipped, spawned };
}
