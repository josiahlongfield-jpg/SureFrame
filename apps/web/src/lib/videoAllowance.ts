import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { BRAND } from "@/lib/brand";
import { hasAgreed, noticePeriod } from "@/lib/terms";

/** The Terms version that brought the 25-in-total rule (versions are dates, so later ones sort after it). */
const FREE_TOTAL_SINCE = "2026-10-11";

/**
 * Until the 25-in-total rule takes effect for the workspace's owner (the notice period of the Terms that brought it,
 * lib/terms.ts), the Free plan counts the original videos it has now, as it did before: deleting one frees a place.
 * An owner who agreed to that version or a later one is under it, even during a newer version's notice period.
 */
async function underOldFreeRule(workspaceId: string) {
  const owner = await db.membership.findFirst({ where: { workspaceId, role: "OWNER" }, select: { user: { select: { id: true, createdAt: true } } } });
  if (!owner || (await hasAgreed(owner.user.id))) return false;
  if (await db.termsAcceptance.count({ where: { userId: owner.user.id, termsVersion: { gte: FREE_TOTAL_SINCE } } })) return false;
  return !!(await noticePeriod(owner.user));
}

/**
 * How many of the Free plan's videos a workspace has used: every original
 * recording that finished uploading, on any plan (deleted and expired ones
 * too), plus the ones still uploading, which hold a place until they finish
 * or are deleted. Replies and copies sent to more clients don't count.
 */
export async function videosUsed(workspaceId: string, tx: Prisma.TransactionClient | typeof db = db) {
  // One statement is one snapshot, so a finishing upload (status flip and count in one transaction) is seen whole or not at all.
  const [r] = await tx.$queryRaw<{ recorded: number; uploading: number }[]>`
    SELECT w."videosRecorded" AS recorded,
      (SELECT count(*)::int FROM "Video" v
        WHERE v."workspaceId" = w.id AND v.status = 'RECORDING' AND v."replyToId" IS NULL AND v."sourceId" IS NULL) AS uploading
    FROM "Workspace" w WHERE w.id = ${workspaceId}`;
  const recorded = r?.recorded ?? 0;
  const uploading = r?.uploading ?? 0;
  // videosRecorded keeps counting meanwhile, so the new rule applies from the day it takes effect.
  if (await underOldFreeRule(workspaceId)) {
    const kept = await tx.video.count({ where: { workspaceId, replyToId: null, sourceId: null } });
    return { recorded, uploading, used: kept, oldRule: true };
  }
  return { recorded, uploading, used: recorded + uploading, oldRule: false };
}

/** Why a new recording was refused on a plan with a lifetime limit. */
export function videoLimitMessage(planName: string, limit: number, uploading: number, oldRule = false) {
  if (oldRule) return `The ${planName} plan allows ${limit} videos. Delete one or upgrade to record more.`;
  const base = `The ${planName} plan includes ${limit} videos in total and you've used them all. Deleted videos still count. Upgrade to record more.`;
  return uploading ? `${base} ${uploadingHint(uploading)}` : base;
}

/** Recordings still uploading hold places: how to finish them, or free the places. */
export function uploadingHint(uploading: number) {
  const one = uploading === 1;
  return (
    (one ? "One of them is a recording that hasn't finished uploading." : `${uploading} of them are recordings that haven't finished uploading.`) +
    ` Open ${BRAND.name} in the browser you recorded ${one ? "it" : "them"} in so ${one ? "it" : "they"} can finish, or delete ${one ? "it" : "them"} from your library to free ${one ? "its place" : "those places"}.`
  );
}
