import { z } from "zod";
import { db } from "@/lib/db";
import { deleteClient } from "@/lib/clientRemoval";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";
import { rateLimit } from "@/lib/rateLimit";
import { accessOf, clientScopeWhere } from "@/lib/permissions";
import { NAME_MAX } from "@/lib/clients";

const Patch = z.object({
  name: z.string().trim().min(1).max(NAME_MAX).optional(),
  email: z.union([z.string().trim().email().max(200), z.literal("")]).optional(),
  /** Staff member who looks after this client; null puts them back in the shared list. */
  assignedToId: z.string().min(1).max(40).nullable().optional(),
});

/** Update a client's name or the email their reminders go to. */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const me = await requireUser();
  const { workspace } = me;
  const json = await req.json().catch(() => null);
  const body = Patch.safeParse(json);
  if (!body.success) {
    if (typeof json?.name === "string") {
      throw new HttpError(400, json.name.trim() ? `That name is too long. Names can be up to ${NAME_MAX} characters.` : "Enter a name");
    }
    throw new HttpError(400, "Enter a valid email address");
  }
  await rateLimit(`client-edit:${workspace.id}`, 30, 3600);
  if (body.data.assignedToId !== undefined) requireRole(me, "OWNER", "ADMIN");
  const scope = clientScopeWhere(accessOf(me));
  if (!(await db.client.findFirst({ where: { ...scope, id, removedAt: null }, select: { id: true } }))) throw new HttpError(404, "Client not found");
  // Two clients with one email would get each other's emails. Only name the other client if this person can see them.
  if (body.data.email) {
    const taken = await db.client.findFirst({ where: { workspaceId: workspace.id, removedAt: null, id: { not: id }, email: { equals: body.data.email, mode: "insensitive" } }, select: { id: true, name: true } });
    if (taken) {
      const visible = await db.client.count({ where: { ...scope, id: taken.id } });
      throw new HttpError(409, visible ? `${taken.name} already uses ${body.data.email}. Each client needs their own email.` : `Another client already uses ${body.data.email}. Each client needs their own email.`);
    }
  }
  if (body.data.assignedToId && !(await db.membership.findUnique({ where: { userId_workspaceId: { userId: body.data.assignedToId, workspaceId: workspace.id } } }))) {
    throw new HttpError(400, "That person isn't on your team");
  }
  const res = await db.client.updateMany({
    where: { ...scope, id, removedAt: null },
    data: { name: body.data.name, email: body.data.email === undefined ? undefined : body.data.email || null, assignedToId: body.data.assignedToId },
  });
  if (res.count === 0) throw new HttpError(404, "Client not found");
  return Response.json({ ok: true });
});

/**
 * Delete a client for good, now (lib/clientRemoval.ts): their link stops
 * working, their seat is freed, and everything about them is erased, with the
 * recordings sent only to them. They're emailed that their access has ended.
 */
export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const me = await requireUser();
  requireRole(me, "OWNER", "ADMIN");
  return Response.json(await deleteClient(me.workspace, id, me.user.id));
});
