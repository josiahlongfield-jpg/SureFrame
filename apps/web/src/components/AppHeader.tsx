import Link from "next/link";
import { signOut } from "@/auth";
import { zoned } from "@/lib/dates";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import NamePrompt from "./NamePrompt";
import StaffNotices from "./StaffNotices";
import Logo from "./Logo";
import MobileMenu from "./MobileMenu";
import NavLinks from "./NavLinks";
import RecoverUploads from "./RecoverUploads";
import SupportWidget from "./SupportChat";

// Clients come first: a business adds them before sending anything.
const LINKS = [
  ["/clients", "Clients"],
  ["/library", "Library"],
  ["/settings/team", "Team"],
  ["/settings/reminders", "Reminders"],
  ["/settings/branding", "Branding"],
  ["/settings/billing", "Billing"],
  ["/settings/account", "Account"],
] as const;

export default async function AppHeader({ email, plan }: { email: string; plan: string }) {
  const me = await currentUser();
  const named = !me || !!me.user.name;
  // Owners and admins get the Team overview; everyone gets reminders sent to them.
  const links = me && me.role !== "MEMBER" ? [LINKS[0], LINKS[1], ["/team", "Overview"] as const, ...LINKS.slice(2)] : LINKS;
  const notices = me
    ? await db.staffNotice.findMany({ where: { toUserId: me.user.id, workspaceId: me.workspace.id, dismissedAt: null }, include: { from: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 5 })
    : [];
  const signOutForm = (
    <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
      <button className="whitespace-nowrap text-dim hover:text-ink">Sign out</button>
    </form>
  );
  // No backdrop-blur on the header: it would pin the fixed Help button, prompts and dialogs inside it.
  return (
    <header className="relative">
      {/* The bar itself is navy; notices, prompts and the help chat below it keep the page's colours. */}
      <div data-theme="navy" className="bg-canvas text-ink">
      <div className="mx-auto flex h-16 max-w-6xl sm:h-[4.5rem] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Logo href="/library" tone="dark" />
          {/* Eight links need the room: below xl they sit behind the Menu button. */}
          <nav className="hidden gap-4 text-sm xl:flex">
            <NavLinks links={links} className="" />
          </nav>
        </div>
        <div className="flex items-center gap-2 text-sm min-[24rem]:gap-3">
          <span className="hidden rounded-full border border-line px-2.5 py-1 font-mono text-[0.6875rem] font-medium uppercase tracking-wider text-muted xl:inline">{plan}</span>
          <Link href="/record" className="whitespace-nowrap rounded-[0.625rem] bg-primary px-4 py-2 font-medium text-on-primary hover:bg-primary-hover">
            <span className="sm:hidden">Record</span>
            <span className="hidden sm:inline">New recording</span>
          </Link>
          <div className="hidden xl:block">{signOutForm}</div>
          {/* Phones and small screens: everything else sits behind one Menu button. */}
          <MobileMenu links={links} plan={plan} email={email} signOut={signOutForm} />
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
      <StaffNotices
        initial={notices.map((n) => ({ id: n.id, from: n.from.name ?? n.from.email.split("@")[0], message: n.message, link: n.link, linkLabel: n.linkLabel, createdAt: n.createdAt.toISOString() }))}
      />
      <RecoverUploads />
      {!named && <NamePrompt />}
      <SupportWidget signedIn />
    </header>
  );
}
