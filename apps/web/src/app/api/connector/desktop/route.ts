import { z } from "zod";
import { appUrl } from "@/lib/appUrl";
import { db } from "@/lib/db";
import { makeDesktopGrant } from "@/lib/connector/grants";
import { requireCurrentKey } from "@/lib/keys";
import { limitByIp } from "@/lib/rateLimit";
import { handle, HttpError, requireUser } from "@/lib/session";

/** Most desktop connections one person can have in one team at once. */
const MAX_DESKTOP = 10;
const Body = z.object({ keyFingerprint: z.string().min(16).max(64) });

/**
 * A new desktop connection (Settings > Connections): its token, once. The browser adds the team key to make the
 * connection code, so the key never comes here; the fingerprint only checks the browser's key is the current one.
 */
export const POST = handle(async (req: Request) => {
  await limitByIp("connector-desktop", 20, 3600);
  const me = await requireUser();
  const body = Body.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, "Unlock this device with your recovery key first");
  if (!me.workspace.keyFingerprint) throw new HttpError(409, "Your team doesn't have its encryption key yet");
  await requireCurrentKey(me.workspace, body.data.keyFingerprint);
  const count = await db.connectorGrant.count({ where: { userId: me.user.id, workspaceId: me.workspace.id, kind: "desktop", revokedAt: null } });
  if (count >= MAX_DESKTOP) throw new HttpError(409, `You already have ${MAX_DESKTOP} desktop connections. Disconnect one you no longer use first.`);
  const { token } = await makeDesktopGrant(me.user.id, me.workspace.id);
  return Response.json({ token, site: appUrl() }, { headers: { "Cache-Control": "no-store" } });
});
