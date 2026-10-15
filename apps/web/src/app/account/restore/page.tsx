import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import Logo from "@/components/Logo";
import { restoreAccount } from "@/lib/accountDeletion";
import { zoned } from "@/lib/dates";
import { db } from "@/lib/db";
import { LEGAL } from "@/lib/legal";
import { PLANS } from "@/lib/plans";
import { purgeDate, RETENTION_DAYS } from "@/lib/retention";
import { currentUser, HttpError, pendingDeletion } from "@/lib/session";

export const metadata: Metadata = { title: "Keep your account", robots: { index: false } };

/**
 * Where a closed account lands after signing in again (lib/accountDeletion.ts):
 * keep it, or carry on with the deletion. Only a sign-in made after the account
 * was closed can keep it, so a browser left signed in somewhere else can't.
 */
export default async function Restore() {
  const closed = await pendingDeletion();
  if (!closed) redirect((await currentUser()) ? "/library" : "/login?next=/account/restore");

  async function keep() {
    "use server";
    const me = await pendingDeletion();
    if (!me) redirect("/library");
    if (!me.fresh) redirect("/account/restore");
    let planEnded = false;
    try {
      ({ planEnded } = await restoreAccount(me.id));
    } catch (err) {
      // Its date passed while the page was open, or support closed or suspended it meanwhile.
      if (err instanceof HttpError && (err.status === 410 || err.status === 403)) redirect("/account/restore");
      throw err;
    }
    redirect(planEnded ? "/library?restored=ended" : "/library?restored=1");
  }

  async function leaveClosed() {
    "use server";
    await signOut({ redirectTo: "/login?closed=1" });
  }

  const now = new Date();
  const ws = await db.workspace.findFirst({ where: { deleteAt: { not: null }, members: { some: { userId: closed.id } } } });
  // Cloud backup that ended while it was closed: their 30 days start once it's kept (lib/backupEnded.ts).
  const waiting = ws && !ws.cloudBackup ? await db.video.count({ where: { workspaceId: ws.id, status: { not: "EXPIRED" }, purgeAt: null, replyToId: null, sourceId: null } }) : 0;
  // Teams they were staff on: closing the account took them off.
  const leftTeams = await db.invite.findMany({
    where: { acceptedById: closed.id, workspace: { members: { none: { userId: closed.id } } } },
    select: { workspace: { select: { name: true } } },
    distinct: ["workspaceId"],
  });
  const dates = zoned(ws?.timezone);
  const teams = [...new Set(leftTeams.map((i) => i.workspace.name))];
  const signOutButton = (label: string, primary = false) => (
    <form action={leaveClosed}>
      <button className={primary ? "rounded-xl bg-primary px-4 py-2.5 font-semibold text-on-primary hover:bg-primary-hover" : "rounded-xl border border-line-strong px-4 py-2.5 font-semibold text-ink hover:bg-hover"}>
        {label}
      </button>
    </form>
  );

  return (
    <main data-theme="fresh" className="text-ink mx-auto max-w-md px-4 py-16 sm:px-6">
      <Logo tone="dark" />
      {closed.closedAt || closed.suspendedAt ? (
        <>
          <h1 className="mt-10 text-2xl font-semibold tracking-tight text-ink">{closed.closedAt ? "Your account has been closed" : "This account is suspended"}</h1>
          <p className="mt-3 text-muted" data-testid="restore-by-support">
            {closed.closedAt ? (
              <>SureFrame support closed this account on {dates.longDay(closed.closedAt)}, and it will be deleted for good on {dates.longDay(closed.deleteAt)}, unless the law requires us to keep it longer. It can&apos;t be kept from here.</>
            ) : (
              <>Your SureFrame login has been suspended, so this account can&apos;t be kept from here. It is scheduled for deletion on {dates.longDay(closed.deleteAt)}.</>
            )}{" "}
            If you think this is a mistake, email{" "}
            <a href={`mailto:${LEGAL.email}`} className="font-medium text-accent hover:underline">{LEGAL.email}</a>
            {closed.closedAt ? ` within ${LEGAL.reviewDays} days of the closure to ask for a review.` : "."}
          </p>
          <div className="mt-6">{signOutButton("Sign out")}</div>
        </>
      ) : !closed.fresh ? (
        <>
          <h1 className="mt-10 text-2xl font-semibold tracking-tight text-ink">Sign in again to keep your account</h1>
          <p className="mt-3 text-muted">
            Your account is closed and scheduled for deletion. To keep it, sign in again on this device first.
          </p>
          <Link href="/login?next=/account/restore" className="mt-6 inline-block rounded-xl bg-primary px-4 py-2.5 font-semibold text-on-primary hover:bg-primary-hover">
            Sign in
          </Link>
        </>
      ) : closed.deleteAt <= now ? (
        <>
          <h1 className="mt-10 text-2xl font-semibold tracking-tight text-ink">Your account is being deleted</h1>
          <p className="mt-3 text-muted" data-testid="restore-too-late">
            It reached its deletion date, so it can no longer be kept. If you think this is a mistake, email{" "}
            <a href={`mailto:${LEGAL.email}`} className="font-medium text-accent hover:underline">{LEGAL.email}</a> straight away.
          </p>
          <div className="mt-6">{signOutButton("Sign out")}</div>
        </>
      ) : (
        <>
          <h1 className="mt-10 text-2xl font-semibold tracking-tight text-ink">Your account is scheduled for deletion on {dates.longDay(closed.deleteAt)}</h1>
          <p className="mt-3 text-muted" data-testid="restore-message">
            You closed it{closed.deletionRequestedAt ? ` on ${dates.longDay(closed.deletionRequestedAt)}` : ""}.
            {ws ? <> Keep it and {ws.name} carries on as it was, with its recordings, clients, to-dos and notes.</> : <> Keep it and you can carry on using it.</>}
          </p>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted">
            {ws && <li>Your clients&apos; links work again, for the clients your plan covers.</li>}
            {ws?.renewalStoppedAt &&
              (ws.stripeSubscriptionId ? (
                <li>Your {PLANS[ws.plan].name} plan renews as normal again.</li>
              ) : (
                <li>Your subscription has ended. Choose a plan in Settings &gt; Billing to get your paid features back; until then, clients your plan doesn&apos;t cover stay paused.</li>
              ))}
            {ws && !ws.cloudBackup && <li>Recordings that expired from our servers while it was closed can&apos;t be brought back.</li>}
            {ws && <li data-testid="restore-removed-clients">Removed clients whose 30 days ended while it was closed have been deleted and can&apos;t be restored.</li>}
            {waiting > 0 && (
              <li data-testid="restore-backup-ended">
                Cloud backup ended while it was closed. Keep it and our copies of {waiting === 1 ? "1 recording" : `${waiting} recordings`} are deleted{" "}
                {RETENTION_DAYS} days later, on {dates.longDay(purgeDate(false, now)!)}, unless you subscribe again with cloud backup or save them to your device.
              </li>
            )}
            {teams.length > 0 && (
              <li>Keeping it won&apos;t put you back on {teams.join(" and ")}; ask {teams.length === 1 ? "them" : "each team"} for a new invite.</li>
            )}
          </ul>
          <p className="mt-4 text-sm text-muted">Continue signs you out and leaves your account closed. It&apos;s deleted for good on {dates.longDay(closed.deleteAt)}.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <form action={keep}>
              <button className="rounded-xl bg-primary px-4 py-2.5 font-semibold text-on-primary hover:bg-primary-hover">Keep my account</button>
            </form>
            {signOutButton("Continue")}
          </div>
        </>
      )}
    </main>
  );
}
