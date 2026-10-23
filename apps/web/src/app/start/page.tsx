import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import Logo from "@/components/Logo";
import DeleteAccountButton from "@/components/DeleteAccountButton";
import StartBusiness, { WaitForBusiness } from "@/components/StartBusiness";
import { DELETION_GRACE_DAYS, requestAccountDeletion } from "@/lib/accountDeletion";
import { BRAND } from "@/lib/brand";
import { db } from "@/lib/db";
import { JOINING_COOKIE } from "@/lib/joining";
import { PAID_PLANS, type PaidPlan } from "@/lib/plans";
import { agreePath, HttpError, mayStartFree } from "@/lib/session";
import { formerTeams, hashToken } from "@/lib/team";
import { hasAgreed } from "@/lib/terms";

export const metadata: Metadata = { title: "Start your own business", robots: { index: false } };

/**
 * Starting a business of your own when you joined a team from an invite (Decision 4, Josiah, 22 October 2026): staff
 * get no Free business of their own (lib/session.ts mayStartFree), so theirs starts on a paid plan, and the business is
 * made once it's paid (lib/newBusiness.ts). Reached from Settings (Start your own business), Account and Switch business
 * by staff on a team, and it's where a login with no team and no business lands (someone signed in on the way to join,
 * or removed from or leaving their only team). Doesn't use currentUser(), which is the team they work in, or nothing.
 */
export default async function Start({ searchParams }: { searchParams: Promise<{ paid?: string; left?: string; plan?: string; error?: string; restored?: string }> }) {
  const { paid, left, plan, error, restored } = await searchParams;
  const userId = (await auth())?.user?.id;
  const user = userId
    ? await db.user.findUnique({ where: { id: userId }, include: { memberships: { include: { workspace: { select: { name: true } } }, orderBy: { id: "asc" } } } })
    : null;
  if (!user || user.deleteAt) redirect("/login?next=/start");
  if (user.suspendedAt || user.closedAt) redirect("/suspended");
  // A business of their own already (just paid for, or from signing up themselves): its own pages, and the welcome step.
  if (user.memberships.some((m) => m.role === "OWNER")) redirect("/library");
  // Signed up on their own, with nothing yet: their Free business is made on the way in, as always.
  if (!user.memberships.length && (await mayStartFree(user.id))) redirect("/library");
  if (!(await hasAgreed(user.id))) redirect(agreePath("/start"));

  const teams = user.memberships.map((m) => m.workspace.name);
  const former = teams.length ? [] : await formerTeams(user.id);
  // On the way to join a team from an invite in this browser (components/JoinTeam.tsx): back to it.
  const token = (await cookies()).get(JOINING_COOKIE)?.value;
  const invite = token && !teams.length ? await db.invite.findUnique({ where: { tokenHash: hashToken(token) }, include: { workspace: { select: { name: true } } } }) : null;
  const joinable = invite && !invite.revokedAt && !invite.acceptedAt && invite.expiresAt > new Date() ? invite : null;
  const picked = PAID_PLANS.includes(plan as PaidPlan) ? (plan as PaidPlan) : null;

  async function remove(form: FormData) {
    "use server";
    const id = (await auth())?.user?.id;
    const me = id ? await db.user.findUnique({ where: { id }, include: { _count: { select: { memberships: true } } } }) : null;
    if (!me || me.deleteAt) redirect("/login");
    // Only a login with nothing else: anyone on a team or with a business closes it from Settings > Account.
    if (me._count.memberships) redirect("/settings/account#delete");
    if (String(form.get("confirm") ?? "").trim().toLowerCase() !== me.email.toLowerCase()) redirect("/start?error=confirm");
    try {
      await requestAccountDeletion(me.id);
    } catch (err) {
      if (!(err instanceof HttpError)) console.log("[account] close failed", JSON.stringify({ user: me.id, error: String(err) }));
      redirect("/start?error=failed");
    }
    await signOut({ redirectTo: "/login?deleted=1" });
  }

  return (
    <main data-theme="fresh" className="text-ink mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-16">
      <Logo href="/start" />
      {paid ? (
        <div role="status" className="mt-8 rounded-2xl border border-ok-line bg-ok-bg p-5 text-sm text-ok-fg" data-testid="start-paid">
          <p className="font-semibold">Thanks, your payment went through.</p>
          <p className="mt-1">We&apos;re setting up your business. This page moves on by itself as soon as it&apos;s ready.</p>
          <WaitForBusiness />
        </div>
      ) : null}
      {restored && (
        <p role="status" className="mt-8 rounded-2xl border border-ok-line bg-ok-bg p-5 text-sm text-ok-fg" data-testid="account-restored">
          Your account is open again.
        </p>
      )}
      {joinable && (
        <div role="status" className="mt-8 rounded-2xl border border-primary-line bg-primary-soft p-5 text-sm text-ink" data-testid="start-joining">
          <p className="font-semibold">Joining {joinable.workspace.name}?</p>
          <p className="mt-1">You haven&apos;t joined yet. Go back to your invite and press Agree and join.</p>
          <a href={`/join/${token}`} className="mt-2 inline-block font-medium text-accent hover:underline">
            Back to the invite
          </a>
        </div>
      )}
      {former.length > 0 && (
        <div role="status" className="mt-8 rounded-2xl border border-warn-line bg-warn-bg p-5 text-sm text-warn-fg" data-testid="removed-from-team">
          <p className="font-semibold">
            {left ? "You've left" : "You're no longer on"} {former.map((t) => t.name).join(" or ")}&apos;s team
          </p>
          {/* Left by their own choice on Settings > Account (S40), or taken off by an owner or admin. */}
          <p className="mt-1">
            {left
              ? "Its owner and admins have been emailed. To come back, you'd need a new invite link."
              : "An owner or admin removed you, so you can't open that team's videos or clients any more. If that's a mistake, ask them for a new invite link."}
          </p>
        </div>
      )}
      <h1 className="mt-10 text-2xl font-semibold tracking-tight text-ink" data-testid="start-heading">
        Start your own business
      </h1>
      <p className="mt-3 text-muted" data-testid="start-lead">
        {teams.length
          ? `Your own business is separate from ${teams.length === 1 ? `${teams[0]}'s team` : "the teams you work in"}, with its own clients, plan and recovery key.`
          : "Your own business has its own clients, plan and recovery key."}{" "}
        Staff logins don&apos;t come with a Free plan of their own, so your business starts on one of these paid plans. You can change or cancel it later in
        Settings &gt; Billing.
      </p>
      <StartBusiness picked={picked} />
      {teams.length > 0 && (
        <p className="mt-6 text-sm">
          <Link href="/library" className="font-medium text-accent hover:underline">
            Back to {teams.length === 1 ? teams[0] : "your team"}
          </Link>
        </p>
      )}
      <div className="mt-10 border-t border-line pt-6 text-sm text-muted">
        <p>
          Signed in as {user.email}.{" "}
          {!teams.length && !joinable && `Joining a team instead? Open the invite link you were sent, in this browser.`}
        </p>
        <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }} className="mt-3">
          <button className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover">Sign out</button>
        </form>
        {!teams.length && (
          <details className="mt-6" data-testid="start-delete" open={!!error}>
            <summary className="cursor-pointer font-medium text-ink">Delete this login</summary>
            <p className="mt-2">
              Don&apos;t need {BRAND.name} any more? Delete your login. It&apos;s closed straight away and deleted for good {DELETION_GRACE_DAYS} days later, unless you sign in again
              before then to keep it.
            </p>
            <form action={remove} className="mt-3 grid gap-3">
              <DeleteAccountButton email={user.email} />
            </form>
            {error && (
              <p role="alert" className="mt-2 text-danger-fg">
                {error === "confirm" ? "Type your email address exactly as shown to delete your login." : "We couldn't delete your login just now. Please try again, or email support."}
              </p>
            )}
          </details>
        )}
      </div>
    </main>
  );
}
