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
import { zoned } from "@/lib/dates";
import { db } from "@/lib/db";
import { LEGAL } from "@/lib/legal";
import { PLANS } from "@/lib/plans";
import { HttpError, requirePageUser } from "@/lib/session";
import { cookies } from "next/headers";
import { ACTIVITY_COOKIE, KEEP_COOKIE, KEEP_DAYS, activityCookie, keepCookie } from "@/lib/activity";

export const metadata: Metadata = { title: "Account" };

export default async function AccountSettings({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  // Before agreeing to the current terms (lib/terms.ts), only the data download and account deletion are here.
  const { user, workspace, role, membership, paused, agreed } = await requirePageUser("/settings/account", { allowPaused: true, allowTermsPending: true });
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
  const teamNames = mine.filter((m) => m.role !== "OWNER" && m.workspace._count.members > 1).map((m) => m.workspace.name);
  // Deleted for good this long after closing, unless they sign in and keep it (lib/accountDeletion.ts).
  const deletesOn = zoned(ownWorkspace?.timezone).longDay(deletionDate());
  // "Keep me signed in on this device" (lib/activity.ts), for this browser.
  const kept = (await cookies()).get(KEEP_COOKIE)?.value === "1";

  // Turned on or off here while signed in, the same as ticking the box at sign-in, from now.
  async function keepDevice(form: FormData) {
    "use server";
    await requirePageUser("/settings/account", { allowPaused: true, allowTermsPending: true });
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

  async function remove(form: FormData) {
    "use server";
    const { user } = await requirePageUser("/settings/account", { allowPaused: true, allowTermsPending: true });
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

        <section className="mt-6 rounded-2xl border border-danger-line bg-surface p-6">
          <h2 className="font-semibold text-danger-fg">Delete account</h2>
          <p className="mt-1 text-sm text-muted" data-testid="delete-explainer">
            Nothing is scheduled yet. If you delete your account, it&apos;s closed straight away and permanently deleted {DELETION_GRACE_DAYS} days later (on{" "}
            {deletesOn} if you delete it today). Until then, you can sign in to keep it with everything as it was.
            {ownsAlone && (
              <> Your workspace goes with it: its recordings, clients, to-dos and notes. Your clients&apos; links stop working now{ownWorkspace.stripeSubscriptionId ? <>, your plan won&apos;t renew</> : null}, recordings without cloud backup still expire on their usual dates, and removed clients are still deleted on their dates.</>
            )}
            {teamNames.length > 0 && (
              <> You leave {teamNames.join(" and ")} straight away, and keeping your account won&apos;t put you back. Recordings you made for {teamNames.length === 1 ? "that team" : "those teams"} stay with {teamNames.length === 1 ? "it" : "them"}, and {teamNames.length === 1 ? "its" : "their"} clients aren&apos;t affected.</>
            )}
            {" "}Want it deleted sooner? Email <a href={`mailto:${LEGAL.email}`} className="font-medium text-accent hover:underline">{LEGAL.email}</a>.
          </p>
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
