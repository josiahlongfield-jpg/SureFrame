import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import AppHeader from "@/components/AppHeader";
import ShowRecoveryKey from "@/components/ShowRecoveryKey";
import DeleteAccountButton from "@/components/DeleteAccountButton";
import ManageBillingButton from "@/components/ManageBillingButton";
import MyEmailPrefs from "@/components/MyEmailPrefs";
import ReadableExport from "@/components/ReadableExport";
import { NotifyPrefs } from "@/components/TeamOverview";
import { permsOf } from "@/lib/permissions";
import Link from "next/link";
import { signOut } from "@/auth";
import { DELETION_GRACE_DAYS, deletionDate, requestAccountDeletion } from "@/lib/accountDeletion";
import { leaveTeam, leaverName } from "@/lib/account";
import LeaveTeamButton from "@/components/LeaveTeamButton";
import { zoned } from "@/lib/dates";
import { db } from "@/lib/db";
import { LEGAL } from "@/lib/legal";
import { PLANS } from "@/lib/plans";
import { HttpError, requirePageUser } from "@/lib/session";
import { cookies } from "next/headers";
import { appUrl } from "@/lib/appUrl";
import { EMAIL_BLOCKED, isEmailBlocked } from "@/lib/blockedEmail";
import { plainEmail } from "@/lib/emailAddress";
import { EMAIL_CHANGE_HOURS, emailChangeConfirmEmail, emailChangeNoticeEmail, emailChangeToken } from "@/lib/emailChange";
import { sendMail } from "@/lib/mail";
import { rateLimit } from "@/lib/rateLimit";
import { ACTIVITY_COOKIE, KEEP_COOKIE, KEEP_DAYS, activityCookie, keepCookie } from "@/lib/activity";

export const metadata: Metadata = { title: "Account" };

export default async function AccountSettings({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; to?: string }> }) {
  const { error, saved, to: sentTo } = await searchParams;
  const to = sentTo ? plainEmail(sentTo) : null;
  // Before agreeing to the current terms (lib/terms.ts), only the data download and account deletion are here.
  const { user, workspace, role, membership, paused, agreed } = await requirePageUser("/settings/account", { allowPaused: true, allowTermsPending: "existing" });
  const limited = paused || !agreed;
  const onTeam = role === "MEMBER" || (await db.membership.count({ where: { workspaceId: workspace.id } })) > 1;
  // Owners and admins choose here which client replies and staff activity they're emailed about.
  const staff = onTeam && role !== "MEMBER"
    ? (await db.membership.findMany({ where: { workspaceId: workspace.id }, include: { user: true }, orderBy: { id: "asc" } })).map((m) => ({
        userId: m.userId, name: m.user.name ?? m.user.email.split("@")[0], email: m.user.email, role: m.role, perms: permsOf(m),
        own: { replyEmails: m.replyNotify !== "OFF", ownDefaults: false, message: false, replyTo: null },
      }))
    : [];
  // What deleting the account does depends on whether they run a workspace of their own or work on someone else's team.
  const mine = await db.membership.findMany({ where: { userId: user.id }, include: { workspace: { select: { name: true, timezone: true, stripeSubscriptionId: true, _count: { select: { members: true } } } } } });
  const ownWorkspace = mine.find((m) => m.role === "OWNER" && m.workspace._count.members === 1)?.workspace;
  const ownsAlone = !!ownWorkspace;
  const teams = mine.filter((m) => m.role !== "OWNER" && m.workspace._count.members > 1);
  const teamNames = teams.map((m) => m.workspace.name);
  // Deleted for good this long after closing, unless they sign in and keep it (lib/accountDeletion.ts).
  const deletesOn = zoned(ownWorkspace?.timezone).longDay(deletionDate());
  // "Keep me signed in on this device" (lib/activity.ts), for this browser.
  const kept = (await cookies()).get(KEEP_COOKIE)?.value === "1";

  // Turned on or off here while signed in, the same as ticking the box at sign-in, from now.
  async function keepDevice(form: FormData) {
    "use server";
    await requirePageUser("/settings/account", { allowPaused: true, allowTermsPending: "existing" });
    const on = form.get("keep") === "1";
    const jar = await cookies();
    jar.set(ACTIVITY_COOKIE, String(Date.now()), activityCookie(undefined, on));
    if (on) jar.set(KEEP_COOKIE, "1", keepCookie());
    else jar.delete(KEEP_COOKIE);
    redirect("/settings/account?saved=device#device");
  }

  async function rename(form: FormData) {
    "use server";
    const { user } = await requirePageUser("/settings/account", { allowPaused: true });
    const name = String(form.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) redirect("/settings/account?error=name#name");
    await db.user.update({ where: { id: user.id }, data: { name } });
    revalidatePath("/", "layout");
    redirect("/settings/account?saved=name#name");
  }

  // A new sign-in email (O104): a link to the new address makes the change (app/account/email), and the old one is told.
  async function changeEmail(form: FormData) {
    "use server";
    const { user } = await requirePageUser("/settings/account", { allowPaused: true });
    const to = plainEmail(String(form.get("email") ?? ""));
    if (!to) redirect("/settings/account?error=email-bad#email");
    if (to === user.email.toLowerCase()) redirect("/settings/account?error=email-same#email");
    if (await isEmailBlocked(to)) redirect("/settings/account?error=email-blocked#email");
    if (await db.user.findUnique({ where: { email: to }, select: { id: true } })) redirect("/settings/account?error=email-taken#email");
    try {
      await rateLimit(`email-change:${user.id}`, 5, 3600);
    } catch {
      redirect("/settings/account?error=email-rate#email");
    }
    const link = appUrl(`/account/email?t=${encodeURIComponent(emailChangeToken(user.id, user.email, to))}`);
    try {
      await sendMail({ to, ...emailChangeConfirmEmail(link, user.email, to) });
    } catch {
      redirect("/settings/account?error=email-send#email");
    }
    await sendMail({ to: user.email, ...emailChangeNoticeEmail("asked", user.email, to) }).catch(() => {});
    redirect(`/settings/account?saved=email-sent&to=${encodeURIComponent(to)}#email`);
  }

  // Leaving a team you work for, keeping your login (S40): the same steps as when staff close their account.
  async function leave(form: FormData) {
    "use server";
    const { user } = await requirePageUser("/settings/account", { allowPaused: true, allowTermsPending: "existing" });
    const workspaceId = String(form.get("workspaceId") ?? "");
    const m = await db.membership.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId } }, include: { workspace: true } });
    if (!m || m.role === "OWNER") redirect("/settings/account?error=leave#leave-result");
    await leaveTeam(user.id, m.workspace, leaverName(user), { chose: true });
    revalidatePath("/", "layout");
    // With no business of their own yet, the next page is the welcome step for one, which says they've left.
    if (!user.onboardedAt && !(await db.membership.count({ where: { userId: user.id } }))) redirect("/welcome?left=1");
    redirect("/settings/account?saved=left#leave-result");
  }

  async function remove(form: FormData) {
    "use server";
    const { user } = await requirePageUser("/settings/account", { allowPaused: true, allowTermsPending: "existing" });
    const typed = String(form.get("confirm") ?? "").trim().toLowerCase();
    if (typed !== user.email.toLowerCase()) redirect("/settings/account?error=confirm");
    let refused: "team" | "failed" | null = null;
    try {
      // Closed now (signed out everywhere, clients' links stop), deleted for good 30 days later unless kept.
      await requestAccountDeletion(user.id);
    } catch (err) {
      // An owner leaving would strand their staff in a workspace nobody pays for.
      refused = err instanceof HttpError && err.status === 409 ? "team" : "failed";
      if (refused === "failed") console.log("[account] close failed", JSON.stringify({ user: user.id, error: String(err) }));
    }
    if (refused) redirect(`/settings/account?error=${refused}`);
    await signOut({ redirectTo: "/login?deleted=1" });
  }

  return (
    <>
      {limited ? (
        <p className="mx-auto max-w-3xl px-4 pt-6 text-sm sm:px-6">
          <Link href={paused ? "/paused" : "/agree"} className="font-medium text-accent hover:underline">&larr; Back</Link>
        </p>
      ) : (
        <AppHeader email={user.email} plan={PLANS[workspace.plan].name} />
      )}
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Account</h1>
        <p className="mt-1 text-sm text-dim">Signed in as {user.email}</p>

        <section id="email" className="mt-6 rounded-2xl border border-line bg-surface p-6" data-testid="sign-in-email">
          <h2 className="font-semibold text-ink">Sign-in email</h2>
          <p className="mt-1 text-sm text-muted">
            You sign in with <span className="font-medium text-ink">{user.email}</span>. Changed your email? Enter the new one: we email it a link, and the change
            happens when you open that link. Your videos, clients and settings stay as they are.
          </p>
          {saved === "email-sent" ? (
            <p role="status" className="mt-3 rounded-xl border border-ok-line bg-ok-bg p-3 text-sm text-ok-fg" data-testid="email-change-sent">
              Check {to ? <span className="font-medium">{to}</span> : "your new address"} for the link. It works for {EMAIL_CHANGE_HOURS} hours. Until you open it, you keep signing in with {user.email}.
            </p>
          ) : saved === "email" ? (
            <p role="status" className="mt-3 text-sm text-ok-fg" data-testid="email-changed">Done. You now sign in with {user.email}.</p>
          ) : null}
          <form action={changeEmail} className="mt-4 flex flex-wrap gap-2">
            <input name="email" type="email" required autoComplete="email" aria-label="New sign-in email" placeholder="New email address"
              className="min-w-0 flex-1 rounded-xl border border-line-strong px-3 py-2 text-sm" data-testid="new-email" />
            <button className="rounded-xl border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-hover" data-testid="change-email">Email me a link</button>
          </form>
          {error?.startsWith("email-") && (
            <p role="alert" className="mt-2 text-sm text-danger-fg" data-testid="email-change-error">
              {error === "email-bad"
                ? "That email address doesn't look right. Check it and try again."
                : error === "email-same"
                  ? "That's the email you sign in with already."
                  : error === "email-taken"
                    ? "That email already has its own SureFrame account, so it can't be used for this one. Sign in with it to use or delete that account first."
                    : error === "email-blocked"
                      ? EMAIL_BLOCKED
                      : error === "email-rate"
                        ? "Too many links asked for in the last hour. Check that inbox (and its spam folder), or try again later."
                        : error === "email-link"
                          ? "That link has ended or was already used. Enter the new address again for a fresh one."
                          : "We couldn't send the email just now. Please try again in a few minutes."}
            </p>
          )}
        </section>

        {agreed && <section id="name" className="mt-6 rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-semibold text-ink">Your name</h2>
          <p className="mt-1 text-sm text-muted">
            Clients see it on the videos you send, as &ldquo;{user.name || "Your name"} from {workspace.name}&rdquo;. Your team sees it too.
          </p>
          <form action={rename} className="mt-4 flex flex-wrap gap-2">
            <input name="name" defaultValue={user.name ?? ""} required maxLength={80} autoComplete="name" aria-label="Your name" placeholder="Your name"
              className="min-w-0 flex-1 rounded-xl border border-line-strong px-3 py-2 text-sm" />
            <button className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">Save name</button>
          </form>
          {saved === "name" && <p role="status" className="mt-2 text-sm text-ok-fg">Saved.</p>}
          {error === "name" && <p className="mt-2 text-sm text-danger-fg">Enter your name.</p>}
        </section>}

        {!onTeam && !limited && role === "OWNER" && (
          <section id="emails" className="mt-6 rounded-2xl border border-line bg-surface p-6">
            <h2 className="font-semibold text-ink">Emails to you</h2>
            <MyEmailPrefs initial={{ replyEmails: membership.replyNotify !== "OFF" }} owner />
          </section>
        )}
        {onTeam && !limited && (role === "MEMBER" ? (
          <section id="emails" className="mt-6 rounded-2xl border border-line bg-surface p-6">
            <h2 className="font-semibold text-ink">Emails to you</h2>
            <MyEmailPrefs initial={{ replyEmails: membership?.replyNotify !== "OFF" }} />
          </section>
        ) : (
          <section id="emails" className="mt-6">
            <h2 className="font-semibold text-ink">Emails to you</h2>
            <p className="mb-3 mt-1 text-sm text-muted">Which client replies and staff activity you&apos;re emailed about. Each person on the team chooses their own.</p>
            <NotifyPrefs
              meId={user.id}
              staff={staff}
              initial={{ replyNotify: membership.replyNotify, replyNotifyStaff: membership.replyNotifyStaff, sentNotify: membership.sentNotify, sentNotifyStaff: membership.sentNotifyStaff }}
            />
          </section>
        ))}

        <section id="device" className="mt-6 rounded-2xl border border-line bg-surface p-6" data-testid="keep-device">
          <h2 className="font-semibold text-ink">This device</h2>
          {kept ? (
            <p className="mt-1 text-sm text-muted" data-testid="keep-device-on">
              <span className="font-medium text-ok-fg">Kept signed in.</span> Closing the browser, a crash or switching off doesn&apos;t sign you out here, for {KEEP_DAYS} days from when it was turned on.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted" data-testid="keep-device-off">
              You&apos;re signed out here when you close the browser or after 8 hours without using SureFrame. On a device you don&apos;t share, you can stay signed in for {KEEP_DAYS} days.
            </p>
          )}
          <form action={keepDevice} className="mt-4">
            <input type="hidden" name="keep" value={kept ? "0" : "1"} />
            <button
              className={kept ? "rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover" : "rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-hover"}
              data-testid="keep-device-toggle"
            >
              {kept ? "Stop keeping me signed in here" : "Keep me signed in on this device"}
            </button>
            {saved === "device" && <span className="ml-3 text-sm text-ok-fg" role="status">Saved.</span>}
          </form>
        </section>

        {!limited && (
          <section className="mt-6 rounded-2xl border border-line bg-surface p-6" data-testid="account-claude">
            <h2 className="font-semibold text-ink">Use {LEGAL.product} with Claude <span className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">Free bonus</span></h2>
            <p className="mt-1 text-sm text-muted">Already use Claude, Anthropic&apos;s AI assistant? Connect it for client reports, follow-up lists and more. It only reads, and only what you can see.</p>
            <Link href="/settings/connections" className="mt-3 inline-block text-sm font-semibold text-accent hover:underline">Set it up in Connections</Link>
          </section>
        )}

        {!limited && <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-semibold text-ink" id="recovery-key">Recovery key</h2>
          <p className="mt-1 text-sm text-muted">
            Use this to unlock your videos on a phone or another computer. Keep it private: anyone signed in to your account with it can open your videos.
          </p>
          <ShowRecoveryKey workspaceId={workspace.id} fingerprint={workspace.keyFingerprint} business={workspace.name} />
        </section>}

        {!agreed && role === "OWNER" && workspace.stripeCustomerId && (
          <section className="mt-6 rounded-2xl border border-line bg-surface p-6" data-testid="account-subscription">
            <h2 className="font-semibold text-ink">Subscription</h2>
            <p className="mt-1 mb-4 text-sm text-muted">Manage or cancel your subscription, see invoices or update your card.</p>
            <ManageBillingButton />
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-semibold text-ink">Download your data</h2>
          <p className="mt-1 text-sm text-muted">
            Your account, clients, videos list, to-dos, notes and replies. The readable copy is a web page that opens in any browser and prints: to-dos, notes and
            replies are end-to-end encrypted, so it&apos;s made here in your browser with your team&apos;s key, and nothing readable is sent to us. The JSON
            versions are for moving your data to another app. Download videos themselves from each video&apos;s page.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ReadableExport />
            <a href="/api/account/export" className="rounded-xl border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-hover">
              Download as stored (encrypted)
            </a>
          </div>
        </section>

        {saved === "left" && (
          <p id="leave-result" role="status" className="mt-6 rounded-xl border border-ok-line bg-ok-bg p-3 text-sm text-ok-fg" data-testid="left-team">
            You&apos;ve left the team. Its owner and admins have been emailed. Your login still works for a business of your own, free.
          </p>
        )}
        {error === "leave" && (
          <p id="leave-result" role="alert" className="mt-6 text-sm text-danger-fg">You&apos;re not on that team any more, or you own it.</p>
        )}
        {teams.length > 0 && (
          <section id="leave-team" className="mt-6 rounded-2xl border border-line bg-surface p-6" data-testid="leave-team">
            <h2 className="font-semibold text-ink">Leave {teamNames.length === 1 ? teamNames[0] : "a team"}</h2>
            <p className="mt-1 text-sm text-muted">
              Only want to stop working with {teamNames.length === 1 ? "this team" : "one of these teams"}? Leave it here and keep your login. Recordings you made for it stay
              with it, and its owner and admins are emailed. To come back, you&apos;d need a new invite.
            </p>
            {teams.map((t) => (
              <form key={t.workspaceId} action={leave} className="mt-4">
                <input type="hidden" name="workspaceId" value={t.workspaceId} />
                <LeaveTeamButton team={t.workspace.name} />
              </form>
            ))}
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-danger-line bg-surface p-6">
          <h2 className="font-semibold text-danger-fg">Delete account</h2>
          {/* Short paragraphs, one per thing affected, so your own workspace and a team you work for don't run together (S40). */}
          <div className="mt-1 grid gap-2 text-sm text-muted" data-testid="delete-explainer">
            <p>
              Nothing is scheduled yet. If you delete your account, it&apos;s closed straight away and permanently deleted {DELETION_GRACE_DAYS} days later (on{" "}
              {deletesOn} if you delete it today). Until then, you can sign in to keep it with everything as it was.
            </p>
            {(ownsAlone || teamNames.length > 0) && (
              <ul className="list-disc space-y-1 pl-5">
                {ownsAlone && (
                  <li data-testid="delete-own"> Your workspace goes with it: its recordings, clients, to-dos and notes. Your clients&apos; links stop working now{ownWorkspace.stripeSubscriptionId ? <>, your plan won&apos;t renew</> : null}, recordings without cloud backup still expire on their usual dates, and removed clients are still deleted on their dates.</li>
                )}
                {teamNames.length > 0 && (
                  <li data-testid="delete-team"> You leave {teamNames.join(" and ")} straight away, and keeping your account won&apos;t put you back. Recordings you made for {teamNames.length === 1 ? "that team" : "those teams"} stay with {teamNames.length === 1 ? "it" : "them"}, and {teamNames.length === 1 ? "its" : "their"} clients aren&apos;t affected.</li>
                )}
              </ul>
            )}
            <p>
              Want it deleted sooner? Email <a href={`mailto:${LEGAL.email}`} className="font-medium text-accent hover:underline">{LEGAL.email}</a>.
            </p>
          </div>
          <form action={remove} className="mt-4 space-y-3">
            {error === "confirm" && <p role="alert" className="text-sm text-danger-fg">That doesn&apos;t match your email.</p>}
            {error === "failed" && <p role="alert" className="text-sm text-danger-fg">Your account couldn&apos;t be closed just now (we must stop any subscription first). Please try again in a few minutes, or ask in Help.</p>}
            {error === "team" && <p role="alert" className="text-sm text-danger-fg">You own a team with other staff. Remove them on the Team page first.</p>}
            <DeleteAccountButton email={user.email} />
          </form>
        </section>
      </main>
    </>
  );
}
