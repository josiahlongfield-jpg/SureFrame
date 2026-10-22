import Link from "next/link";
import { notFound } from "next/navigation";
import { onLegalHold } from "@/lib/accountDeletion";
import { isEmailBlocked } from "@/lib/blockedEmail";
import { db } from "@/lib/db";
import { CLOSURE_DELETE_DAYS } from "@/lib/periods";
import { closeConfirmation } from "@/lib/support/admin";
import { deleteConfirmation } from "@/lib/support/console";
import PowerForm, { Check } from "../../_console/PowerForm";
import { Badge, consoleAdmin, Done, Facts, History, planName, Section } from "../../_console/ui";
import { qldDay, qldTime } from "@/lib/support/when";
import { supportTitle } from "../../_console/meta";

export const generateMetadata = supportTitle("Login (support)", "admin", { robots: { index: false } });

const field = "w-full rounded-xl border border-line-strong px-3 py-2 text-sm";

/** Support admins: one login's status, workspaces, the support powers for it, and its support log. */
export default async function SupportUser({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const { id } = await params;
  const { done } = await searchParams;
  const admin = await consoleAdmin(`/support/users/${id}`);
  const u = await db.user.findUnique({
    where: { id },
    include: {
      accounts: { select: { provider: true } },
      memberships: { orderBy: { id: "asc" }, include: { workspace: { include: { _count: { select: { members: true } } } } } },
    },
  });
  if (!u) notFound();
  const [blocked, history, tickets] = await Promise.all([
    isEmailBlocked(u.email),
    db.adminAction.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.supportTicket.findMany({ where: { userId: id }, orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, status: true, summary: true, updatedAt: true } }),
  ]);
  const mine = u.id === admin.userId;
  const now = new Date();
  // Closed with the login: what it owns, or is alone on. Elsewhere it's staff.
  const owned = u.memberships.filter((m) => m.role === "OWNER" || m.workspace._count.members === 1);
  const ownsTeam = u.memberships.some((m) => m.role === "OWNER" && m.workspace._count.members > 1);
  const staffOn = u.memberships.filter((m) => m.role === "OWNER" && m.workspace._count.members > 1).reduce((n, m) => n + m.workspace._count.members - 1, 0);
  // On a held workspace, or rows of one point at it (lib/accountDeletion.ts): not deleted while the hold lasts.
  const held = await onLegalHold(u.id);
  const reopenable = !!u.closedAt && !!u.deleteAt && u.deleteAt > now;
  // They'd closed it themselves before support did (closeAccount stamps both at once otherwise).
  const selfDeleted = !!u.closedAt && !!u.deletionRequestedAt && u.deletionRequestedAt < u.closedAt;
  const emailThem = `Email ${u.email}`;

  return (
    <div>
      <h1 className="break-all text-2xl font-semibold tracking-tight text-ink">{u.email}</h1>
      <p className="mt-1 break-all text-xs text-dim">
        {u.name ? `${u.name} · ` : ""}Login {u.id}
      </p>
      {owned.length > 0 && (
        <p className="mt-2 text-sm text-muted" data-testid="user-powers-elsewhere">
          This page has the login&rsquo;s powers (suspend it, close the account for good, delete it, block the address). For the business (legal hold, suspend the
          workspace, free videos, billing), open{" "}
          {owned.map((m, i) => (
            <span key={m.id}>
              {i > 0 && ", "}
              <Link href={`/support/workspaces/${m.workspaceId}`} className="text-accent hover:underline">
                {m.workspace.name}
              </Link>
            </span>
          ))}
          .
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2" data-testid="user-badges">
        {u.closedAt ? <Badge tone="red">Closed by support</Badge> : u.suspendedAt ? <Badge tone="red">Login suspended</Badge> : <Badge tone="green">Active</Badge>}
        {u.deleteAt && <Badge tone="amber">Deletion {qldDay(u.deleteAt)}</Badge>}
        {blocked && <Badge tone="red">Email blocked</Badge>}
        {held && <Badge tone="purple">Legal hold</Badge>}
      </div>
      <Done id={done} />

      <Section title="Status">
        <div className="rounded-2xl border border-line bg-surface p-4" data-testid="user-status">
          <Facts
            rows={[
              [
                "Login",
                u.closedAt ? (
                  `Closed by support on ${qldTime(u.closedAt)}`
                ) : u.suspendedAt ? (
                  <span key="s" className="flex flex-col gap-1">
                    <span>Suspended since {qldTime(u.suspendedAt)}</span>
                    {u.suspendedReason && <span className="whitespace-pre-wrap text-muted">Reason: {u.suspendedReason}</span>}
                  </span>
                ) : (
                  "Active"
                ),
              ],
              [
                "Deletion",
                u.deleteAt
                  ? `Scheduled for ${qldDay(u.deleteAt)}${u.closedAt ? ` (closed by support: they can't keep it${selfDeleted ? `; they had closed it themselves on ${qldDay(u.deletionRequestedAt)}` : ""})` : `, they closed it on ${qldDay(u.deletionRequestedAt)} and can keep it by signing in before then`}${held ? "; held while legal hold is on" : ""}`
                  : "Not scheduled",
              ],
              ["Email blocked", blocked ? "Yes: it can't sign in or sign up" : "No"],
              ["Signed out everywhere", u.sessionsValidAfter ? qldTime(u.sessionsValidAfter) : "Never"],
              ["Google sign-in linked", u.accounts.some((a) => a.provider === "google") ? "Yes" : "No"],
              ["Created", qldTime(u.createdAt)],
            ]}
          />
        </div>
      </Section>

      <Section title={`Workspaces (${u.memberships.length})`}>
        {u.memberships.length === 0 ? (
          <p className="text-sm text-muted">None.</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {u.memberships.map((m) => (
              <li key={m.id}>
                <Link href={`/support/workspaces/${m.workspaceId}`} className="block p-4 hover:bg-hover">
                  <p className="break-words font-medium text-ink">{m.workspace.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <span>
                      {m.role === "OWNER" ? "Owner" : m.role === "ADMIN" ? "Admin" : "Member"} · {m.workspace._count.members} on the team
                    </span>
                    <Badge>{planName(m.workspace.plan)}</Badge>
                    {m.pausedAt && <Badge>Paused by the plan</Badge>}
                    {m.workspace.closedAt ? <Badge tone="red">Closed</Badge> : m.workspace.suspendedAt && <Badge tone="red">Suspended</Badge>}
                    {m.workspace.legalHoldAt && <Badge tone="purple">Legal hold</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {mine ? (
        <p className="mt-8 rounded-2xl bg-warn-bg p-4 text-sm text-warn-fg">This is your own login, so the support powers can&rsquo;t be used on it.</p>
      ) : (
        <Section title="Support powers">
          <div className="grid gap-3">
            <PowerForm
              power="warn"
              hidden={{ userId: u.id }}
              title="Send a warning"
              intro={`Emails ${u.email} a warning, with the reason in plain words and how to ask for a review. Nothing else changes.`}
              category
              submit="Send warning"
            >
              <label className="grid gap-1 text-sm text-muted">
                Message in the email (optional)
                <textarea name="message" maxLength={1000} rows={3} className={field} />
              </label>
            </PowerForm>

            {!u.closedAt &&
              (!u.suspendedAt ? (
                <PowerForm
                  power="suspendUser"
                  hidden={{ userId: u.id }}
                  title="Suspend this login"
                  intro="It sees the suspended page on every workspace it's on, can't join teams or use the mobile app, and gets no team emails. Its own workspace keeps working for anyone else on it. Nothing is deleted."
                  category
                  notify={emailThem}
                  submit="Suspend login"
                  danger
                />
              ) : (
                <PowerForm
                  power="unsuspendUser"
                  hidden={{ userId: u.id }}
                  title="Unsuspend this login"
                  intro="It can sign in and use SureFrame again."
                  notify={emailThem}
                  submit="Unsuspend login"
                />
              ))}

            <details className="group rounded-2xl border border-line bg-surface" data-testid="export-user">
              <summary className="cursor-pointer list-none p-4 text-sm font-semibold text-ink">
                <span className="mr-2 inline-block text-dim transition-transform group-open:rotate-90" aria-hidden>
                  ▸
                </span>
                Download their data
              </summary>
              <form method="post" action="/api/support/export" className="grid gap-3 border-t border-line p-4">
                <input type="hidden" name="userId" value={u.id} />
                <p className="text-sm text-muted">
                  The same download as Settings &gt; Account, for an account that can&rsquo;t sign in to get it (closed by support, or its address blocked). Send it only to{" "}
                  {u.email}, from the support inbox. Encrypted recordings and messages stay encrypted.
                </p>
                <label className="grid gap-1 text-sm text-muted">
                  Reason (internal: kept in the support log, never shown to the customer)
                  <textarea name="reason" required maxLength={500} rows={2} className={field} />
                </label>
                <button className="justify-self-start rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">Download</button>
              </form>
            </details>

            <PowerForm
              power="signOutEverywhere"
              hidden={{ userId: u.id }}
              title="Sign out everywhere"
              intro="Ends every sign-in on every device and in the mobile app, and unused sign-in links. Signing in again works as normal."
              notify={emailThem}
              submit="Sign out everywhere"
            />

            {u.deleteAt && !u.closedAt && (
              <PowerForm
                power="cancelDeletion"
                hidden={{ userId: u.id }}
                title="Cancel the scheduled deletion"
                intro={
                  <>
                    Only on a request from {u.email} itself. The account opens again and won&rsquo;t be deleted on {qldDay(u.deleteAt)}; clients the plan covers get their links back,
                    and renewal is turned back on if closing stopped it and the plan is still running. Teams they left don&rsquo;t take them back.
                    {u.suspendedAt && <span className="mt-1 block font-medium text-warn-fg">The login is suspended: unsuspend it first.</span>}
                  </>
                }
                notify={emailThem}
                submit="Cancel deletion"
              />
            )}

            {reopenable && (
              <PowerForm
                power="reopenAccount"
                hidden={{ userId: u.id }}
                title="Reopen after a review"
                intro={
                  selfDeleted
                    ? `Only when a review finds the closure was wrong, before ${qldDay(u.deleteAt)}. They had closed the account themselves first, so it goes back to that: still deleted on ${qldDay(u.deleteAt)} unless they sign in and keep it, with its clients paused until then. The address is unblocked. The cancelled subscription doesn't come back.`
                    : `Only when a review finds the closure was wrong, before ${qldDay(u.deleteAt)}. The login and its workspaces work again and the address is unblocked. The cancelled subscription and the staff taken off the team don't come back.`
                }
                notify={emailThem}
                submit="Reopen account"
              />
            )}

            {!u.closedAt && (
              <PowerForm
                power="closeAccount"
                hidden={{ userId: u.id }}
                title="Close permanently"
                intro={
                  <>
                    For a serious or repeated breach of the Terms, or unlawful or harmful use; it can be done without warning. Straight away: the login
                    {owned.length ? ` and ${owned.map((m) => m.workspace.name).join(", ")}` : ""} are suspended and closed, any subscription is cancelled now (no further charges;
                    refunds only in Stripe where the law requires), it&rsquo;s signed out everywhere and invites are cancelled.
                    {ownsTeam ? ` ${staffOn} staff ${staffOn === 1 ? "member is" : "members are"} taken off the team (they keep their own logins).` : ""} It leaves any team
                    it&rsquo;s staff on.{" "}
                    {u.deleteAt
                      ? `Everything is deleted for good on ${qldDay(u.deleteAt)}, the date already set when they closed it themselves, unless legal hold is on.`
                      : `Everything is deleted for good ${CLOSURE_DELETE_DAYS} days later unless legal hold is on.`}{" "}
                    The account holder can&rsquo;t undo it; you can reopen it after a review before then.
                  </>
                }
                category
                confirm={closeConfirmation(u.email)}
                notify={emailThem}
                submit="Close permanently"
                danger
              >
                <Check name="blockEmail" label="Block this email from signing up again" hint="Only a hash of the address is kept." />
                {owned.length > 0 && (
                  <Check name="legalHold" label="Put legal hold on" hint="Nothing of the closed workspace is deleted, even after the deletion date, until you lift it." />
                )}
              </PowerForm>
            )}

            {ownsTeam ? (
              <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
                Delete now isn&rsquo;t available: this login owns a team with other staff, who have to leave it first (closing the account takes them off it).
              </p>
            ) : held ? (
              <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">Delete now isn&rsquo;t available while legal hold is on.</p>
            ) : (
              <PowerForm
                power="deleteAccountNow"
                hidden={{ userId: u.id }}
                title="Delete account now"
                intro={`Only on a request from ${u.email} itself. Deletes the login now, with ${owned.length ? owned.map((m) => m.workspace.name).join(", ") + " and its recordings, clients, to-dos and notes" : "nothing else (it has no workspace of its own)"}, cancels any subscription and deletes the Stripe customer. Recordings it made for other teams stay with them. Can't be undone.`}
                confirm={deleteConfirmation(u.email)}
                notify={`Email ${u.email} that the account has been deleted`}
                submit="Delete for good"
                danger
              />
            )}

            {blocked ? (
              <PowerForm
                power="unblockEmail"
                hidden={{ email: u.email }}
                title="Unblock this email"
                intro={
                  u.closedAt ? "It's no longer blocked from signing up. The closed account is still deleted on its date unless you reopen it." : "It can sign in and sign up again."
                }
                notify={`Email ${u.email} that it can be used again`}
                submit="Unblock"
              />
            ) : (
              <PowerForm
                power="blockEmail"
                hidden={{ email: u.email }}
                title="Block this email"
                intro="It can't sign in or sign up by any method until unblocked; sessions already signed in carry on until you use Sign out everywhere. Only a hash of the address is stored. Refused while a plan it owns still renews: close the account, or suspend with Stop renewal, first."
                category
                notify={`Email ${u.email} that the address is blocked, and why`}
                submit="Block"
                danger
              />
            )}
          </div>
        </Section>
      )}

      {tickets.length > 0 && (
        <Section title="Support conversations">
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link href={`/support/${t.id}`} className="block p-4 text-sm hover:bg-hover">
                  <p className="line-clamp-2 break-words text-ink">{t.summary ?? "Conversation"}</p>
                  <p className="mt-1 text-xs text-dim">
                    {t.status.replace("_", " ").toLowerCase()} · {qldTime(t.updatedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Support log">
        <History rows={history} links />
      </Section>
    </div>
  );
}
