import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isEmailBlocked } from "@/lib/blockedEmail";
import { CLIENT_KEEP_DAYS } from "@/lib/clientRemoval";
import { seatUsage } from "@/lib/clients";
import { db } from "@/lib/db";
import { PLANS, staffSeatLimit } from "@/lib/plans";
import { renewalStoppedBySuspension } from "@/lib/support/admin";
import { clientDeleteConfirmation } from "@/lib/support/console";
import { videosUsed } from "@/lib/videoAllowance";
import PowerForm, { Check } from "../../_console/PowerForm";
import { Badge, ConsoleNav, consoleAdmin, day, Done, Facts, History, planName, Section, stripeLink, utc } from "../../_console/ui";

export const metadata: Metadata = { title: "Workspace (support)", robots: { index: false } };

const field = "w-full rounded-xl border border-line-strong px-3 py-2 text-sm";
const D = 86_400_000;

/** Support admins: one workspace's status, members and clients, the support powers for it, and its support log. */
export default async function SupportWorkspace({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const { id } = await params;
  const { done } = await searchParams;
  const admin = await consoleAdmin(`/support/workspaces/${id}`);
  const w = await db.workspace.findUnique({
    where: { id },
    include: {
      members: {
        orderBy: { id: "asc" },
        include: { user: { select: { id: true, email: true, name: true, suspendedAt: true, closedAt: true, deleteAt: true } } },
      },
    },
  });
  if (!w) notFound();
  const [clients, used, seats, history, tickets, stoppedBySuspension] = await Promise.all([
    db.client.findMany({ where: { workspaceId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    videosUsed(id),
    seatUsage(w),
    db.adminAction.findMany({ where: { workspaceId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.supportTicket.findMany({ where: { workspaceId: id }, orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, status: true, summary: true, updatedAt: true } }),
    w.suspendedAt ? renewalStoppedBySuspension(id) : Promise.resolve(false),
  ]);
  const owner = w.members.find((m) => m.role === "OWNER");
  const ownerEmail = owner?.user.email;
  const ownerBlocked = await isEmailBlocked(ownerEmail);
  const mine = admin.workspaceIds.includes(w.id);
  const active = clients.filter((c) => !c.removedAt);
  const removed = clients.filter((c) => c.removedAt);
  const free = PLANS.FREE.maxVideos!;
  const emailOwner = ownerEmail ? `Email the owner (${ownerEmail})` : "Email the owner";
  const now = new Date();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <ConsoleNav />
      <h1 className="mt-3 break-words text-2xl font-semibold tracking-tight text-ink">{w.name}</h1>
      <p className="mt-1 break-all text-xs text-dim">Workspace {w.id}</p>
      <div className="mt-3 flex flex-wrap gap-2" data-testid="ws-badges">
        <Badge>{planName(w.plan)}</Badge>
        {w.complimentaryPlan && <Badge tone="green">Complimentary</Badge>}
        {w.closedAt ? <Badge tone="red">Closed by support</Badge> : w.suspendedAt && <Badge tone="red">Suspended</Badge>}
        {w.legalHoldAt && <Badge tone="purple">Legal hold</Badge>}
        {w.deleteAt && <Badge tone="amber">Deletion {day(w.deleteAt)}</Badge>}
      </div>
      <Done id={done} />

      <Section title="Status">
        <div className="rounded-2xl border border-line bg-surface p-4" data-testid="ws-status">
          <Facts
            rows={[
              [
                "Owner",
                owner ? (
                  <Link href={`/support/users/${owner.user.id}`} className="break-all text-accent hover:underline">
                    {owner.user.email}
                  </Link>
                ) : (
                  "None"
                ),
              ],
              ["Owner's email blocked", ownerBlocked ? "Yes: it can't sign in or sign up" : "No"],
              ["Plan", `${planName(w.plan)}${w.billingInterval ? `, billed every ${w.billingInterval}` : ""}`],
              ["Complimentary plan", w.complimentaryPlan ? `${planName(w.complimentaryPlan)}${w.stripeSubscriptionId ? " (replaced while they pay)" : " (free of charge)"}` : "No"],
              ["Pricing", `${w.foundingPrices ? "Founding prices" : "Standard prices"}${w.discountLabel ? `; discount ${w.discountLabel}${w.discountEndsAt ? ` until ${day(w.discountEndsAt)}` : ""}` : ""}`],
              ["Subscription", w.subscriptionStatus ?? "None"],
              [
                "Stripe",
                w.stripeCustomerId || w.stripeSubscriptionId ? (
                  <span className="flex flex-col gap-1">
                    {w.stripeCustomerId && (
                      <a href={stripeLink("customers", w.stripeCustomerId)} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">
                        Customer {w.stripeCustomerId}
                      </a>
                    )}
                    {w.stripeSubscriptionId && (
                      <a href={stripeLink("subscriptions", w.stripeSubscriptionId)} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">
                        Subscription {w.stripeSubscriptionId}
                      </a>
                    )}
                  </span>
                ) : (
                  "Not a Stripe customer"
                ),
              ],
              ["Renewal", w.cancelsAt ? `Ends ${day(w.cancelsAt)} (won't renew)` : w.currentPeriodEnd ? `Renews ${day(w.currentPeriodEnd)}` : "None"],
              ...(w.renewalStoppedAt ? ([["Renewal stopped", `${day(w.renewalStoppedAt)}, when the owner closed the account`]] as [string, string][]) : []),
              ["Client seats", `${seats.used} of ${seats.limit} used${w.extraClientSeats ? ` (${w.extraClientSeats} extra bought)` : ""}`],
              ["Staff", `${w.members.length} of ${staffSeatLimit(w)}${w.extraStaffSeats ? ` (${w.extraStaffSeats} extra bought)` : ""}`],
              ["Add-ons", [w.cloudBackup && "Cloud backup", w.aiAssist && `AI summaries${w.aiAssistComplimentary ? " (complimentary)" : ""}`].filter(Boolean).join(", ") || "None"],
              [
                "Free videos used",
                <span key="v" data-testid="videos-used">
                  {w.plan === "FREE" ? `${Math.min(used.used, free)} of ${free}` : `${used.used} (limited to ${free} only on Free)`}
                  {used.uploading ? ` (${used.recorded} finished, ${used.uploading} uploading)` : ""}
                  {w.plan === "FREE" && used.used > free ? `; the count is ${used.used}` : ""}
                </span>,
              ],
              [
                "Suspended",
                w.suspendedAt ? (
                  <span key="s" className="flex flex-col gap-1">
                    <span>Since {utc(w.suspendedAt)}</span>
                    {w.suspendedReason && <span className="whitespace-pre-wrap text-muted">Reason: {w.suspendedReason}</span>}
                    {w.suspendedNote && <span className="whitespace-pre-wrap text-muted">Note to members: {w.suspendedNote}</span>}
                  </span>
                ) : (
                  "No"
                ),
              ],
              ["Closed by support", w.closedAt ? utc(w.closedAt) : "No"],
              [
                "Legal hold",
                w.legalHoldAt ? (
                  <span key="l" className="flex flex-col gap-1">
                    <span>On since {utc(w.legalHoldAt)}: nothing of it is deleted</span>
                    {w.legalHoldReason && <span className="whitespace-pre-wrap text-muted">Reason: {w.legalHoldReason}</span>}
                  </span>
                ) : (
                  "Off"
                ),
              ],
              [
                "Deletion",
                w.deleteAt
                  ? `Scheduled for ${day(w.deleteAt)}${w.closedAt ? " (closed by support)" : " (the owner closed the account)"}${w.legalHoldAt ? ", held while legal hold is on" : ""}`
                  : "Not scheduled",
              ],
              ...(w.keyResetNeeded ? ([["Key reset needed", `${w.keyResetNeeded} left holding the team's keys`]] as [string, string][]) : []),
              ["Created", utc(w.createdAt)],
            ]}
          />
        </div>
      </Section>

      <Section title={`Members (${w.members.length})`}>
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {w.members.map((m) => (
            <li key={m.id}>
              <Link href={`/support/users/${m.user.id}`} className="block p-4 hover:bg-hover">
                <p className="break-all font-medium text-ink">{m.user.email}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span>{m.role === "OWNER" ? "Owner" : m.role === "ADMIN" ? "Admin" : "Member"}</span>
                  {m.pausedAt && <Badge>Paused by the plan</Badge>}
                  {m.user.closedAt ? <Badge tone="red">Login closed</Badge> : m.user.suspendedAt && <Badge tone="red">Login suspended</Badge>}
                  {m.user.deleteAt && !m.user.closedAt && <Badge tone="amber">Closing {day(m.user.deleteAt)}</Badge>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {mine ? (
        <p className="mt-8 rounded-2xl bg-warn-bg p-4 text-sm text-warn-fg">You belong to this workspace, so the support powers can&rsquo;t be used on it.</p>
      ) : (
        <Section title="Support powers">
          <div className="grid gap-3">
            <PowerForm
              power="warn"
              hidden={{ workspaceId: w.id }}
              title="Send a warning"
              intro={`Emails the owner${ownerEmail ? ` (${ownerEmail})` : ""} a warning, with the reason in plain words and how to ask for a review. Nothing else changes.`}
              category
              submit="Send warning"
            >
              <label className="grid gap-1 text-sm text-muted">
                Message in the email (optional)
                <textarea name="message" maxLength={1000} rows={3} className={field} />
              </label>
            </PowerForm>

            {w.closedAt ? (
              <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
                Closed by support. It can be reopened after a review from{" "}
                {owner ? (
                  <Link href={`/support/users/${owner.user.id}`} className="text-accent hover:underline">
                    the owner&rsquo;s page
                  </Link>
                ) : (
                  "the owner's page"
                )}
                .
              </p>
            ) : !w.suspendedAt ? (
              <PowerForm
                power="suspendWorkspace"
                hidden={{ workspaceId: w.id }}
                title="Suspend workspace"
                intro="Members see the suspended page and can't use it, clients see that its videos are unavailable right now, and reminders and emails in its name stop. Nothing is deleted because of it, but recordings without cloud backup still expire and removed clients are still deleted on their dates, unless legal hold is on. Billing carries on unless you stop renewal. If cloud backup ends meanwhile (the plan ends), backed-up recordings wait until it's lifted, then get 30 days."
                category
                notify={emailOwner}
                submit="Suspend"
                danger
              >
                <label className="grid gap-1 text-sm text-muted">
                  Note for members on the suspended page (optional)
                  <textarea name="note" maxLength={1000} rows={2} className={field} />
                </label>
                {w.stripeSubscriptionId && (
                  <Check
                    name="stopRenewal"
                    label="Stop renewal at period end"
                    hint={`The plan ends when the paid period does (no refund). You can turn renewal back on when unsuspending.${w.cloudBackup ? " Cloud backup ends with the plan: backed-up recordings are kept while it's suspended, then deleted 30 days after it's lifted unless backup is renewed." : ""}`}
                  />
                )}
              </PowerForm>
            ) : (
              <PowerForm
                power="unsuspendWorkspace"
                hidden={{ workspaceId: w.id }}
                title="Unsuspend workspace"
                intro="Members and clients can use it again. Reminders that came due while it was suspended aren't sent."
                notify={emailOwner}
                submit="Unsuspend"
              >
                {w.stripeSubscriptionId && w.cancelsAt && (
                  <Check
                    name="resumeRenewal"
                    label="Resume renewal"
                    hint={
                      stoppedBySuspension
                        ? "Renewal was stopped when it was suspended. Turns it back on if the subscription is still running and no payment has been disputed."
                        : "Renewal is off, but not because of the suspension (the owner or a dispute may have stopped it)."
                    }
                    defaultChecked={stoppedBySuspension}
                  />
                )}
              </PowerForm>
            )}

            {!w.legalHoldAt ? (
              <PowerForm
                power="legalHoldOn"
                hidden={{ workspaceId: w.id }}
                title="Legal hold on"
                intro="While it's on, no automatic clean-up deletes anything of this workspace (recordings' expiry, unfinished uploads, removed clients, the account's deletion) and Delete now is refused. Nobody is emailed and the customer isn't told."
                submit="Turn legal hold on"
              />
            ) : (
              <PowerForm
                power="legalHoldOff"
                hidden={{ workspaceId: w.id }}
                title="Legal hold off"
                intro="Anything already past its date is deleted on the next clean-up run. Nobody is emailed."
                submit="Turn legal hold off"
                danger
              />
            )}

            <PowerForm
              power="setVideosRecorded"
              hidden={{ workspaceId: w.id }}
              title="Set free videos used"
              intro={`The count of finished recordings the Free plan's ${free} are checked against (it counts on every plan, and deleting videos never lowers it). It's ${used.recorded} now${used.uploading ? `; ${used.uploading} still uploading count on top` : ""}.`}
              notify={emailOwner}
              submit="Set"
            >
              <label className="grid gap-1 text-sm text-muted">
                Finished videos
                <input name="value" type="number" inputMode="numeric" min={0} step={1} required defaultValue={used.recorded} className={field} />
              </label>
            </PowerForm>

            {(w.stripeCustomerId || w.stripeSubscriptionId) && (
              <PowerForm
                power="resyncBilling"
                hidden={{ workspaceId: w.id }}
                title="Re-sync billing from Stripe"
                intro="Reads the subscription from Stripe and applies it as the webhook does (plan, seats, add-ons, renewal date), for when a webhook was missed. One Stripe no longer has is forgotten, which puts them back on the complimentary plan or Free."
                notify="Email the owner if this pauses clients or staff, or ends cloud backup"
                submit="Re-sync"
              />
            )}

            <PowerForm
              power="seatCheck"
              hidden={{ workspaceId: w.id }}
              title="Re-run the seat check"
              intro="Pauses the newest clients and staff over what the plan covers and restores the rest."
              notify="Email the owner if anyone is newly paused"
              submit="Run seat check"
            />

            {!w.closedAt && owner && (
              <p className="text-sm text-muted">
                To close this account for good, use Close permanently on{" "}
                <Link href={`/support/users/${owner.user.id}`} className="text-accent hover:underline">
                  the owner&rsquo;s page
                </Link>
                .
              </p>
            )}
          </div>
        </Section>
      )}

      <Section title={`Clients (${active.length})`} id="clients">
        {active.length === 0 ? (
          <p className="text-sm text-muted">No clients.</p>
        ) : (
          <ul className="grid gap-3">
            {active.map((c) => (
              <li key={c.id} id={`client-${c.id}`} className="rounded-2xl border border-line bg-surface p-4" data-testid={`client-${c.id}`}>
                <p className="break-words font-medium text-ink">{c.name}</p>
                {c.email && <p className="break-all text-sm text-muted">{c.email}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  {c.linkDisabledAt ? (
                    <Badge tone="red">Link off since {day(c.linkDisabledAt)}</Badge>
                  ) : c.pausedAt ? (
                    <Badge>Paused</Badge>
                  ) : (
                    <Badge tone="green">Link works</Badge>
                  )}
                  {c.linkOpenedAt ? (
                    <span className="text-xs text-dim">Opened their link {day(c.linkOpenedAt)}</span>
                  ) : (
                    <span className="text-xs text-dim">Hasn&rsquo;t opened their link</span>
                  )}
                </div>
                {c.linkDisabledReason && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-dim">Reason: {c.linkDisabledReason}</p>}
                {!mine && (
                  <div className="mt-3">
                    {!c.linkDisabledAt ? (
                      <PowerForm
                        power="linkOff"
                        hidden={{ clientId: c.id }}
                        testId={`power-linkOff-${c.id}`}
                        title="Turn this client's link off"
                        intro="They see “This link has been turned off” and can't open or be sent anything. The business sees Link off and the client keeps their seat. Nothing is deleted."
                        category
                        notify={emailOwner}
                        submit="Turn link off"
                        danger
                      />
                    ) : (
                      <PowerForm
                        power="linkOn"
                        hidden={{ clientId: c.id }}
                        testId={`power-linkOn-${c.id}`}
                        title="Turn this client's link back on"
                        intro="They can open their videos and be sent new ones again, as long as the plan covers them and the account is open."
                        notify={emailOwner}
                        submit="Turn link on"
                      />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Removed clients (${removed.length})`} id="removed">
        {removed.length === 0 ? (
          <p className="text-sm text-muted">None.</p>
        ) : (
          <ul className="grid gap-3">
            {removed.map((c) => {
              const due = !!c.purgeAt && c.purgeAt <= now;
              return (
                <li key={c.id} id={`client-${c.id}`} className="rounded-2xl border border-line bg-surface p-4" data-testid={`removed-${c.id}`}>
                  <p className="break-words font-medium text-ink">{c.name}</p>
                  {c.email && <p className="break-all text-sm text-muted">{c.email}</p>}
                  <p className="mt-1 text-sm text-muted">
                    Removed {day(c.removedAt)}.{" "}
                    {c.purgeAt
                      ? due
                        ? "Being deleted now."
                        : `Deleted for good on ${day(c.purgeAt)}${w.legalHoldAt ? " (held while legal hold is on)" : ""}.`
                      : "No deletion date yet (the clean-up job gives one and tells the owner)."}
                  </p>
                  {c.linkDisabledAt && <p className="mt-1 text-xs text-dim">Their link was turned off by support before they were removed.</p>}
                  {!mine && !due && (
                    <div className="mt-3 grid gap-2">
                      {w.deleteAt ? (
                        <p className="text-sm text-muted">The account is closed, so they can&rsquo;t be restored until it&rsquo;s kept or reopened.</p>
                      ) : (
                        <PowerForm
                          power="restoreClient"
                          hidden={{ clientId: c.id }}
                          testId={`power-restoreClient-${c.id}`}
                          title="Restore"
                          intro="They're a client again. Their link works again, unless the team's keys were reset while they were removed: then they get a new one, emailed to them if they have an address. Needs a free client seat unless you tick below."
                          notify={emailOwner}
                          submit="Restore"
                        >
                          <Check
                            name="ignoreSeatLimit"
                            label="Restore even if every seat is in use"
                            hint="The newest clients over the plan's seats are then paused, which may be someone else."
                          />
                        </PowerForm>
                      )}
                      {c.purgeAt && (
                        <PowerForm
                          power="keepClient"
                          hidden={{ clientId: c.id }}
                          testId={`power-keepClient-${c.id}`}
                          title={`Keep ${CLIENT_KEEP_DAYS} more days`}
                          intro={`Moves their deletion from ${day(c.purgeAt)} to ${day(new Date(c.purgeAt.getTime() + CLIENT_KEEP_DAYS * D))}, so the business has longer to restore them.`}
                          notify={emailOwner}
                          submit={`Keep ${CLIENT_KEEP_DAYS} more days`}
                        />
                      )}
                      {!w.legalHoldAt && (
                        <PowerForm
                          power="deleteClientNow"
                          hidden={{ clientId: c.id }}
                          testId={`power-deleteClientNow-${c.id}`}
                          title="Delete now"
                          intro="Deletes them for good now, as the clean-up job would on their date: their details, the videos sent only to them, their conversations (with the team's replies), to-dos and notes. Recordings also sent to other clients stay with those clients. Can't be undone."
                          confirm={clientDeleteConfirmation(c)}
                          notify={emailOwner}
                          submit="Delete for good"
                          danger
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {tickets.length > 0 && (
        <Section title="Support conversations">
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link href={`/support/${t.id}`} className="block p-4 text-sm hover:bg-hover">
                  <p className="line-clamp-2 break-words text-ink">{t.summary ?? "Conversation"}</p>
                  <p className="mt-1 text-xs text-dim">
                    {t.status.replace("_", " ").toLowerCase()} · {utc(t.updatedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Support log">
        <History rows={history} />
      </Section>
    </main>
  );
}
