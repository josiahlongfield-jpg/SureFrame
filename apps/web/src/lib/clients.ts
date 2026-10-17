import crypto from "node:crypto";
import { db } from "@/lib/db";
import { clientSeatLimit } from "@/lib/plans";
import { appUrl } from "@/lib/stripe";

/** Longest client name (the Clients page says so when one is too long). */
export const NAME_MAX = 80;

export const newClientToken = () => crypto.randomBytes(24).toString("base64url");

/** The link a client uses to open their videos. Optionally opens one video. */
export function clientLink(token: string, videoId?: string) {
  return appUrl(`/c/${token}${videoId ? `?v=${videoId}` : ""}`);
}

export async function seatUsage(
  workspace: { id: string; plan: Parameters<typeof clientSeatLimit>[0]["plan"]; extraClientSeats: number },
  client: Pick<typeof db, "client"> = db,
) {
  const used = await client.client.count({ where: { workspaceId: workspace.id, removedAt: null } });
  return { used, limit: clientSeatLimit(workspace) };
}
