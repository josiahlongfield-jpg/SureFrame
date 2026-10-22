import Link from "next/link";
import { auth } from "@/auth";
import Logo from "./Logo";
import SiteMenu from "./SiteMenu";

/** The navy top bar. `navy` is for marketing pages (wider); app-style pages leave it off. */
export default async function SiteHeader({ navy = false }: { navy?: boolean } = {}) {
  const signedIn = !!(await auth())?.user;
  const link = "whitespace-nowrap rounded-lg px-2 py-2 text-muted hover:text-ink sm:px-3";
  return (
    <header data-theme="navy" className="sticky top-0 z-20 bg-canvas text-ink">
      <div className={`mx-auto flex items-center justify-between px-4 sm:px-6 ${navy ? "h-[3.75rem] max-w-[90rem] sm:h-[4.5rem] xl:px-16" : "h-16 max-w-6xl"}`}>
        <Logo tone="dark" />
        <nav className="flex items-center gap-1 text-sm sm:gap-3">
          {/* On the narrowest phones (under 375px) these two go in the small menu at the end, so the bar never scrolls sideways (R2-V67). */}
          <Link href="/pricing" className={`${link} max-[375px]:hidden`}>Pricing</Link>
          {signedIn ? (
            <Link href="/library" className={`${link} max-[375px]:hidden`}>Library</Link>
          ) : (
            <Link href="/login" className={`${link} max-[375px]:hidden`}>Sign in</Link>
          )}
          {/* "Start free" (sign-up) is only for people without an account, and says the same on a phone (V66, V8). Signed in it's
              the app's own button, short on phones, so the bar fits a 360px screen. */}
          {signedIn ? (
            <Link href="/record" className="whitespace-nowrap rounded-[0.625rem] bg-primary px-3 py-2 font-medium text-on-primary hover:bg-primary-hover sm:px-4">
              <span className="sm:hidden">Record</span>
              <span className="hidden sm:inline">New recording</span>
            </Link>
          ) : (
            <Link href="/signup" className="whitespace-nowrap rounded-[0.625rem] bg-primary px-3 py-2 font-medium text-on-primary hover:bg-primary-hover sm:px-4">
              Start free
            </Link>
          )}
          <SiteMenu links={[["/pricing", "Pricing"], signedIn ? ["/library", "Library"] : ["/login", "Sign in"]]} />
        </nav>
      </div>
    </header>
  );
}
