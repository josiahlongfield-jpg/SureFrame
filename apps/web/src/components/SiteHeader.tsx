import Link from "next/link";
import { auth } from "@/auth";
import Logo from "./Logo";

/**
 * The navy top bar. `navy` is for marketing pages (wider); app-style pages leave it off. `away`: a signed-in person who
 * can't use the app right now (suspended, or paused staff) gets one link back to that page instead of Library and New recording.
 */
export default async function SiteHeader({ navy = false, away }: { navy?: boolean; away?: "/suspended" | "/paused" } = {}) {
  const signedIn = !!(await auth())?.user;
  const link = "whitespace-nowrap rounded-lg px-2 py-2 text-muted hover:text-ink sm:px-3";
  return (
    <header data-theme="navy" className="sticky top-0 z-20 bg-canvas text-ink">
      <div className={`mx-auto flex items-center justify-between px-4 sm:px-6 ${navy ? "h-[3.75rem] max-w-[90rem] sm:h-[4.5rem] xl:px-16" : "h-16 max-w-6xl"}`}>
        <Logo tone="dark" />
        <nav className="flex items-center gap-1 text-sm sm:gap-3">
          {/* Left to the footer on the narrowest phones (under 375px), so the bar never scrolls sideways. */}
          <Link href="/pricing" className={`${link} max-[374px]:hidden`}>Pricing</Link>
          {signedIn && away ? (
            <Link href={away} className={link} data-testid="header-away">Back to your account</Link>
          ) : signedIn ? (
            <Link href="/library" className={link}>Library</Link>
          ) : (
            <Link href="/login" className={link}>Sign in</Link>
          )}
          {/* "Start free" (sign-up) is only for people without an account, and says the same on a phone (V66, V8). Signed in it's
              the app's own button, short on phones, so the bar fits a 360px screen. */}
          {signedIn && away ? null : signedIn ? (
            <Link href="/record" className="whitespace-nowrap rounded-[0.625rem] bg-primary px-3 py-2 font-medium text-on-primary hover:bg-primary-hover sm:px-4">
              <span className="sm:hidden">Record</span>
              <span className="hidden sm:inline">New recording</span>
            </Link>
          ) : (
            <Link href="/signup" className="whitespace-nowrap rounded-[0.625rem] bg-primary px-3 py-2 font-medium text-on-primary hover:bg-primary-hover sm:px-4">
              Start free
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
