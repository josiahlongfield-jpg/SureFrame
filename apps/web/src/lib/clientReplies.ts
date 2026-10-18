import { db } from "@/lib/db";
import { visibleReplies } from "@/lib/replies";
import type { Conv } from "@/components/LibraryTools";

/**
 * Each client's conversations with when the client's replies came, newest
 * first, for the reply badges on the Clients page and a client's page (the
 * library's own badges count the same way: the team's replies aren't news).
 */
export async function clientConvs(clientIds: string[]): Promise<Map<string, Conv[]>> {
  const out = new Map<string, Conv[]>();
  if (!clientIds.length) return out;
  const replies = await db.reply.findMany({
    where: { authorUserId: null, ...visibleReplies, video: { clientId: { in: clientIds } } },
    orderBy: { createdAt: "desc" },
    select: { videoId: true, createdAt: true, video: { select: { clientId: true } } },
  });
  for (const r of replies) {
    const clientId = r.video.clientId!;
    const convs = out.get(clientId) ?? [];
    let conv = convs.find((c) => c.id === r.videoId);
    if (!conv) convs.push((conv = { id: r.videoId, fromClient: [] }));
    conv.fromClient.push(r.createdAt.toISOString());
    out.set(clientId, convs);
  }
  return out;
}
