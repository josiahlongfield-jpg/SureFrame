import Link from "next/link";
import { signOut } from "@/auth";
import { zoned } from "@/lib/dates";
import { db } from "@/lib/db";
import { dueTodos } from "@/lib/dueTodos";
import { firstStepsFor } from "@/lib/firstSteps";
import { accessOf } from "@/lib/permissions";
import { currentUser } from "@/lib/session";
import { formerTeams, switchableBusinesses } from "@/lib/team";
import { TEAM_PLANS } from "@/lib/plans";
import { limitsNote, supportTier } from "@/lib/support/allowance";
import { MONTHLY_CHANGES } from "@/lib/legal";
import { isSupportAgent } from "@/lib/support/tickets";
import { settingsPages } from "@/lib/settingsMenu";
import ChangesNotice from "./ChangesNotice";
import NamePrompt from "./NamePrompt";
import StaffNotices from "./StaffNotices";
import Logo from "./Logo";
import MobileMenu from "./MobileMenu";
import NavLinks, { SettingsMenu } from "./NavLinks";
import RecoverUploads from "./RecoverUploads";
import RecoveryKeyReminder, { KeyNotKeptNote } from "./RecoveryKey";
import RemovedNotice from "./RemovedNotice";
import SupportWidget from "./SupportChat";
import TimeZoneSync from "./TimeZoneSync";

type Links = (readonly [string, string])[];

/** `widget={false}` leaves out the floating help chat, for /help, which is the chat (V78). */
export default async function AppHeader({ email, plan, widget = true }: { email: string; plan: string; widget?: boolean }) {
  const me = await currentUser();
  const manager = !!me && me.role !== "MEMBER";
  const owner = me?.role === "OWNER";
  const [teamSize, steps, former, notices, due] = me
    ? await Promise.all([
        db.membership.count({ where: { workspaceId: me.workspace.id } }),
        // Only needed to hide the key reminder on the library while the first steps show it.
        owner && !me.workspace.recoveryKeySavedAt && !me.workspace.firstStepsHiddenAt ? firstStepsFor(me) : null,
        // Someone taken off a team, now in a business of their own: say so plainly.
        owner && !me.user.memberships.some((m) => m.role !== "OWNER") ? formerTeams(me.user.id) : [],
        db.staffNotice.findMany({ where: { toUserId: me.user.id, workspaceId: me.workspace.id, dismissedAt: null }, include: { from: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 5 }),
        dueTodos(accessOf(me)).then((d) => d.total),
      ])
    : [1, null, [], [], 0];
  // This month's wording updates (decision 6): owners and admins who agreed before them, until the note's end date, and
  // not while the banner asking them to agree to new versions is showing.
  const changesNotice =
    !!me && manager && me.agreed && !me.termsNotice && Date.now() < MONTHLY_CHANGES.until.getTime() &&
    !!(await db.termsAcceptance.findFirst({ where: { userId: me.user.id, acceptedAt: { lt: MONTHLY_CHANGES.since } }, select: { id: true } }));
  // A team plan keeps its Team pages while the owner is on their own; a business of one on another plan has none.
  const teamPages = teamSize > 1 || (manager && TEAM_PLANS.includes(me.workspace.plan));
  // Clients come first: a business adds them before sending anything.
  // To-dos/Reminders: the team's own list, which clients have some due, and the reminder settings.
  const links: Links = [["/clients", "Clients"], ["/library", "Library"], ["/todos", due ? `To-dos/Reminders (${due} due)` : "To-dos/Reminders"], ...(teamPages ? [["/team", "Team"] as const] : [])];
  // The plan pill opens what can be done about the plan: Billing for those who can change it, else the plans.
  const planHref = manager ? "/settings/billing" : "/pricing";
  // Everything else is under Settings (lib/settingsMenu.ts).
  const settings: Links = me ? settingsPages({ manager, teamSize, plan: me.workspace.plan, workspaces: switchableBusinesses(me.user.memberships, me.workspace.id).length, supportAgent: isSupportAgent(me.user.email), ownsBusiness: me.user.memberships.some((m) => m.role === "OWNER") }).map((p) => [p.href, p.label] as const) : [];
  const signOutForm = (
    <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
      <button className="whitespace-nowrap text-dim hover:text-ink">Sign out</button>
    </form>
  );
  // No backdrop-blur on the header: it would pin the fixed Help button, prompts and dialogs inside it.
  return (
    <header>
      {/* The bar itself is navy; notices, prompts and the help chat below it keep the page's colours.
          It's the menus' anchor, so the phone menu opens right under it, over any banner. */}
      <div data-theme="navy" className="relative z-40 bg-canvas text-ink">
      <div className="mx-auto flex h-16 max-w-6xl sm:h-[4.5rem] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Logo href="/library" tone="dark" />
          <nav className="hidden items-center gap-5 text-sm lg:flex">
            <NavLinks links={links} className="" />
            <SettingsMenu links={settings} />
          </nav>
        </div>
        <div className="flex items-center gap-2 text-sm min-[30rem]:gap-3">
          {/* Shown on phones too (from 384px wide), so the plan is one glance away. */}
          <Link
            href={planHref}
            title={`Your plan: ${plan}. ${manager ? "Open Billing" : "See plans"}`}
            aria-label={`Your plan: ${plan}. ${manager ? "Open Billing" : "See plans"}`}
            data-testid="plan-pill"
            className="hidden rounded-full border border-line px-2.5 py-1 font-mono text-xs font-medium uppercase tracking-wider text-muted hover:border-line-strong hover:text-ink min-[24rem]:inline"
          >
            {plan}
          </Link>
          <Link href="/record" className="whitespace-nowrap rounded-[0.625rem] bg-primary px-4 py-2 font-medium text-on-primary hover:bg-primary-hover">
            <span className="sm:hidden">Record</span>
            <span className="hidden sm:inline">New recording</span>
          </Link>
          <div className="hidden lg:block">{signOutForm}</div>
          {/* Phones and small screens: everything else sits behind one Menu button. */}
          <MobileMenu links={links} settings={settings} plan={plan} planHref={planHref} email={email} signOut={signOutForm} />
        </div>
      </div>
      </div>
      {me?.termsNotice && (
        <p className="border-t border-warn-line bg-warn-bg px-4 py-2 text-center text-sm text-warn-fg" data-testid="terms-notice">
          We&apos;ve updated our Terms of Service and Privacy Policy
          {me.termsNotice.from ? `, and they apply to you from ${zoned(me.workspace.timezone).longDay(me.termsNotice.from)}` : ""}.{" "}
          <Link href="/agree" className="font-medium underline">
            Read and agree
          </Link>
        </p>
      )}
      {changesNotice && me && <ChangesNotice userId={me.user.id} month={MONTHLY_CHANGES.month} monthKey={MONTHLY_CHANGES.key} />}
      <StaffNotices
        initial={notices.map((n) => ({ id: n.id, from: n.from.name ?? n.from.email.split("@")[0], message: n.message, link: n.link, linkLabel: n.linkLabel, createdAt: n.createdAt.toISOString() }))}
      />
      {former.length > 0 && teamSize === 1 && <RemovedNotice teams={former} />}
      <RecoverUploads />
      {/* Owners give their name in the welcome step (app/welcome); staff are asked here. */}
      {me && !owner && !me.user.name && <NamePrompt />}
      {me && owner && !me.workspace.recoveryKeySavedAt ? (
        // On the library the first steps show the key instead (components/FirstSteps.tsx).
        <RecoveryKeyReminder workspaceId={me.workspace.id} fingerprint={me.workspace.keyFingerprint} business={me.workspace.name} hiddenOn={steps ? "/library" : null} />
      ) : me && !me.paused && !me.membership.recoveryKeySavedAt ? (
        // Staff save the team's key too, and everyone saves the new one after a key reset (lib/rekey.ts).
        <RecoveryKeyReminder
          workspaceId={me.workspace.id}
          fingerprint={me.workspace.keyFingerprint}
          business={me.workspace.name}
          hiddenOn={null}
          note={owner ? "Your team's keys were reset, so your recovery key changed. Save the new one: you need it to open your videos on another device." : undefined}
          shared={!owner}
        />
      ) : me && !me.paused ? (
        <KeyNotKeptNote workspaceId={me.workspace.id} />
      ) : null}
      {/* The business's zone is only set once they've agreed to the terms (the API refuses it before). */}
      {me && <TimeZoneSync shownZone={zoned(me.workspace.timezone).zone} setWorkspace={manager && !me.workspace.timezone && me.agreed} />}
      {widget && <SupportWidget signedIn limits={limitsNote(supportTier(me?.workspace))} />}
    </header>
  );
}
