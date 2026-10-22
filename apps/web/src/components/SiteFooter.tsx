import Link from "next/link";
import { auth } from "@/auth";
import { BRAND } from "@/lib/brand";
import { LEGAL } from "@/lib/legal";
import { db } from "@/lib/db";
import { limitsNote, supportTier } from "@/lib/support/allowance";
import SupportWidget from "./SupportChat";

/** The plan of the workspace a login has open (or its first), without making one. */
async function activePlan(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { activeWorkspaceId: true, memberships: { select: { workspaceId: true, workspace: { select: { plan: true } } } } } });
  const m = u?.memberships.find((x) => x.workspaceId === u.activeWorkspaceId) ?? u?.memberships[0];
  return m?.workspace ?? null;
}

/** `widget={false}` leaves out the floating help chat, for pages that already show the chat. */
export default async function SiteFooter({ widget = true }: { widget?: boolean } = {}) {
  const userId = (await auth())?.user?.id;
  const signedIn = !!userId;
  // The help allowance for people who aren't paying, said in the panel itself. Read without currentUser(), which would
  // make a workspace for a login that has none yet (someone on their way to join a team): that login counts as Free.
  const limits = widget ? limitsNote(signedIn ? supportTier((await activePlan(userId)) ?? { plan: "FREE" }) : "visitor") : null;
  return (
    <footer>
      {/* Navy like the top bar; the help chat stays outside it, in the page's own colours. */}
      <div data-theme="navy" data-site-footer className="bg-canvas-2 py-10 text-sm text-dim">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
        <p>© {new Date().getFullYear()} {BRAND.name}. All rights reserved.{LEGAL.abn && ` ABN ${LEGAL.abn}`}</p>
        <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <Link href="/pricing" className="hover:text-ink">Pricing</Link>
          {/* Help is the chat and contact details, FAQ the written answers: named so it's clear which is which (V26). */}
          <Link href="/help" className="hover:text-ink">Help &amp; contact</Link>
          <Link href="/faq" className="hover:text-ink">FAQ</Link>
          {/* The address itself, for anyone who'd rather just email (V14). */}
          <a href={`mailto:${LEGAL.email}`} className="hover:text-ink [overflow-wrap:anywhere]" data-testid="footer-contact">Contact {LEGAL.email}</a>
          <Link href="/about" className="hover:text-ink">About</Link>
          <Link href="/legal/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/legal/terms" className="hover:text-ink">Terms</Link>
          <Link href="/legal/dpa" className="hover:text-ink" title="Data Processing Agreement">DPA</Link>
        </nav>
      </div>
      </div>
      {widget && <SupportWidget signedIn={signedIn} limits={limits} />}
    </footer>
  );
}
