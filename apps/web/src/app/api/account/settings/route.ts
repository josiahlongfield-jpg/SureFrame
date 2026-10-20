import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ReminderRules } from "@/lib/scheduleSchema";
import { handle, HttpError, requireUser } from "@/lib/session";

const Body = z.object({
  /** null = use the business's defaults again. */
  reminderDefaults: ReminderRules.nullable().optional(),
  remindClientDefault: z.boolean().nullable().optional(),
  remindTeamDefault: z.boolean().nullable().optional(),
  /** Blank = use the business's. */
  reminderMessage: z.string().max(500).optional(),
  reminderReplyTo: z.union([z.string().trim().email().max(200), z.literal("")]).optional(),
  /** "Email me when my clients reply". */
  replyEmails: z.boolean().optional(),
});

/**
 * A staff member's own settings for the clients they look after: reminder
 * defaults, the message and reply-to on their clients' reminder emails, and
 * whether they're emailed about replies. Owners and admins set the business's
 * settings (To-dos/Reminders > Reminder settings) and their team emails (Team overview)
 * instead. Nothing here changes what owners and admins see or are sent.
 */
export const PATCH = handle(async (req: Request) => {
  const me = await requireUser();
  if (me.role !== "MEMBER") throw new HttpError(403, "Owners and admins change these on the Reminders and Team overview pages");
  const body = Body.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, body.error.issues[0]?.path.includes("reminderReplyTo") ? "Enter a valid reply-to email" : "Invalid settings");
  const d = body.data;
  const m = await db.membership.update({
    where: { userId_workspaceId: { userId: me.user.id, workspaceId: me.workspace.id } },
    data: {
      myReminderDefaults: d.reminderDefaults === undefined ? undefined : d.reminderDefaults === null ? Prisma.DbNull : d.reminderDefaults,
      myRemindClientDefault: d.remindClientDefault,
      myRemindTeamDefault: d.remindTeamDefault,
      myReminderMessage: d.reminderMessage === undefined ? undefined : d.reminderMessage.trim() || null,
      myReminderReplyTo: d.reminderReplyTo === undefined ? undefined : d.reminderReplyTo || null,
      replyNotify: d.replyEmails === undefined ? undefined : d.replyEmails ? "MINE" : "OFF",
    },
  });
  return Response.json({ ok: true, replyEmails: m.replyNotify !== "OFF" });
});
