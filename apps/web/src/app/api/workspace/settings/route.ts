import { z } from "zod";
import { isReservedBusinessName, RESERVED_BUSINESS_NAME } from "@/lib/brand";
import { db } from "@/lib/db";
import { scheduleReminders } from "@/lib/reminders";
import { isTimeZone } from "@/lib/schedule";
import { ReminderRules } from "@/lib/scheduleSchema";
import { ContactFields, contactOf, tidyContact } from "@/lib/clientContact";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";

/**
 * Whether choosing Email for a client should ask how clients can reach the business (MAIL-11, components/SendRoute.tsx):
 * for owners and admins while it has neither a reply-to email nor a contact line, so client emails don't go out with
 * no way to contact it. Nobody's sign-in email is ever used for this instead.
 */
export const GET = handle(async () => {
  const { role, workspace } = await requireUser();
  const askContact = (role === "OWNER" || role === "ADMIN") && !workspace.reminderReplyTo && !contactOf(workspace);
  return Response.json({ askContact });
});

const Body = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().max(64).refine(isTimeZone, "Unknown time zone").optional(),
  reminderDefaults: ReminderRules.optional(),
  remindClientDefault: z.boolean().optional(),
  remindTeamDefault: z.boolean().optional(),
  reminderMessage: z.string().max(500).optional(),
  reminderReplyTo: z.union([z.string().email().max(200), z.literal("")]).optional(),
  // The contact line clients see (Settings > Branding, lib/clientContact.ts). Blank clears it.
  ...ContactFields,
});

/** Business name, time zone (Settings > Account), client emails and contact line (Settings > Branding) and reminder settings. */
export const PATCH = handle(async (req: Request) => {
  const me = await requireUser();
  requireRole(me, "OWNER", "ADMIN");
  const { workspace } = me;
  const body = Body.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? "Invalid settings");
  const d = body.data;
  // A new name can't read as SureFrame itself (lib/brand.ts). One saved before this rule can be saved again unchanged.
  if (d.name !== undefined && d.name !== workspace.name && isReservedBusinessName(d.name)) throw new HttpError(400, RESERVED_BUSINESS_NAME);
  const updated = await db.workspace.update({
    where: { id: workspace.id },
    data: {
      name: d.name,
      timezone: d.timezone,
      reminderDefaults: d.reminderDefaults,
      remindClientDefault: d.remindClientDefault,
      remindTeamDefault: d.remindTeamDefault,
      reminderMessage: d.reminderMessage === undefined ? undefined : d.reminderMessage.trim() || null,
      reminderReplyTo: d.reminderReplyTo === undefined ? undefined : d.reminderReplyTo || null,
      contactEmail: tidyContact(d.contactEmail),
      contactPhone: tidyContact(d.contactPhone),
    },
  });
  // A new time zone moves every upcoming reminder to the right local time.
  if (d.timezone && d.timezone !== workspace.timezone) {
    const open = await db.item.findMany({ where: { workspaceId: workspace.id, done: false, dueAt: { gt: new Date() } } });
    for (const item of open) await scheduleReminders(item, d.timezone);
  }
  return Response.json({ ok: true, name: updated.name, contactEmail: updated.contactEmail, contactPhone: updated.contactPhone });
});
