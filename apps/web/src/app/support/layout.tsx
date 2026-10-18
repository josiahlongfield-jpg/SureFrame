import Link from "next/link";
import { notFound } from "next/navigation";
import { auth, signOut } from "@/auth";
import Logo from "@/components/Logo";
import { db } from "@/lib/db";
import { isFounder, isSupportAdmin } from "@/lib/support/admin";
import { isSupportAgent } from "@/lib/support/tickets";
import SupportNav from "./_console/SupportNav";

/**
 * The frame of every support page: SureFrame's navy bar with a way back to the app, then one row of
 * links. Anyone signed in who doesn't answer support gets the site's not-found page, with a real 404 since
 * it's refused here, before the loading screen streams; signed out, the page sends them to sign in.
 */
export default async function SupportLayout({ children }: { children: React.ReactNode }) {
  const id = (await auth())?.user?.id;
  const me = id ? await db.user.findUnique({ where: { id }, select: { email: true } }) : null;
  if (!me) return children;
  if (!isSupportAgent(me.email)) notFound();
  const admin = isSupportAdmin(me.email);
  const links = [
    ["/support", "Inbox"],
    ...(admin ? ([["/support/lookup", "Look up"], ["/support/log", "Support log"]] as const) : []),
    ["/support/accounts", "Free plans"],
    ...(isFounder(me.email) ? ([["/support/offers", "Discounts"]] as const) : []),
  ] as const;
  return (
    <>
      <header data-theme="navy" className="bg-canvas text-ink">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo href="/library" tone="dark" />
            <span className="hidden rounded-full border border-line px-2.5 py-1 font-mono text-[0.6875rem] font-medium uppercase tracking-wider text-muted min-[26rem]:inline">
              Support
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm sm:gap-4">
            <Link href="/library" className="whitespace-nowrap text-muted hover:text-ink" data-testid="back-to-app">
              <span aria-hidden>← </span>
              <span className="max-sm:hidden">Back to the app</span>
              <span className="sm:hidden">App</span>
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button className="whitespace-nowrap text-dim hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <SupportNav links={links} />
        </div>
      </div>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}
