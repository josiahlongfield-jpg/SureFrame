import type { Prisma } from "@prisma/client";
import { contactOf } from "@/lib/clientContact";
import { db, type Workspace } from "@/lib/db";
import { BRAND } from "@/lib/brand";
import { brandOf } from "@/lib/branding";
import { clientLink, newClientToken, seatUsage } from "@/lib/clients";
import { clientRemovedEmail } from "@/lib/clientRemovedEmail";
import { zoned } from "@/lib/dates";
import { sendMail } from "@/lib/mail";
import { notify } from "@/lib/notifications";
import { newLinkEmail } from "@/lib/newLinkEmail";
import { rateLimit } from "@/lib/rateLimit";
import { clientMailSettings } from "@/lib/reminders";
import { markReplacedEmailed, recordReplaced } from "@/lib/replacedLinks";
import { enforceSeatLimits } from "@/lib/seatLimits";
import { HttpError } from "@/lib/session";
import { storage } from "@/lib/storage";
import { appUrl } from "@/lib/stripe";
import { teamEmail } from "@/lib/teamEmail";
import { teamPath } from "@/lib/teamLink";
import { activeMember } from "@/lib/team";
import { CLIENT_KEEP_DAYS, CLIENT_PURGE_WARN_DAYS } from "@/lib/periods";

/**
 * Removing a client stops their link and frees their seat at once. Everything
 * about them (details, conversations, to-dos, notes, key history) is kept for
 * CLIENT_KEEP_DAYS so the business can restore them, then deleted for good,
 * cloud backup or not. The business is warned a few days before.
 */
export { CLIENT_KEEP_DAYS };
/** How far ahead of the deletion the business is warned. */
export const CLIENT_PURGE_WARN_MS = CLIENT_PURGE_WARN_DAYS * 86_400_000;
export const clientPurgeDate = (from = new Date()) => new Date(from.getTime() + CLIENT_KEEP_DAYS * 86_400_000);

/** Removed clients due to be deleted. Never one without a date, and nothing under legal hold (lib/support/admin.ts). */
const dueWhere = (now: Date): Prisma.ClientWhereInput => ({ removedAt: { not: null }, purgeAt: { not: null, lte: now }, workspace: { legalHoldAt: null } });
/** Workspaces whose owner is told about removed clients' deletion: not closed (lib/accountDeletion.ts), suspended or held. */
const tellable = { deleteAt: null, suspendedAt: null, closedAt: null, legalHoldAt: null } satisfies Prisma.WorkspaceWhereInput;
/** Removed clients that can still be restored (a date not yet reached, or not dated yet). */
export const restorableWhere = (now = new Date()): Prisma.ClientWhereInput => ({ removedAt: { not: null }, OR: [{ purgeAt: null }, { purgeAt: { gt: now } }] });

const purgeLock = (clientId: string) => `client-purge:${clientId}`;
const tzFooter = (ws: Pick<Workspace, "timezone">, zone: string) =>
  ws.timezone ? `Times are in your business's time zone (${zone}).` : "Times are in UTC. Set your time zone on the To-dos/Reminders page, under Reminder settings.";

/** Tells a client the business ended their access (only when the business ticked the box). Returns whether it went out. */
export async function emailClientRemoved(clientId: string) {
  const c = await db.client.findUnique({ where: { id: clientId }, include: { workspace: true } });
  if (!c?.email || !c.removedAt || !c.purgeAt) return false;
  // A duplicate removed while another client still uses this email: that person hasn't lost anything.
  if (await db.client.count({ where: { workspaceId: c.workspaceId, removedAt: null, email: { equals: c.email, mode: "insensitive" } } })) return false;
  // Once a day at most, so removing and restoring can't be used to flood someone.
  if (!(await rateLimit(`client-removed-mail:${c.id}`, 1, 86_400).then(() => true, () => false))) return false;
  const ws = c.workspace;
  const assigned = c.assignedToId ? await db.membership.findUnique({ where: { userId_workspaceId: { userId: c.assignedToId, workspaceId: ws.id } } }) : null;
  const { replyTo } = clientMailSettings(ws, assigned);
  const brand = brandOf(ws, appUrl(""));
  const mail = clientRemovedEmail({ business: ws.name, clientName: c.name, until: zoned(ws.timezone).longDay(c.purgeAt), logoUrl: brand.logoUrl, color: brand.color, noReply: !replyTo, contact: contactOf(ws) });
  try {
    await sendMail({ to: c.email, ...mail, fromName: ws.name, replyTo });
    return true;
  } catch (err) {
    console.error("client removed email failed", err);
    return false;
  }
}

/**
 * Bring a removed client back (owners and admins, or support). Uses a seat
 * like adding a client. If the team's keys were reset while they were away,
 * their old link may be known to someone who left, so they get a new one
 * (emailed when they have an address).
 */
export async function restoreClient(workspace: Workspace, id: string, { ignoreSeatLimit = false } = {}) {
  const now = new Date();
  const { rekeyed } = await db.$transaction(async (tx) => {
    // The same lock as adding a client, so two at once can't both take the last seat.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"clients:" + workspace.id}))`;
    // A client being deleted right now can't be restored; holding this stops a deletion starting meanwhile.
    const [{ free }] = await tx.$queryRaw<{ free: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${purgeLock(id)})) AS free`;
    const c = await tx.client.findFirst({ where: { id, workspaceId: workspace.id } });
    if (c && !c.removedAt) throw new HttpError(409, "This client hasn't been removed");
    if (!c || !free || (c.purgeAt && c.purgeAt <= now)) throw new HttpError(404, "This client has already been deleted");
    // Restoring a duplicate would put the same person on the list twice.
    const twin = c.email
      ? await tx.client.findFirst({ where: { workspaceId: workspace.id, removedAt: null, email: { equals: c.email, mode: "insensitive" } }, select: { name: true } })
      : null;
    if (twin) throw new HttpError(409, `${twin.name} already uses ${c.email}, so ${c.name} can't be restored as well. Change or remove that client first.`);
    if (!ignoreSeatLimit) {
      const seats = await seatUsage(workspace, tx);
      if (seats.used >= seats.limit) throw new HttpError(402, `All ${seats.limit} client seats are in use. Add seats or remove a client first.`);
    }
    // A team key reset (someone left) after they were removed didn't change their link.
    const rekeyed = (await tx.keyRotation.count({ where: { workspaceId: workspace.id, clientId: null, createdAt: { gt: c.removedAt! } } })) > 0;
    await tx.client.update({
      where: { id },
      data: { removedAt: null, purgeAt: null, purgeWarnedAt: null, removedById: null, pausedAt: null, ...(rekeyed ? { token: newClientToken() } : {}) },
    });
    // The old link then says it was replaced (marked emailed below once the new one has gone).
    if (rekeyed) await recordReplaced(tx, id, c.token, false);
    return { rekeyed };
  });
  // Normally a no-op (there was a free seat); with the limit ignored, the newest clients over it are paused.
  await enforceSeatLimits(workspace.id);
  const c = await db.client.findUniqueOrThrow({ where: { id }, include: { _count: { select: { videos: true } } } });
  let emailed = false;
  // Not to a client whose link support turned off, or while the business's account is suspended (lib/support/admin.ts).
  if (rekeyed && c.email && !c.pausedAt && !c.linkDisabledAt && !workspace.suspendedAt && !workspace.closedAt) {
    const brand = brandOf(workspace, appUrl(""));
    const assigned = c.assignedToId ? await db.membership.findUnique({ where: { userId_workspaceId: { userId: c.assignedToId, workspaceId: workspace.id } } }) : null;
    const { replyTo } = clientMailSettings(workspace, assigned);
    const mail = newLinkEmail({ business: workspace.name, clientName: c.name, link: clientLink(c.token), logoUrl: brand.logoUrl, color: brand.color, contact: contactOf(workspace) });
    emailed = await sendMail({ to: c.email, ...mail, fromName: workspace.name, replyTo }).then(
      async () => {
        await markReplacedEmailed(c.id).catch(() => {});
        return true;
      },
      (err) => {
        console.error("restored client new link email failed", err);
        return false;
      },
    );
  }
  return {
    client: {
      id: c.id,
      name: c.name,
      email: c.email,
      link: clientLink(c.token),
      teamKeyWrap: c.teamKeyWrap,
      videoCount: c._count.videos,
      assignedToId: c.assignedToId,
      paused: !!c.pausedAt,
      linkOff: !!c.linkDisabledAt,
      reached: !!c.linkOpenedAt,
    },
    seats: await seatUsage(workspace),
    newLink: rekeyed,
    emailed,
  };
}

/**
 * Delete one removed client for good, if they're due and nobody is restoring
 * them. Order matters: files first (a failure leaves everything for the next
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
export async function purgeClient(id: string, now = new Date()): Promise<"purged" | "skipped" | "failed"> {
  return db.$transaction(
    async (tx) => {
      // Another run (or a restore) is on this client: leave it to them.
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${purgeLock(id)})) AS locked`;
      if (!locked) return "skipped";
      const client = await tx.client.findFirst({ where: { id, ...dueWhere(now) }, select: { id: true, workspaceId: true } });
      if (!client) return "skipped";

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
        await tx.video.updateMany({ where: { id: { in: detach } }, data: { clientId: null, clientKeyWrap: null, sentAt: null, emailedAt: null, emailClientWhenReady: false, viewCount: 0 } });
      }
      // Replies, reactions, transcripts and upload parts go with their videos.
      if (deleteIds.length) await tx.video.deleteMany({ where: { id: { in: deleteIds } } });
      await tx.teamNotification.deleteMany({ where: { OR: [{ clientId: id }, { videoId: { in: [...deleteIds, ...detach] } }] } });
      // The bell's notifications that name them (lib/notifications.ts).
      await tx.notification.deleteMany({ where: { OR: [{ clientId: id }, { videoId: { in: [...deleteIds, ...detach] } }] } });
      // The label is the client's name or the video's title.
      await tx.staffNotice.updateMany({
        where: { workspaceId: client.workspaceId, link: { in: [`/clients/${id}`, ...drop.map((v) => `/v/${v.id}`)] } },
        data: { link: null, linkLabel: null },
      });
      // To-dos, notes, their reminders and key history go with the client.
      const gone = await tx.client.deleteMany({ where: { id, ...dueWhere(now) } });
      if (gone.count !== 1) throw new Error("client changed while being deleted");
      return "purged";
    },
    // Deleting files can take a while; a key reset in progress can hold the workspace for up to a minute.
    { timeout: 120_000, maxWait: 10_000 },
  );
}

/**
 * Delete removed clients whose 30 days are up. Runs from both cron jobs,
 * within a time budget; a client that fails is retried on the next run
 * without holding up the rest.
 */
export async function purgeRemovedClients(now = new Date(), budgetMs = 40_000) {
  await datePendingRemovals(now).catch((err) =>
    console.error(JSON.stringify({ level: "error", message: "[client-purge] dating earlier removals failed", error: String(err) })),
  );
  const until = Date.now() + budgetMs;
  const tried = new Set<string>();
  let purged = 0;
  while (Date.now() < until) {
    const due = await db.client.findMany({ where: { ...dueWhere(now), id: { notIn: [...tried] } }, select: { id: true }, orderBy: { purgeAt: "asc" }, take: 20 });
    if (!due.length) break;
    for (const { id } of due) {
      if (Date.now() >= until) break;
      tried.add(id);
      const r = await purgeClient(id, now).catch((err) => {
        console.error(JSON.stringify({ level: "error", message: "[client-purge] failed; retried next run", client: id, error: String(err) }));
        return "failed" as const;
      });
      if (r === "purged") purged++;
    }
  }
  return purged;
}

/**
 * Clients removed before removals were kept for 30 days (or by an older
 * version of the app during a deploy) have no deletion date. They get one,
 * 30 days from now, and the owner gets one email per workspace saying so.
 * The date is only set once that email has gone out; if it can't be sent, or
 * the run stops part way, they're left undated and tried again next run:
 * nobody's clients are dated without the owner being told.
 */
export async function datePendingRemovals(now = new Date()) {
  // Not while the owner's account is closed (lib/accountDeletion.ts): they go with it, or are dated once it's kept.
  // Nor while support has it suspended or on legal hold: dated once that ends.
  const pending = { removedAt: { not: null }, purgeAt: null } satisfies Prisma.ClientWhereInput;
  const workspaces = await db.client.findMany({ where: { ...pending, workspace: tellable }, select: { workspaceId: true }, distinct: ["workspaceId"] });
  let dated = 0;
  for (const { workspaceId } of workspaces) {
    const stamp = clientPurgeDate(now);
    // A claim of our own (purgeWarnedAt, unused while there's no date), so a run overlapping this one can't announce the same
    // clients. A claim left by a run that stopped part way is taken over after 10 minutes.
    const claim = new Date(now.getTime() + Math.floor(Math.random() * 60_000));
    const ids: string[] = [];
    try {
      await db.client.updateMany({
        where: { ...pending, workspaceId, workspace: tellable, OR: [{ purgeWarnedAt: null }, { purgeWarnedAt: { lt: new Date(Date.now() - 600_000) } }] },
        data: { purgeWarnedAt: claim },
      });
      const clients = await db.client.findMany({
        where: { ...pending, workspaceId, purgeWarnedAt: claim },
        select: { id: true, name: true, removedAt: true },
        orderBy: { removedAt: "asc" },
      });
      if (!clients.length) continue;
      ids.push(...clients.map((c) => c.id));
      const [ws, owner] = await Promise.all([
        db.workspace.findUnique({ where: { id: workspaceId } }),
        db.membership.findFirst({ where: { workspaceId, role: "OWNER", ...activeMember }, include: { user: { select: { email: true } } } }),
      ]);
      if (!ws || !owner) throw new Error("no owner to tell");
      const dates = zoned(ws.timezone);
      const brand = brandOf(ws, appUrl(""));
      const n = clients.length;
      const mail = teamEmail({
        business: ws.name,
        subject: "Removed clients are now deleted after 30 days",
        lead:
          `Clients you remove from ${BRAND.name} are now kept for 30 days, so you can restore them if you change your mind, and then deleted for good ` +
          `with their videos, conversations, to-dos and notes, even with cloud backup on. ` +
          (n === 1 ? "This also applies to the client you removed earlier, listed below with their date." : `This also applies to the ${n} clients you removed earlier, listed below with their dates.`),
        lines: clients.map((c) => ({ text: `${c.name}, removed ${dates.day(c.removedAt!)}. Deleted after ${dates.dayTime(stamp)} ${dates.zoneName(stamp)}` })),
        note:
          `To keep ${n === 1 ? "them" : "any of them"}, restore them on the Clients page before then (it uses a client seat). ` +
          "To keep a recording yourself, open it and choose Save to device. Recordings you also sent to other clients stay with those clients. " +
          "We'll send a reminder about 3 days before.",
        button: { label: "Open Removed clients", link: appUrl(teamPath("/clients?removed=1", ws.id)) },
        footer: tzFooter(ws, dates.zone),
        logoUrl: brand.logoUrl,
        color: brand.color,
      });
      await sendMail({ to: owner.user.email, ...mail });
      // Told: now they get the date the email gave. One restored meanwhile has lost the claim and stays restored.
      dated += (await db.client.updateMany({ where: { id: { in: ids }, ...pending, purgeWarnedAt: claim }, data: { purgeAt: stamp, purgeWarnedAt: null } })).count;
    } catch (err) {
      console.error(JSON.stringify({ level: "error", message: "[client-purge] couldn't tell the owner about earlier removals; retried next run", workspaceId, error: String(err) }));
      if (ids.length) await db.client.updateMany({ where: { id: { in: ids }, purgeAt: null, purgeWarnedAt: claim }, data: { purgeWarnedAt: null } }).catch(() => {});
    }
  }
  return dated;
}

/**
 * Email the business about 3 days before removed clients are deleted: the
 * owner, and whoever removed them if they're still on the team.
 * One email per person per run; each client is warned once (a restore and a
 * new removal start again). A failed send is retried on the next run.
 */
export async function warnClientPurge(now = new Date()) {
  const due = await db.client.findMany({
    // Not while the owner's account is closed (lib/accountDeletion.ts); warned after, if they keep it in time.
    // Nor while support has it suspended (nothing is emailed in its name) or on legal hold (nothing is deleted).
    where: { removedAt: { not: null }, purgeAt: { gt: now, lte: new Date(now.getTime() + CLIENT_PURGE_WARN_MS) }, purgeWarnedAt: null, workspace: tellable },
    select: { id: true, workspaceId: true },
    take: 500,
  });
  const groups = new Map<string, string[]>();
  for (const c of due) groups.set(c.workspaceId, [...(groups.get(c.workspaceId) ?? []), c.id]);

  let sent = 0;
  for (const [workspaceId, ids] of groups) {
    // Claim with a stamp of our own so a concurrent run can't send the same ones.
    const stamp = new Date(now.getTime() + Math.floor(Math.random() * 1000));
    await db.client.updateMany({ where: { id: { in: ids }, purgeWarnedAt: null }, data: { purgeWarnedAt: stamp } });
    const mine = await db.client.findMany({
      where: { id: { in: ids }, purgeWarnedAt: stamp, removedAt: { not: null }, purgeAt: { gt: now } },
      select: { id: true, name: true, removedAt: true, purgeAt: true, removedById: true },
      orderBy: { purgeAt: "asc" },
    });
    if (!mine.length) continue;
    const release = () => db.client.updateMany({ where: { id: { in: mine.map((c) => c.id) }, purgeWarnedAt: stamp }, data: { purgeWarnedAt: null } });

    const [ws, owner] = await Promise.all([
      db.workspace.findUnique({ where: { id: workspaceId } }),
      db.membership.findFirst({ where: { workspaceId, role: "OWNER", ...activeMember }, include: { user: { select: { email: true } } } }),
    ]);
    if (!ws || !owner) {
      await release();
      continue;
    }
    // Whoever removed them hears too, while they're still on the team.
    const removerIds = [...new Set(mine.flatMap((c) => (c.removedById && c.removedById !== owner.userId ? [c.removedById] : [])))];
    const removers = removerIds.length
      ? await db.membership.findMany({ where: { workspaceId, userId: { in: removerIds }, ...activeMember }, include: { user: { select: { email: true } } } })
      : [];
    const recipients = [
      { email: owner.user.email, userId: owner.userId, canRestore: true, clients: mine },
      ...removers.map((m) => ({ email: m.user.email, userId: m.userId, canRestore: m.role !== "MEMBER", clients: mine.filter((c) => c.removedById === m.userId) })),
    ];

    const dates = zoned(ws.timezone);
    const brand = brandOf(ws, appUrl(""));
    const when = (d: Date) => `${dates.dayTime(d)} ${dates.zoneName(d)}`;
    let delivered = 0;
    for (const { email, userId, canRestore, clients } of recipients) {
      const n = clients.length;
      const first = clients[0];
      const mail = teamEmail({
        business: ws.name,
        subject: n === 1 ? `${first.name} will be deleted from ${BRAND.name} on ${dates.shortDay(first.purgeAt!)}` : `${n} removed clients will be deleted from ${BRAND.name} within 3 days`,
        lead:
          n === 1
            ? `${first.name} was removed from your clients on ${dates.day(first.removedAt!)}. They'll be deleted for good after ${when(first.purgeAt!)}, with their videos, conversations, to-dos and notes.`
            : `${n} removed clients will be deleted for good within 3 days, with their videos, conversations, to-dos and notes. They're listed below.`,
        lines: n === 1 ? undefined : clients.map((c) => ({ text: `${c.name}, removed ${dates.day(c.removedAt!)}. Deleted after ${when(c.purgeAt!)}` })),
        note:
          (canRestore
            ? `To keep ${n === 1 ? "them" : "a client"}, restore them on the Clients page before then (it uses a client seat). `
            : `To keep ${n === 1 ? "them" : "a client"}, ask the owner or an admin to restore them on the Clients page before then. `) +
          "To keep a recording yourself, open it and choose Save to device. Recordings you also sent to other clients stay with those clients.",
        button: canRestore
          ? { label: "Open Removed clients", link: appUrl(teamPath("/clients?removed=1", ws.id)) }
          : { label: `Open ${BRAND.name}`, link: appUrl(teamPath("/library", ws.id)) },
        footer: tzFooter(ws, dates.zone),
        logoUrl: brand.logoUrl,
        color: brand.color,
      });
      try {
        await sendMail({ to: email, ...mail });
        delivered++;
        await notify([{ userId, workspaceId, kind: "CLIENT_DELETING", text: mail.subject, href: canRestore ? "/clients?removed=1" : "/library", clientId: n === 1 ? first.id : null }]);
      } catch (err) {
        console.error("client purge warning failed", err);
      }
    }
    // Nobody heard: try again next run.
    if (!delivered) await release();
    sent += delivered;
  }
  return sent;
}
