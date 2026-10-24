import { db } from "@/lib/db";

/**
 * The bell in the top menu (Josiah, 23 October 2026): everything the team's emails tell someone, kept in the app as
 * well, so a reply is never missed by someone who doesn't check their email. One row per person and business; the
 * emails carry on as before. Plain text only: client names and video titles, never anything end-to-end encrypted.
 */
export type NotificationKind =
  | "REPLY" // a client replied (opens their conversation)
  | "SENT" // a staff member sent videos (owners and admins who asked to hear)
  | "TODO" // a to-do's reminder for the team
  | "STAFF_REMINDER" // a reminder from the owner to a staff member
  | "EXPIRING" // recordings deleted from our servers in 24 hours
  | "CLIENT_DELETING" // removed clients about to be deleted for good (not sent since 24 October 2026; old rows only)
  | "LINK_REQUEST" // a client asking for their personal link
  | "PAUSED" // clients or staff paused by the plan's limits
  | "BACKUP_ENDED" // cloud backup ended
  | "SUPPORT"; // a reply from SureFrame support

export type NewNotification = {
  userId: string;
  workspaceId: string;
  kind: NotificationKind;
  /** The line shown, given how many have added up in its group while unread. */
  text: string | ((count: number) => string);
  href: string;
  /** Unread notifications in the same group become one ("Client A sent 3 replies"). */
  groupKey?: string;
  videoId?: string;
  /** The client it names, so it's deleted with them. */
  clientId?: string | null;
};

/** Unread ones are kept this long; read ones for READ_DAYS. */
const UNREAD_DAYS = 90;
const READ_DAYS = 30;
/** How many the bell's list shows. */
export const LIST_SIZE = 30;

/** Adds notifications to people's bells. Never throws: a notification is never worth failing what caused it. */
export async function notify(list: NewNotification[]) {
  for (const n of list) {
    try {
      const text = (count: number) => (typeof n.text === "function" ? n.text(count) : n.text);
      if (n.groupKey) {
        const open = await db.notification.findFirst({ where: { userId: n.userId, workspaceId: n.workspaceId, groupKey: n.groupKey, readAt: null }, orderBy: { createdAt: "desc" } });
        if (open) {
          await db.notification.update({ where: { id: open.id }, data: { count: open.count + 1, text: text(open.count + 1), href: n.href, createdAt: new Date() } });
          continue;
        }
      }
      await db.notification.create({ data: { userId: n.userId, workspaceId: n.workspaceId, kind: n.kind, text: text(1), href: n.href, groupKey: n.groupKey, videoId: n.videoId, clientId: n.clientId ?? null } });
    } catch (err) {
      console.error("notification failed", err);
    }
  }
}

/** What the bell shows for this person in this business. */
export async function bellFor(userId: string, workspaceId: string) {
  const where = { userId, workspaceId };
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: LIST_SIZE }),
    db.notification.findMany({ where: { ...where, readAt: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  return {
    items: items.map((n) => ({ id: n.id, kind: n.kind as NotificationKind, text: n.text, href: n.href, createdAt: n.createdAt.toISOString(), read: !!n.readAt })),
    unread: unread.length,
    /** The newest unread one's time: a newer one arriving makes the bell shake. */
    newest: unread[0]?.createdAt.toISOString() ?? null,
  };
}

/** Just the count and newest time, for the header (no list until it's opened). */
export async function bellCount(userId: string, workspaceId: string) {
  const unread = await db.notification.findMany({ where: { userId, workspaceId, readAt: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return { unread: unread.length, newest: unread[0]?.createdAt.toISOString() ?? null };
}

/** Marks one, those about a conversation, or all of them read for this person in this business. */
export async function markRead(userId: string, workspaceId: string, which: { id?: string; videoId?: string; all?: boolean }) {
  const where = { userId, workspaceId, readAt: null };
  if (which.all) return (await db.notification.updateMany({ where, data: { readAt: new Date() } })).count;
  if (which.id) return (await db.notification.updateMany({ where: { ...where, id: which.id }, data: { readAt: new Date() } })).count;
  if (which.videoId) return (await db.notification.updateMany({ where: { ...where, videoId: which.videoId }, data: { readAt: new Date() } })).count;
  return 0;
}

/** Old ones go (the reminders job, every 5 minutes). */
export async function pruneNotifications(now = new Date()) {
  const day = 86_400_000;
  const { count } = await db.notification.deleteMany({
    where: {
      OR: [
        { readAt: { lt: new Date(now.getTime() - READ_DAYS * day) } },
        { createdAt: { lt: new Date(now.getTime() - UNREAD_DAYS * day) } },
      ],
    },
  });
  return count;
}
