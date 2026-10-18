import type { Metadata } from "next";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { PLANS } from "@/lib/plans";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Page not found" };

/**
 * Any address with nothing behind it, and pages someone isn't allowed to see (another team's client, the support
 * pages), which are shown as missing rather than forbidden. Plain wording: a missing video has its own page
 * (app/v/[id]/not-found.tsx). Someone signed in keeps the app's own menu.
 */
export default async function NotFound() {
  // currentUser() makes a personal workspace for someone with none, so it's only asked once they have one:
  // someone invited to a team who hits a missing page before joining mustn't end up owning a workspace.
  const userId = (await auth())?.user?.id;
  const me = userId && (await db.membership.count({ where: { userId } })) > 0 ? await currentUser() : null;
  const inApp = !!me && me.agreed && !me.suspended && !me.paused;
  return (
    <div data-theme="fresh" className="flex min-h-screen flex-col bg-canvas text-ink">
      {inApp ? <AppHeader email={me.user.email} plan={PLANS[me.workspace.plan].name} /> : <SiteHeader navy />}
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-ink">Page not found</h1>
        <p className="mt-2 text-sm text-muted" data-testid="not-found-text">
          We couldn&rsquo;t find that page. The address may be mistyped, or the page may have moved.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href={inApp ? "/library" : "/"} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">
            {inApp ? "Go to your Library" : "Go home"}
          </Link>
          <Link href="/help" className="rounded-xl border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-hover">Get help</Link>
        </div>
      </main>
      {/* The app's header brings its own help button. */}
      <SiteFooter widget={!inApp} />
    </div>
  );
}
