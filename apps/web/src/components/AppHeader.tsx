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

const LINKS = [
  ["/library", "Library"],
  ["/clients", "Clients"],
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
  return (
    <header className="relative border-b border-line bg-canvas/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl sm:h-[72px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Logo href="/library" tone="dark" />
          {/* Eight links need the room: below xl they sit behind the Menu button. */}
          <nav className="hidden gap-4 text-sm xl:flex">
            <NavLinks links={links} className="" />
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden rounded-full border border-line px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-wider text-muted xl:inline">{plan}</span>
          <span className="hidden text-dim 2xl:inline">{email}</span>
          <Link href="/record" className="rounded-[10px] bg-primary px-4 py-2 font-medium text-white shadow-[0_8px_24px_-10px_rgb(79_110_247/0.9)] hover:bg-primary-hover">
            <span className="sm:hidden">Record</span>
            <span className="hidden sm:inline">New recording</span>
          </Link>
          <div className="hidden xl:block">{signOutForm}</div>
          {/* Phones and small screens: everything else sits behind one Menu button. */}
          <MobileMenu links={links} plan={plan} email={email} signOut={signOutForm} />
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
