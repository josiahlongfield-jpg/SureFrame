import { db } from "@/lib/db";
import { handle, requireRole, requireUser } from "@/lib/session";

/** Hides the owner's first-steps checklist before it's finished (components/FirstSteps.tsx). */
export const POST = handle(async () => {
  const me = await requireUser();
  requireRole(me, "OWNER");
  await db.workspace.update({ where: { id: me.workspace.id }, data: { firstStepsHiddenAt: new Date() } });
  return Response.json({ ok: true });
});
