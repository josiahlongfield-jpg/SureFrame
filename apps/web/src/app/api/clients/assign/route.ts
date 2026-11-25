import { z } from "zod";
import { db } from "@/lib/db";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";
import { MANY_CHANGES, rateLimit } from "@/lib/rateLimit";

const Body = z.object({
  clientIds: z.array(z.string().min(1).max(40)).min(1).max(500),
  /** Staff member to look after them; null puts them in the shared list. */
  assignedToId: z.string().min(1).max(40).nullable(),
});

/** Owners and admins: assign several clients at once (Team overview). */
export const POST = handle(async (req: Request) => {
  const me = await requireUser();
  requireRole(me, "OWNER", "ADMIN");
  const body = Body.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, "Choose clients and who looks after them");
  const { workspace } = me;
  if (body.data.assignedToId && !(await db.membership.findUnique({ where: { userId_workspaceId: { userId: body.data.assignedToId, workspaceId: workspace.id } } }))) {
    throw new HttpError(400, "That person isn't on your team");
  }
  await rateLimit(`client-assign:${workspace.id}`, 60, 3600, MANY_CHANGES);
  const res = await db.client.updateMany({
    where: { id: { in: body.data.clientIds }, workspaceId: workspace.id, removedAt: null },
    data: { assignedToId: body.data.assignedToId },
  });
  return Response.json({ updated: res.count });
});
