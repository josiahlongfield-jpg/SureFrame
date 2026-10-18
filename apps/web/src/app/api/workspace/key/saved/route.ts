import { db } from "@/lib/db";
import { handle, requireUser } from "@/lib/session";

/**
 * "I've saved it": this person saved the team's current recovery key, so it stops being shown as a reminder.
 * The owner's also ticks the first step. Everyone is asked again after a key reset (lib/rekey.ts).
 */
export const POST = handle(async () => {
  const me = await requireUser();
  const now = new Date();
  await db.membership.updateMany({ where: { id: me.membership.id }, data: { recoveryKeySavedAt: now } });
  if (me.role === "OWNER") await db.workspace.updateMany({ where: { id: me.workspace.id, recoveryKeySavedAt: null }, data: { recoveryKeySavedAt: now } });
  return Response.json({ ok: true });
});
