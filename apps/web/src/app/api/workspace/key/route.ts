import { z } from "zod";
import { db } from "@/lib/db";
import { handle, HttpError, requireUser } from "@/lib/session";

const Body = z.object({ fingerprint: z.string().min(16).max(64) });

/**
 * Register the team key's fingerprint the first time a device creates it.
 * The key itself never leaves the team's devices; the fingerprint only lets
 * other devices check they hold the right one.
 */
export const POST = handle(async (req: Request) => {
  const { workspace } = await requireUser();
  const body = Body.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, "Invalid fingerprint");
  if (workspace.keyFingerprint && workspace.keyFingerprint !== body.data.fingerprint) {
    throw new HttpError(409, "This business already has a different key. Enter your recovery key instead.");
  }
  if (!workspace.keyFingerprint) {
    const res = await db.workspace.updateMany({ where: { id: workspace.id, keyFingerprint: null }, data: { keyFingerprint: body.data.fingerprint } });
    if (res.count === 0) throw new HttpError(409, "Another device just set up this business's key. Enter your recovery key instead.");
  }
  return Response.json({ ok: true });
});
