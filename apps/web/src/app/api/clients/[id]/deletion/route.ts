import { deletionPreview } from "@/lib/clientRemoval";
import { handle, requireRole, requireUser } from "@/lib/session";

/** What deleting this client would erase, for the "are you sure" box (owners and admins). */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const me = await requireUser();
  requireRole(me, "OWNER", "ADMIN");
  return Response.json(await deletionPreview(me.workspace, id));
});
