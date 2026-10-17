import { db } from "@/lib/db";
import { handle, requireRole, requireUser } from "@/lib/session";

/** "I've saved it": the owner saved the recovery key, so it stops being shown as a reminder (and ticks the first step). */
export const POST = handle(async () => {
  const me = await requireUser();
  requireRole(me, "OWNER", "ADMIN");
  await db.workspace.updateMany({ where: { id: me.workspace.id, recoveryKeySavedAt: null }, data: { recoveryKeySavedAt: new Date() } });
  return Response.json({ ok: true });
});
