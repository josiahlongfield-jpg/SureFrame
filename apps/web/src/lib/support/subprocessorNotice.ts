import { z } from "zod";
import { BRAND } from "@/lib/brand";
import { appUrl } from "@/lib/appUrl";
import { db } from "@/lib/db";
import { LEGAL } from "@/lib/legal";
import { sendMails } from "@/lib/mail";
import { teamEmail } from "@/lib/teamEmail";
import { SUPPORT_ZONE } from "@/lib/support/when";
import type { SupportAdmin } from "@/lib/support/admin";

/**
 * The emailed notice of a new sub-processor that our DPA (section 8) promises every business owner at least
 * NOTICE_DAYS before it starts handling their customers' information (decision 22). Sent from the support console by a
 * support admin (app/support/notices), to every business owner at once, and logged as an AdminAction.
 */
export const NOTICE_DAYS = 30;
export const NOTICE_ACTION = "subprocessor.notice";
/** The subject's start, also named in the DPA's section 8, so owners can find the email. */
export const NOTICE_SUBJECT = `New ${BRAND.name} sub-processor`;

/** Today's date in Queensland as YYYY-MM-DD. */
export const qldToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: SUPPORT_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
/** The earliest start date allowed: NOTICE_DAYS after today (Queensland), as YYYY-MM-DD. */
export function earliestStart(now = new Date()) {
  const d = new Date(`${qldToday(now)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + NOTICE_DAYS);
  return d.toISOString().slice(0, 10);
}
/** "21 November 2026" for a YYYY-MM-DD date. */
export const longDate = (iso: string) => new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${iso}T00:00:00Z`));

const text = (label: string, max: number) =>
  z
    .string({ error: `Fill in ${label}.` })
    .trim()
    .min(1, `Fill in ${label}.`)
    .max(max, `Keep ${label} to ${max} characters or fewer.`)
    .refine((s) => !/[\r\n<>]/.test(s), `${label[0].toUpperCase()}${label.slice(1)} can't hold line breaks or < >.`);

export const NoticeInput = z.object({
  name: text("the name", 80),
  purpose: text("what it does", 240),
  location: text("where it processes information", 120),
  startsOn: z
    .string({ error: "Choose the start date." })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the start date.")
    .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "Choose the start date."),
});
export type NoticeInput = z.infer<typeof NoticeInput>;

/** Every business owner's and admin's address, once each (admins act for the business too, G10): of a business that isn't closed or
 * being deleted, whose own login isn't either. */
export async function noticeRecipients() {
  return (await recipientLogins()).map((r) => r.email);
}

/** The same people with their login's id, which is how the log remembers who a notice has reached (never their address). */
async function recipientLogins() {
  const rows = await db.user.findMany({
    where: {
      closedAt: null,
      deleteAt: null,
      memberships: { some: { role: { in: ["OWNER", "ADMIN"] }, workspace: { closedAt: null, deleteAt: null } } },
    },
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  const seen = new Set<string>();
  return rows.map((r) => ({ id: r.id, email: r.email.toLowerCase() })).filter((r) => !seen.has(r.email) && !!seen.add(r.email));
}

export function noticeEmail(n: NoticeInput) {
  const day = longDate(n.startsOn);
  return teamEmail({
    business: BRAND.name,
    subject: `${NOTICE_SUBJECT}: ${n.name}`,
    lead: `As our Data Processing Agreement promises, we're telling you at least ${NOTICE_DAYS} days ahead: from ${day}, a new sub-processor, ${n.name}, will help us run ${BRAND.name} and may handle information we process for your business.`,
    lines: [
      { text: `Who: ${n.name}` },
      { text: `What it does for us: ${n.purpose}` },
      { text: `Where it processes information: ${n.location}` },
      { text: `Starts: ${day}` },
    ],
    button: { label: "See our sub-processors", link: appUrl("/legal/dpa#subprocessors") },
    footer:
      `Your videos, messages, replies, to-dos and notes stay end-to-end encrypted, so no sub-processor can read them. If you object on reasonable data ` +
      `protection grounds, email ${LEGAL.email} before ${day} and we'll work with you in good faith (DPA section 8). You're getting this because you own or help run ` +
      `a business on ${BRAND.name}.`,
  });
}

export type NoticeResult = { ok: true; sent: number; recipients: number } | { ok: false; message: string };

/** What the log entry keeps while a notice goes out: whose logins it has reached (ids only), and when that last moved. */
type Progress = { status?: string; reached?: unknown; progressAt?: string };
/** A send that has recorded nothing for this long has stopped (a request lasts a few minutes at most), so it can be finished. */
const STALLED_MS = 10 * 60_000;

/**
 * Checks the notice (the start date at least NOTICE_DAYS away, in Queensland), refuses a second notice for the same
 * sub-processor and start date, emails every business owner in batches (lib/mail.ts sendMails: 100 a request), and
 * logs it. The log entry is written first, so a double click can't send twice, and updated after each batch with who
 * it has reached. A notice that only partly went (or stopped part-way) can be sent again with the same details: it
 * then goes only to the people it hasn't reached, never twice to anyone.
 */
export async function sendSubprocessorNotice(admin: SupportAdmin, raw: unknown, now = new Date()): Promise<NoticeResult> {
  const parsed = NoticeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the notice." };
  const n = parsed.data;
  const earliest = earliestStart(now);
  if (n.startsOn < earliest) return { ok: false, message: `The start date must be at least ${NOTICE_DAYS} days away: ${longDate(earliest)} or later.` };
  const target = `${n.name} from ${n.startsOn}`;
  const people = await recipientLogins();
  if (!people.length) return { ok: false, message: "There are no business owners or admins to email." };
  const alreadySent = `A notice about ${n.name} starting ${longDate(n.startsOn)} has already been sent (see the Support log).`;
  // Claimed in one statement: a second click (or a second admin) for the same notice finds this row and stops.
  const claimed = await db.$transaction(async (tx) => {
    const already = await tx.adminAction.findFirst({ where: { action: NOTICE_ACTION, target }, orderBy: { createdAt: "asc" }, select: { id: true, details: true } });
    if (!already) {
      const row = await tx.adminAction.create({
        data: { actorUserId: admin.userId, actorEmail: admin.email, action: NOTICE_ACTION, target, reason: n.purpose, details: { ...n, recipients: people.length, sent: 0, status: "sending", reached: [], progressAt: now.toISOString() } },
      });
      return { id: row.id, reached: [] as string[], resentBy: null };
    }
    const d = (already.details ?? {}) as Progress;
    // An entry from before the log kept who was reached can't be finished: nobody knows who was missed.
    if (d.status === "sent" || !Array.isArray(d.reached)) return { refused: alreadySent };
    const stalled = d.status === "sending" && now.getTime() - Date.parse(d.progressAt ?? "") > STALLED_MS;
    if (d.status !== "partly sent" && !stalled) return { refused: `The notice about ${n.name} is being sent now. Check the Support log in a few minutes.` };
    // Picked up again: claimed the same way, so two people finishing it at once can't both send.
    const reached = d.reached.filter((id): id is string => typeof id === "string");
    await tx.adminAction.update({ where: { id: already.id }, data: { details: { ...n, recipients: people.length, sent: reached.length, status: "sending", reached, progressAt: now.toISOString(), resentBy: admin.email } } });
    return { id: already.id, reached, resentBy: admin.email };
  }, { isolationLevel: "Serializable" }).catch(() => null);
  if (!claimed) return { ok: false, message: alreadySent };
  if (claimed.refused !== undefined) return { ok: false, message: claimed.refused };
  const mail = noticeEmail(n);
  const reached = new Set(claimed.reached);
  const todo = people.filter((p) => !reached.has(p.id));
  const sentSoFar = () => people.filter((p) => reached.has(p.id)).length;
  const record = (status: string) =>
    db.adminAction.update({
      where: { id: claimed.id },
      data: { details: { ...n, recipients: people.length, sent: sentSoFar(), status, reached: [...reached], progressAt: new Date().toISOString(), ...(claimed.resentBy ? { resentBy: claimed.resentBy } : {}) } },
    });
  // One request per 100 (sendMails), so each batch either went or didn't, and the log says who has it after every one.
  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    if ((await sendMails(batch.map((p) => ({ to: p.email, ...mail })))) === batch.length) batch.forEach((p) => reached.add(p.id));
    if (i + 100 < todo.length) await record("sending");
  }
  const sent = sentSoFar();
  await record(sent === people.length ? "sent" : "partly sent");
  return { ok: true, sent, recipients: people.length };
}
