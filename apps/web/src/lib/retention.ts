import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

/** How long the server keeps an encrypted relay copy when cloud backup is off. */
const configuredDays = Number(process.env.RELAY_RETENTION_DAYS);
/** Days the server keeps a copy without cloud backup (a bad RELAY_RETENTION_DAYS falls back to 30). */
export const RETENTION_DAYS = Number.isInteger(configuredDays) && configuredDays > 0 ? configuredDays : 30;

export function purgeDate(cloudBackup: boolean, from = new Date()) {
  return cloudBackup ? null : new Date(from.getTime() + RETENTION_DAYS * 86_400_000);
}

/**
 * The server copies whose recorder (or, for a client's reply, whoever recorded the video it answers) gets the
 * 24-hour warning (lib/expiryWarning.ts), leaving dates aside: the team's own recordings and their clients' sent
 * video and voice replies (MAIL-8), not in a workspace that's backed up, closing, suspended, closed or on legal hold,
 * nor in a deleted client's conversation while that deletion finishes (lib/clientRemoval.ts).
 */
export const warnable: Prisma.VideoWhereInput = {
  status: { notIn: ["EXPIRED", "RECORDING"] },
  workspace: { cloudBackup: false, deleteAt: null, suspendedAt: null, closedAt: null, legalHoldAt: null },
  NOT: { client: { removedAt: { not: null } } },
  OR: [{ replyToId: null }, { asReply: { byClient: true, heldAt: null, video: { NOT: { client: { removedAt: { not: null } } } } } }],
};

/**
 * Kept in expiryWarnedAt (which otherwise says when the warning went) on a copy the purge held back a day because
 * its warning hadn't gone (MAIL-3). The warning job still sends one for it; the purge never holds it a second time.
 */
export const HELD_FOR_WARNING = new Date(0);

/**
 * Delete server copies whose window has passed. Nothing is kept on devices
 * unless someone saved it. Works through the backlog in batches until done or
 * out of time. Copies sent to several clients share one file, which is
 * deleted once, when every row using it is due; one file that fails to delete
 * is retried on the next run without holding up the rest. The video's
 * transcript and summary go with it.
 */
export async function purgeExpired(now = new Date(), budgetMs = 40_000) {
  const until = Date.now() + budgetMs;
  const failed = new Set<string>();
  let purged = 0;
  // Due, but its 24-hour warning never went (the jobs were paused for maintenance, a legal hold was just lifted, or
  // the email kept failing): kept one more day so the warning goes first (MAIL-3). Only once: one already held is
  // deleted on its new date, warned or not, so nothing stays more than a day past its date. Nothing else is held.
  await db.video.updateMany({
    where: { AND: [warnable, { purgeAt: { lte: now }, expiryWarnedAt: null }] },
    data: { purgeAt: new Date(now.getTime() + 86_400_000), expiryWarnedAt: HELD_FOR_WARNING },
  });
  while (Date.now() < until) {
    const due = await db.video.findMany({
      // Never a backed-up workspace's video, even if a stale date slipped through, nor one on legal hold
      // (lib/support/admin.ts): held videos are deleted on the first run after the hold is lifted.
      where: { purgeAt: { lte: now }, status: { notIn: ["EXPIRED", "RECORDING"] }, workspace: { cloudBackup: false, legalHoldAt: null }, id: { notIn: [...failed] } },
      select: { id: true, sourceId: true, storageKey: true },
      take: 200,
    });
    if (!due.length) break;
    const byKey = new Map<string, typeof due>();
    for (const v of due) byKey.set(v.storageKey, [...(byKey.get(v.storageKey) ?? []), v]);
    const groups = [...byKey];
    // A few at a time: each delete is a round trip to the bucket.
    for (let i = 0; i < groups.length; i += 8) {
      await Promise.all(
        groups.slice(i, i + 8).map(async ([key, rows]) => {
          const ids = rows.map((r) => r.id);
          try {
            // Looked at again just before deleting: cloud backup turned on, or a legal hold placed, since the list was
            // read keeps these. They're left for this run; whatever is still due is picked up by the next one.
            const still = await db.video.count({ where: { id: { in: ids }, purgeAt: { lte: now }, status: { notIn: ["EXPIRED", "RECORDING"] }, workspace: { cloudBackup: false, legalHoldAt: null } } });
            if (still !== ids.length) {
              for (const id of ids) failed.add(id);
              return;
            }
            // Another row still using this file and not yet due keeps it for now.
            const inUse = await db.video.count({ where: { storageKey: key, id: { notIn: ids }, status: { not: "EXPIRED" }, OR: [{ purgeAt: null }, { purgeAt: { gt: now } }] } });
            if (!inUse) await storage().delete(key);
            await db.video.updateMany({ where: { id: { in: ids } }, data: { status: "EXPIRED", playbackUrl: null, thumbnailUrl: null } });
            await db.videoInsight.deleteMany({ where: { videoId: { in: [...ids, ...rows.flatMap((r) => (r.sourceId ? [r.sourceId] : []))] } } });
            // The library still, which is a frame of the recording, goes with it.
            await db.videoThumb.deleteMany({ where: { videoId: { in: ids } } });
            purged += ids.length;
          } catch (err) {
            for (const id of ids) failed.add(id);
            console.error("[purge] couldn't delete", key, err);
          }
        }),
      );
    }
  }
  return purged;
}

/**
 * Rows nothing needs any more: sign-in links that have expired (they hold an
 * email address) and invites that ended over a month ago.
 */
export async function pruneLeftovers(now = new Date()) {
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  // A closed account's accepted invites say which teams closing it took them off (app/account/restore); kept until it's kept or deleted.
  const closed = (await db.user.findMany({ where: { deleteAt: { not: null } }, select: { id: true } })).map((u) => u.id);
  const [tokens, invites] = await Promise.all([
    db.verificationToken.deleteMany({ where: { expires: { lt: now } } }),
    // Kept while the workspace is on legal hold (lib/support/admin.ts).
    db.invite.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: monthAgo } }, { revokedAt: { lt: monthAgo } }, { acceptedAt: { lt: monthAgo } }],
        AND: [{ OR: [{ acceptedById: null }, { acceptedById: { notIn: closed } }] }],
        workspace: { legalHoldAt: null },
      },
    }),
  ]);
  return { tokens: tokens.count, invites: invites.count };
}

/**
 * Uploads that never finished (a recording abandoned for good) are aborted
 * after a week so their parts stop costing storage, and removed: an abandoned
 * reply would otherwise show up in the conversation, and an abandoned
 * recording in the library. Recovery after a crash normally happens the next
 * time the app is opened. The week runs from when the recording was last
 * touched: a piece arriving, or access coming back. Asking the server to
 * finish one it has nothing to finish from doesn't touch it (lib/pieces.ts
 * finishFromPieces), so a recording that can never be finished does get here.
 * `dropPieces` deletes what a removed recording still held in pieces
 * (lib/pieces.ts; handed in by the daily job, as that file builds on this one).
 */
export async function abortStaleUploads(now = new Date(), dropPieces?: (videoId: string) => Promise<unknown>) {
  const found = await db.video.findMany({
    where: {
      status: "RECORDING",
      updatedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) },
      // Not while the workspace is on legal hold (lib/support/admin.ts), nor while uploads are refused for a while
      // (suspended or closed, or the owner closed their account): the recording waits on the device until access comes
      // back, and the week starts again then.
      workspace: { legalHoldAt: null, suspendedAt: null, closedAt: null, deleteAt: null },
      owner: { suspendedAt: null },
    },
    include: { asReply: { select: { authorUser: { select: { suspendedAt: true } }, video: { select: { client: { select: { linkDisabledAt: true } } } } } } },
    take: 200,
  });
  // Nor a reply from a team member whose login is suspended, or from a client whose link support turned off.
  const stale = found.filter((v) => !v.asReply?.authorUser?.suspendedAt && !v.asReply?.video.client?.linkDisabledAt);
  for (const v of stale) {
    await storage().abort(v.storageKey, v.uploadId).catch(() => {});
    // Deleting a reply's media deletes its Reply row too (onDelete: Cascade).
    const removed = await db.video.delete({ where: { id: v.id } }).then(
      () => true,
      (err) => (console.error("[purge] couldn't remove stale upload", v.id, err), false),
    );
    // The pieces it still held (never joined into a part) go with it; any left over are swept up daily (lib/pieces.ts).
    if (removed) await dropPieces?.(v.id).catch((err) => console.error("[purge] couldn't remove a stale upload's pieces", v.id, err));
  }
  return stale.length;
}

/** Turning cloud backup on keeps everything; turning it off starts the clock again. */
export async function applyBackupSetting(workspaceId: string, cloudBackup: boolean) {
  await db.video.updateMany({
    where: { workspaceId, status: { not: "EXPIRED" } },
    // A new date means a new 24-hour warning when it comes round.
    data: { purgeAt: purgeDate(cloudBackup), expiryWarnedAt: null },
  });
}
