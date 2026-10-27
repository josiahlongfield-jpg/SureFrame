import type { Prisma } from "@prisma/client";
import { contactOf } from "@/lib/clientContact";
import { db, type Workspace } from "@/lib/db";
import { brandOf } from "@/lib/branding";
import { clientRemovedEmail } from "@/lib/clientRemovedEmail";
import { sendMail } from "@/lib/mail";
import { clientMailSettings } from "@/lib/reminders";
import { enforceSeatLimits } from "@/lib/seatLimits";
import { HttpError } from "@/lib/session";
import { storage } from "@/lib/storage";
import { appUrl } from "@/lib/stripe";

/**
 * Deleting a client (Josiah, 24 October 2026) is permanent and happens at once:
 * their link stops working, their seat is freed, and everything about them
 * (conversations, replies, reactions, to-dos, notes, reminders, key history,
 * and the recordings sent only to them) is erased. Nothing is kept so they can
 * be restored: if they come back they're added as a new client, with a new
 * personal link. Recordings also sent to other clients stay, without them.
 *
 * The client row is marked removed first (so they vanish everywhere straight
 * away), then purged. If that can't finish (files that won't delete yet, or a
 * legal hold), the clean-up job finishes it on its next run.
 */

/** Removed clients waiting to be purged. Nothing under legal hold (lib/support/admin.ts). */
const dueWhere = (): Prisma.ClientWhereInput => ({ removedAt: { not: null }, workspace: { legalHoldAt: null } });

const purgeLock = (clientId: string) => `client-purge:${clientId}`;

/** Recordings that are deleted with a client: those sent only to them, whose file nothing else uses. Plus how many of theirs stay. */
async function sentOnlyTo(clientId: string) {
  const tx = db;
  const pick = { id: true, sourceId: true, storageKey: true, status: true } as const;
  const convs = await tx.video.findMany({ where: { clientId, replyToId: null }, select: pick });
  const originals = convs.filter((v) => !v.sourceId).map((v) => v.id);
  const shared = originals.length
    ? await tx.video.findMany({ where: { sourceId: { in: originals }, OR: [{ clientId: null }, { clientId: { not: clientId } }] }, select: { sourceId: true } })
    : [];
  const keep = new Set(shared.map((s) => s.sourceId));
  const drop = convs.filter((v) => !keep.has(v.id));
  const dropIds = drop.map((v) => v.id);
  const only: string[] = [];
  for (const v of drop) {
    // A copy whose original stays (with the team or other clients) isn't lost: the recording is still there.
    if (await tx.video.count({ where: { storageKey: v.storageKey, id: { notIn: dropIds } } })) continue;
    only.push(v.id);
  }
  return { only, kept: convs.length - only.length };
}

/**
 * What deleting this client erases, for the "are you sure" box: the recordings
 * sent only to them (with what the browser needs to save each one first, opened
 * with the team key on the device) and how many of their recordings stay.
 */
export async function deletionPreview(workspace: Workspace, id: string, scope: Prisma.ClientWhereInput = {}) {
  const c = await db.client.findFirst({ where: { ...scope, id, workspaceId: workspace.id, removedAt: null }, select: { id: true, name: true, email: true, remindersOff: true } });
  if (!c) throw new HttpError(404, "Client not found");
  const { only, kept } = await sentOnlyTo(c.id);
  const videos = only.length
    ? await db.video.findMany({
        where: { id: { in: only } },
        select: { id: true, title: true, createdAt: true, mimeType: true, durationMs: true, encrypted: true, teamKeyWrap: true, status: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const [replies, items] = await Promise.all([
    db.reply.count({ where: { video: { clientId: c.id } } }),
    db.item.count({ where: { clientId: c.id } }),
  ]);
  return {
    client: { id: c.id, name: c.name, email: c.email },
    // Whether deleting them emails them that their access has ended (see goodbyeFor).
    willEmail: await willBeEmailed(workspace.id, c),
    videos: videos.map((v) => ({
      id: v.id,
      title: v.title,
      createdAt: v.createdAt.toISOString(),
      mimeType: v.mimeType,
      durationMs: v.durationMs,
      encrypted: v.encrypted,
      teamKeyWrap: v.teamKeyWrap,
      // Already gone from our servers (expired, or never finished): nothing to save.
      saveable: v.status === "UPLOADED" || v.status === "PROCESSING" || v.status === "READY",
      url: `/api/videos/${v.id}/stream`,
    })),
    kept,
    replies,
    items,
  };
}

/**
 * Deletes a client for good, now (owners and admins). The client is emailed
 * that their access has ended (in good faith, as Josiah asked), unless they
 * turned the business's emails off or another current client uses the same
 * address. Returns whether everything was erased straight away.
 */
export async function deleteClient(workspace: Workspace, id: string, actorId: string) {
  const c = await db.client.findFirst({ where: { id, workspaceId: workspace.id, removedAt: null } });
  if (!c) throw new HttpError(404, "Client not found");
  // Made now: the client row (and with it their name and email) is gone once purged.
  const goodbye = await goodbyeFor(workspace, c);
  const now = new Date();
  const res = await db.client.updateMany({ where: { id, workspaceId: workspace.id, removedAt: null }, data: { removedAt: now, purgeAt: now, removedById: actorId } });
  if (res.count === 0) throw new HttpError(404, "Client not found");
  // Sent before the slow part: the clean-up job never sends it, so a purge that times out mustn't lose it.
  if (goodbye) await sendMail(goodbye).catch((err) => console.error("client goodbye email failed", err));
  // Gone from the bell and queued team emails at once, even if the purge below has to wait (a legal hold, or files that won't delete yet).
  await Promise.all([db.notification.deleteMany({ where: { clientId: id } }), db.teamNotification.deleteMany({ where: { clientId: id, sentAt: null } })]).catch((err) =>
    console.error("[client-delete] couldn't clear notifications", err),
  );
  // A freed seat restores a paused client. The deletion has happened: neither of these can undo it, so neither fails it.
  await enforceSeatLimits(workspace.id).catch((err) => console.error("[client-delete] seat check failed", err));
  const result = await purgeClient(id).catch((err) => {
    console.error(JSON.stringify({ level: "error", message: "[client-delete] couldn't finish; the clean-up job retries", client: id, error: String(err) }));
    return "failed" as const;
  });
  return { deleted: result === "purged", emailed: !!goodbye };
}

/** Not when they turned the business's emails off, or someone else on the list uses the address (they haven't lost anything). */
async function willBeEmailed(workspaceId: string, c: { id: string; email: string | null; remindersOff: boolean }) {
  if (!c.email || c.remindersOff) return false;
  return !(await db.client.count({ where: { workspaceId, removedAt: null, id: { not: c.id }, email: { equals: c.email, mode: "insensitive" } } }));
}

/** The email telling a client their access has ended, or null when they aren't emailed. */
async function goodbyeFor(ws: Workspace, c: { id: string; name: string; email: string | null; remindersOff: boolean; assignedToId: string | null }) {
  if (!c.email || !(await willBeEmailed(ws.id, c))) return null;
  const assigned = c.assignedToId ? await db.membership.findUnique({ where: { userId_workspaceId: { userId: c.assignedToId, workspaceId: ws.id } } }) : null;
  const { replyTo } = clientMailSettings(ws, assigned);
  const brand = brandOf(ws, appUrl(""));
  const mail = clientRemovedEmail({ business: ws.name, clientName: c.name, logoUrl: brand.logoUrl, color: brand.color, noReply: !replyTo, contact: contactOf(ws) });
  return { to: c.email, ...mail, fromName: ws.name, replyTo };
}

/**
 * Delete one removed client for good (deleteClient, or the clean-up job when
 * that couldn't finish). Order matters: files first (a failure leaves everything for the next
 * run, rather than files nobody can find), then the rows, conversations
 * before the client (deleting the client alone would keep their
 * conversations as team-only videos).
 *
 * - Conversations with them (videos sent to them, and copies) and every reply
 *   in them, the team's included. Reply recordings aren't linked to their
 *   conversation, so they're deleted by hand.
 * - A recording also sent to other clients isn't deleted: it stays with the
 *   business and those clients, without this client's conversation.
 * - Their to-dos, notes, reminders and key history go with the client row.
 * - Staff reminders linking to them lose the link; queued team emails about them are dropped.
 * - The Free plan's count of videos recorded is never changed.
 */
export async function purgeClient(id: string): Promise<"purged" | "skipped" | "failed"> {
  return db.$transaction(
    async (tx) => {
      // Another run is on this client: leave it to them.
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${purgeLock(id)})) AS locked`;
      if (!locked) return "skipped";
      const client = await tx.client.findFirst({ where: { id, ...dueWhere() }, select: { id: true, workspaceId: true } });
      if (!client) return "skipped";

      // Their conversations, locked: a send to someone else (api/videos/[id]/send, which locks its original FOR UPDATE) waits,
      // so a copy made now isn't lost with its original. KEY SHARE, so a team key reset updating them doesn't wait on this.
      await tx.$queryRaw`SELECT id FROM "Video" WHERE "clientId" = ${id} AND "replyToId" IS NULL FOR KEY SHARE`;
      const pick = { id: true, sourceId: true, storageKey: true, uploadId: true, status: true } as const;
      const convs = await tx.video.findMany({ where: { clientId: id, replyToId: null }, select: pick });
      const originals = convs.filter((v) => !v.sourceId).map((v) => v.id);
      // Originals that other clients also have a copy of stay, as team-only recordings.
      const shared = originals.length
        ? await tx.video.findMany({ where: { sourceId: { in: originals }, OR: [{ clientId: null }, { clientId: { not: id } }] }, select: { sourceId: true } })
        : [];
      const keep = new Set(shared.map((s) => s.sourceId));
      const detach = convs.filter((v) => keep.has(v.id)).map((v) => v.id);
      const drop = convs.filter((v) => !keep.has(v.id));
      const media = convs.length ? await tx.video.findMany({ where: { replyToId: { in: convs.map((v) => v.id) } }, select: pick }) : [];
      const deleteIds = [...drop, ...media].map((v) => v.id);

      // Copies share their original's file. A file still used by a row that stays is kept.
      const files = new Map<string, (typeof media)[number]>();
      for (const v of [...drop.filter((d) => !d.sourceId), ...media]) {
        if (v.status === "EXPIRED" || files.has(v.storageKey)) continue;
        const inUse = await tx.video.count({ where: { storageKey: v.storageKey, id: { notIn: deleteIds }, status: { not: "EXPIRED" } } });
        if (!inUse) files.set(v.storageKey, v);
      }
      const list = [...files.values()];
      let failed = 0;
      for (let i = 0; i < list.length; i += 8) {
        const results = await Promise.allSettled(
          list.slice(i, i + 8).map((v) =>
            v.status === "RECORDING"
              ? // An unfinished upload may already be gone (aborted, or expired by the bucket): nothing to keep it for.
                storage().abort(v.storageKey, v.uploadId).catch((err) => console.error("[client-purge] couldn't abort upload", v.id, err))
              : storage().delete(v.storageKey),
          ),
        );
        failed += results.filter((r) => r.status === "rejected").length;
      }
      if (failed) {
        console.error(JSON.stringify({ level: "error", message: "[client-purge] couldn't delete files; retried next run", client: id, failed }));
        return "failed";
      }

      // Waits for a team key reset in progress, which re-seals every client and video, and makes the next one start after this.
      await tx.$queryRaw`SELECT 1 FROM "Workspace" WHERE id = ${client.workspaceId} FOR KEY SHARE`;
      if (detach.length) {
        await tx.reply.deleteMany({ where: { videoId: { in: detach } } });
        await tx.reaction.deleteMany({ where: { videoId: { in: detach } } });
        await tx.video.updateMany({ where: { id: { in: detach } }, data: { clientId: null, clientKeyWrap: null, message: null, sentAt: null, emailedAt: null, emailClientWhenReady: false, viewCount: 0 } });
      }
      // Replies, reactions, transcripts and upload parts go with their videos.
      if (deleteIds.length) await tx.video.deleteMany({ where: { id: { in: deleteIds } } });
      await tx.teamNotification.deleteMany({ where: { OR: [{ clientId: id }, { videoId: { in: [...deleteIds, ...detach] } }] } });
      // The bell's notifications that name them (lib/notifications.ts).
      await tx.notification.deleteMany({ where: { OR: [{ clientId: id }, { videoId: { in: [...deleteIds, ...detach] } }] } });
      // The label is the client's name or the video's title.
      const links = [`/clients/${id}`, ...drop.map((v) => `/v/${v.id}`)];
      await tx.staffNotice.updateMany({ where: { workspaceId: client.workspaceId, link: { in: links } }, data: { link: null, linkLabel: null } });
      // Bell items that only link to them (a staff reminder, a recording deleting soon) stay, opening the Library instead.
      await tx.notification.updateMany({ where: { workspaceId: client.workspaceId, href: { in: links } }, data: { href: "/library" } });
      // To-dos, notes, their reminders and key history go with the client.
      const gone = await tx.client.deleteMany({ where: { id, ...dueWhere() } });
      if (gone.count !== 1) throw new Error("client changed while being deleted");
      return "purged";
    },
    // Deleting files can take a while; a key reset in progress can hold the workspace for up to a minute.
    { timeout: 120_000, maxWait: 10_000 },
  );
}

/**
 * Finish deleting clients a deletion couldn't finish at once (and any removed
 * under the old 30-day rule). Runs from both cron jobs, within a time budget;
 * a client that fails is retried on the next run without holding up the rest.
 */
export async function purgeRemovedClients(budgetMs = 40_000) {
  const until = Date.now() + budgetMs;
  const tried = new Set<string>();
  let purged = 0;
  while (Date.now() < until) {
    const due = await db.client.findMany({ where: { ...dueWhere(), id: { notIn: [...tried] } }, select: { id: true }, orderBy: { removedAt: "asc" }, take: 20 });
    if (!due.length) break;
    for (const { id } of due) {
      if (Date.now() >= until) break;
      tried.add(id);
      const r = await purgeClient(id).catch((err) => {
        console.error(JSON.stringify({ level: "error", message: "[client-purge] failed; retried next run", client: id, error: String(err) }));
        return "failed" as const;
      });
      if (r === "purged") purged++;
    }
  }
  return purged;
}
