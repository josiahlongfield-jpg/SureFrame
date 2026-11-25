import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { memberOrClient } from "@/lib/access";
import { KeyFingerprint, requireCurrentKey } from "@/lib/keys";
import { itemDTO } from "@/lib/items";
import { ensureTimezone, scheduleReminders, spawnNext, workspaceTz } from "@/lib/reminders";
import { Repeat, ReminderRules } from "@/lib/scheduleSchema";
import { handle, HttpError } from "@/lib/session";

const Patch = z.object({
  done: z.boolean().optional(),
  // Changing text or sharing sends a freshly encrypted body (sealed with the right key), checked as in api/items.
  body: z.string().min(38).max(20000).regex(/^[A-Za-z0-9_-]+$/).optional(),
  shared: z.boolean().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  repeat: Repeat.nullable().optional(),
  reminders: ReminderRules.optional(),
  remindClient: z.boolean().optional(),
  remindTeam: z.boolean().optional(),
  tz: z.string().max(64).optional(),
  keyFingerprint: KeyFingerprint,
});

async function load(id: string) {
  const item = await db.item.findUnique({ where: { id } });
  if (!item) throw new HttpError(404, "Not found");
  const who = await memberOrClient(item.clientId);
  if (who.workspaceId !== item.workspaceId) throw new HttpError(404, "Not found");
  if (who.kind === "client" && !item.shared) throw new HttpError(404, "Not found");
  return { item, who };
}

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { item, who } = await load(id);
  const body = Patch.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, "Invalid update");
  const d = body.data;
  if (who.kind === "client") {
    // Clients can only tick off tasks shared with them.
    const { done, ...rest } = d;
    if (item.kind !== "TASK" || done === undefined || Object.values(rest).some((v) => v !== undefined)) {
      throw new HttpError(403, "Not allowed");
    }
  }
  if (d.shared && !item.clientId) throw new HttpError(400, "Only client items can be shared");
  if (d.body !== undefined) await requireCurrentKey(item.workspaceId, d.keyFingerprint);
  if (d.shared !== undefined && d.shared !== item.shared && d.body === undefined) {
    throw new HttpError(400, "Sharing changes which key seals the text; send the re-encrypted body");
  }
  const shared = d.shared ?? item.shared;
  const dueAt = d.dueAt === undefined ? item.dueAt : d.dueAt ? new Date(d.dueAt) : null;
  const scheduled = item.kind === "TASK" && !!dueAt;
  // Edits often resend the date and rule unchanged; only a real change restarts the series.
  const dateChanged = d.dueAt !== undefined && (dueAt?.getTime() ?? null) !== (item.dueAt?.getTime() ?? null);
  const ruleChanged = d.repeat !== undefined && JSON.stringify(d.repeat ?? null) !== JSON.stringify(item.repeat ?? null);
  const restart = dateChanged || ruleChanged;
  if (restart && item.spawnedNext && item.dueAt) {
    // The next occurrence was made from the old date or rule; it is made again from the new one.
    await db.item.deleteMany({ where: { seriesId: item.seriesId ?? item.id, done: false, dueAt: { gt: item.dueAt }, NOT: { id: item.id } } });
  }
  const updated = await db.item.update({
    where: { id },
    data: {
      done: d.done,
      body: d.body,
      shared: d.shared,
      dueAt: d.dueAt === undefined ? undefined : dueAt,
      repeat: !scheduled ? Prisma.DbNull : d.repeat === undefined ? undefined : d.repeat ?? Prisma.DbNull,
      reminders: d.reminders === undefined ? undefined : d.reminders.length ? d.reminders : Prisma.DbNull,
      remindClient: d.remindClient === undefined && d.shared === undefined ? undefined : shared && (d.remindClient ?? item.remindClient),
      remindTeam: d.remindTeam,
      // A changed date or rule starts the repeat afresh from this occurrence.
      spawnedNext: restart ? false : undefined,
    },
  });
  const tz = await ensureTimezone(item.workspaceId, d.tz);
  await scheduleReminders(updated, tz);
  const next = d.done === true ? await spawnNext(updated, tz) : null;
  return Response.json({ item: itemDTO(updated), next: next ? itemDTO(next) : null });
});

export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { item, who } = await load(id);
  if (who.kind !== "member") throw new HttpError(403, "Not allowed");
  // Deleting one occurrence of a repeating to-do skips it: the series carries on.
  if (item.repeat && !item.done) {
    const ws = await db.workspace.findUniqueOrThrow({ where: { id: item.workspaceId }, select: { timezone: true } });
    await spawnNext(item, workspaceTz(ws));
  }
  await db.item.delete({ where: { id } });
  return new Response(null, { status: 204 });
});
