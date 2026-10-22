import { db } from "@/lib/db";
import { memberOrClient } from "@/lib/access";
import { rotationDTO } from "@/lib/keys";
import { handle } from "@/lib/session";

/**
 * How a client's device gets from an older client key to the current one.
 * Only the client themselves (with their current link) or the team.
 * `check` is one of their videos' keys, wrapped with their key (what every video page sends them anyway), so a
 * device can tell a mistyped link's key from the real one before saving it (lib/e2e/linkKey.ts).
 */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await memberOrClient(id);
  const [client, rotations, check] = await Promise.all([
    db.client.findUnique({ where: { id }, select: { keyFingerprint: true } }),
    db.keyRotation.findMany({ where: { clientId: id }, orderBy: { createdAt: "asc" } }),
    db.video.findFirst({ where: { clientId: id, clientKeyWrap: { not: null } }, orderBy: { createdAt: "desc" }, select: { clientKeyWrap: true } }),
  ]);
  return Response.json({ fingerprint: client?.keyFingerprint ?? null, rotations: rotations.map(rotationDTO), check: check?.clientKeyWrap ?? null });
});
