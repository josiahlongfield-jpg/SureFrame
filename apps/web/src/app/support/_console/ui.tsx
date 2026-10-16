import Link from "next/link";
import { notFound } from "next/navigation";
import type { AdminAction } from "@prisma/client";
import { db } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { requirePageUser } from "@/lib/session";
import { isNoticeReason, isSupportAdmin, NOTICE_REASONS, type SupportAdmin } from "@/lib/support/admin";

/** The signed-in support admin for a console page (works while their own workspace is paused or suspended); anyone else gets a 404. */
export async function consoleAdmin(next: string): Promise<SupportAdmin> {
  const me = await requirePageUser(next, { allowPaused: true, allowSuspended: true, allowTermsPending: true });
  if (!isSupportAdmin(me.user.email)) notFound();
  return { userId: me.user.id, email: me.user.email, workspaceIds: me.user.memberships.map((m) => m.workspaceId) };
}

/** Times in the console are UTC, like the support inbox. */
export const utc = (d: Date | null | undefined) => (d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "");
export const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/** Stripe Dashboard links (test-mode ones when the server uses test keys). */
export function stripeLink(kind: "customers" | "subscriptions", id: string) {
  const test = process.env.STRIPE_SECRET_KEY?.startsWith("sk_test") ? "/test" : "";
  return `https://dashboard.stripe.com${test}/${kind}/${id}`;
}

export const planName = (p: keyof typeof PLANS) => PLANS[p].name;

const TONES = {
  red: "bg-danger-bg text-danger-fg",
  amber: "bg-warn-bg text-warn-fg",
  slate: "bg-surface-2 text-muted",
  green: "bg-ok-bg text-ok-fg",
  purple: "bg-purple-100 text-purple-800",
} as const;

export function Badge({ tone = "slate", children, testId }: { tone?: keyof typeof TONES; children: React.ReactNode; testId?: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`} data-testid={testId}>
      {children}
    </span>
  );
}

/** The console's own navigation, under the page title. */
export function ConsoleNav() {
  const link = "text-sm text-accent hover:underline";
  return (
    <nav className="flex flex-wrap gap-x-4 gap-y-1">
      <Link href="/support" className={link}>
        ← Support inbox
      </Link>
      <Link href="/support/lookup" className={link}>
        Look up
      </Link>
      <Link href="/support/log" className={link}>
        Support log
      </Link>
      <Link href="/support/accounts" className={link}>
        Free plans
      </Link>
      <Link href="/support/offers" className={link}>
        Discounts
      </Link>
    </nav>
  );
}

/** A label/value list that stacks on a phone. */
export function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[11rem_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="pt-2 text-dim sm:pt-0">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-8">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const LABELS: Record<string, string> = {
  "account.warn": "Warning sent",
  "workspace.suspend": "Workspace suspended",
  "workspace.unsuspend": "Workspace unsuspended",
  "user.suspend": "Login suspended",
  "user.unsuspend": "Login unsuspended",
  "account.close": "Account closed permanently",
  "account.reopen": "Account reopened",
  "workspace.legal_hold_on": "Legal hold on",
  "workspace.legal_hold_off": "Legal hold off",
  "client.link_off": "Client's link turned off",
  "client.link_on": "Client's link turned back on",
  "user.sign_out_everywhere": "Signed out everywhere",
  "email.block": "Email address blocked",
  "email.unblock": "Email address unblocked",
  "account.delete_now": "Account deleted now",
  "account.cancel_deletion": "Scheduled deletion cancelled",
  "client.restore": "Removed client restored",
  "client.keep_longer": "Removed client kept 30 more days",
  "client.delete_now": "Removed client deleted now",
  "workspace.videos_recorded": "Free videos used set",
  "billing.resync": "Billing re-synced from Stripe",
  "workspace.seat_check": "Seat check re-run",
  "plan.complimentary": "Complimentary plan changed",
  "plan.complimentary_ai": "Complimentary AI summaries changed",
  "account.export": "Account data downloaded",
  "offer.create": "Discount code given",
  "offer.end": "Discount code cancelled",
  "offer.automatic": "Automatic offer changed",
};
export const actionLabel = (action: string) => LABELS[action] ?? action;

type Details = Record<string, unknown> & {
  status?: string;
  error?: string;
  notify?: boolean;
  emailedTo?: string | null;
  category?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};
const isoDay = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : "");

/** The facts worth showing about a logged action, in short phrases. */
export function actionFacts(row: Pick<AdminAction, "action" | "details">): string[] {
  const d = (row.details && typeof row.details === "object" && !Array.isArray(row.details) ? row.details : {}) as Details;
  const out: string[] = [];
  if (d.status === "failed") out.push(`Failed: ${d.error ?? "unknown error"}`);
  if (d.status === "started") out.push("Started, but no result was recorded");
  if (d.status === "retrying") out.push("Files couldn't be deleted yet; the clean-up job finishes it within minutes");
  if (d.status === "skipped") out.push("Not deleted yet: another clean-up run or a restore had it. Check again in a few minutes");
  if (d.category && isNoticeReason(d.category)) out.push(`Reason given: ${NOTICE_REASONS[d.category]}`);
  if (typeof d.emailedTo === "string") out.push(`Emailed ${d.emailedTo}`);
  else if (d.notify === false) out.push("Not emailed (unticked)");
  else if ("emailedTo" in d) out.push("No email went out");
  const b = d.before ?? {};
  const a = d.after ?? {};
  switch (row.action) {
    case "workspace.suspend":
    case "workspace.unsuspend": {
      const billing = d.billing as { renewal?: string; endsAt?: string | null } | null | undefined;
      if (billing?.renewal === "stopped") out.push(`Renewal stopped${billing.endsAt ? `, ends ${isoDay(billing.endsAt)}` : ""}`);
      else if (billing?.renewal) out.push(`Renewal: ${billing.renewal}`);
      if (typeof d.note === "string" && d.note) out.push(`Note to members: ${d.note}`);
      if (typeof d.remindersSkipped === "number" && d.remindersSkipped) out.push(`${d.remindersSkipped} overdue reminders skipped`);
      break;
    }
    case "account.close":
      out.push(`Deleted on ${isoDay(d.deleteAt)}`);
      if (d.blockEmail) out.push("Address blocked");
      if (d.legalHold) out.push("Legal hold set");
      if (Array.isArray(d.leftTeams) && d.leftTeams.length) out.push(`Left ${d.leftTeams.length} team(s)`);
      break;
    case "account.delete_now":
      if (d.deleted === false) out.push("Already deleted");
      break;
    case "offer.create":
    case "offer.end":
    case "offer.automatic":
      if (typeof d.summary === "string") out.push(d.summary);
      if (row.action === "offer.create" && typeof d.business === "string") out.push(`For ${d.business} only, once`);
      if (row.action === "offer.create" && d.automatic) out.push("Applied automatically");
      if (row.action === "offer.automatic") out.push(d.automatic ? "Now applied automatically" : "No longer applied automatically");
      if (row.action === "offer.end" && typeof d.uses === "number") out.push(`Used ${d.uses} time${d.uses === 1 ? "" : "s"}`);
      break;
    case "account.cancel_deletion":
      if (d.planEnded) out.push("Their paid plan had ended meanwhile");
      break;
    case "client.restore":
      if (d.ignoreSeatLimit) out.push("Seat limit ignored");
      if (d.newLink) out.push(d.clientEmailed ? "New link, emailed to the client" : "New link; the business sends it");
      break;
    case "client.keep_longer":
      out.push(`Deletion moved from ${isoDay(b.purgeAt)} to ${isoDay(a.purgeAt)}`);
      break;
    case "workspace.videos_recorded":
      out.push(`${String(b.videosRecorded)} → ${String(a.videosRecorded)}`);
      break;
    case "billing.resync": {
      const changed = Array.isArray(d.changed) ? (d.changed as string[]) : null;
      if (d.forgotten) out.push("Stripe no longer has the subscription; it was forgotten");
      if (d.otherWorkspace) out.push("The subscription in Stripe was made for another workspace, so nothing was applied");
      if (changed) out.push(changed.length ? `Changed: ${changed.join(", ")}` : "Nothing changed");
      if (typeof d.stripeStatus === "string") out.push(`Stripe says: ${d.stripeStatus}`);
      break;
    }
    case "workspace.seat_check":
      if (a && "pausedClients" in a) out.push(`Paused clients ${String(b.pausedClients)} → ${String(a.pausedClients)}, staff ${String(b.pausedStaff)} → ${String(a.pausedStaff)}`);
      break;
    case "plan.complimentary":
    case "plan.complimentary_ai": {
      const p = (v: unknown) => (typeof v === "string" && v in PLANS ? planName(v as keyof typeof PLANS) : "none");
      if (row.action === "plan.complimentary") out.push(`Plan ${p(b.plan)} → ${p(a.plan)}, complimentary ${p(b.complimentaryPlan)} → ${p(a.complimentaryPlan)}`);
      else out.push(`AI summaries ${b.aiAssist ? "on" : "off"} → ${a.aiAssist ? "on" : "off"}`);
      break;
    }
  }
  return out;
}

/** "Done" banner after a power ran, read back from its support-log row so it says what actually happened. */
export async function Done({ id }: { id?: string }) {
  if (!id) return null;
  const row = await db.adminAction.findUnique({ where: { id } });
  if (!row) return null;
  const facts = actionFacts(row);
  const failed = (row.details as Details | null)?.status === "failed";
  return (
    <div role="status" data-testid="done" className={`mt-6 rounded-2xl p-4 text-sm ${failed ? "bg-danger-bg text-danger-fg" : "bg-ok-bg text-ok-fg"}`}>
      <p className="font-semibold">
        {failed ? "Didn't finish: " : "Done: "}
        {actionLabel(row.action)}
        {row.target ? ` (${row.target})` : ""}
      </p>
      {facts.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {facts.map((f) => (
            <li key={f} className="break-words">
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A list of support-log rows, newest first. */
export async function History({ rows, links = false, empty = "Nothing yet." }: { rows: AdminAction[]; links?: boolean; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  // Only link to what still exists.
  const [users, workspaces] = links
    ? await Promise.all([
        db.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter((v): v is string => !!v) } }, select: { id: true } }),
        db.workspace.findMany({ where: { id: { in: rows.map((r) => r.workspaceId).filter((v): v is string => !!v) } }, select: { id: true } }),
      ])
    : [[], []];
  const userIds = new Set(users.map((u) => u.id));
  const wsIds = new Set(workspaces.map((w) => w.id));
  return (
    <ol className="divide-y divide-line rounded-2xl border border-line bg-surface" data-testid="history">
      {rows.map((r) => (
        <li key={r.id} className="p-4 text-sm" data-action={r.action}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-medium text-ink">
              {actionLabel(r.action)}
              {(r.details as Details | null)?.status === "failed" && <span className="text-danger-fg"> (didn&rsquo;t finish)</span>}
            </p>
            <p className="text-xs text-dim">{utc(r.createdAt)}</p>
          </div>
          {r.target && <p className="mt-1 break-words text-muted">{r.target}</p>}
          {r.reason && <p className="mt-1 whitespace-pre-wrap break-words text-muted">Reason: {r.reason}</p>}
          {actionFacts(r).map((f) => (
            <p key={f} className="mt-1 break-words text-xs text-dim">
              {f}
            </p>
          ))}
          <p className="mt-1 break-words text-xs text-dim">
            By {r.actorEmail}
            {links && r.workspaceId && wsIds.has(r.workspaceId) && (
              <>
                {" · "}
                <Link href={`/support/workspaces/${r.workspaceId}`} className="text-accent hover:underline">
                  Workspace
                </Link>
              </>
            )}
            {links && r.userId && userIds.has(r.userId) && (
              <>
                {" · "}
                <Link href={`/support/users/${r.userId}`} className="text-accent hover:underline">
                  Login
                </Link>
              </>
            )}
          </p>
        </li>
      ))}
    </ol>
  );
}
