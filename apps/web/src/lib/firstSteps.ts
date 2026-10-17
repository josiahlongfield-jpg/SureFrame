import { cache } from "react";
import { db, type Workspace } from "@/lib/db";
import { isPlaceholderName } from "@/lib/team";

export type FirstStepsState = { key: boolean; name: boolean; client: boolean; video: boolean };

/**
 * A new owner's first steps, ticked off from what's really there: the
 * recovery key saved, a business name, a client, a video sent to one. Null
 * once they're all done, when the owner hid the list, and for staff. Once
 * per request (the header and the library both ask).
 */
const stepsOf = cache(async (workspaceId: string): Promise<FirstStepsState | null> => {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, recoveryKeySavedAt: true, firstStepsHiddenAt: true } });
  if (!ws || ws.firstStepsHiddenAt) return null;
  const [clients, sent] = await Promise.all([
    db.client.count({ where: { workspaceId } }),
    db.video.count({ where: { workspaceId, clientId: { not: null } } }),
  ]);
  const steps = { key: !!ws.recoveryKeySavedAt, name: !isPlaceholderName(ws.name), client: clients > 0, video: sent > 0 };
  return Object.values(steps).every(Boolean) ? null : steps;
});

export const firstStepsFor = (me: { role: string; workspace: Pick<Workspace, "id"> }) => (me.role === "OWNER" ? stepsOf(me.workspace.id) : Promise.resolve(null));
