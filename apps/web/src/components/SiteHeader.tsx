import Link from "next/link";
import { auth } from "@/auth";
import Logo from "./Logo";

/** `navy` is for pages in SureFrame's dark navy look; the colours come from the page's theme. */
export default async function SiteHeader({ navy = false }: { navy?: boolean } = {}) {
  const signedIn = !!(await auth())?.user;
  const link = "whitespace-nowrap rounded-lg px-2 py-2 text-muted hover:text-ink sm:px-3";
  return (
    <header className={`sticky top-0 z-20 backdrop-blur ${navy ? "bg-canvas/70" : "border-b border-line bg-surface/80"}`}>
      <div className={`mx-auto flex items-center justify-between px-4 sm:px-6 ${navy ? "h-[3.75rem] max-w-[90rem] sm:h-[4.5rem] xl:px-16" : "h-16 max-w-6xl"}`}>
        <Logo tone={navy ? "dark" : "light"} />
        <nav className="flex items-center gap-1 text-sm sm:gap-3">
          {navy && <Link href="/#features" className={`${link} max-sm:hidden`}>Features</Link>}
          {/* Left to the footer on the narrowest phones (under 360px), so the bar never scrolls sideways. */}
          <Link href="/pricing" className={`${link} max-[359px]:hidden`}>Pricing</Link>
          {signedIn ? (
            <Link href="/library" className={link}>Library</Link>
          ) : (
            <Link href="/login" className={link}>Sign in</Link>
          )}
          {/* Short on phones, as in the app's header, so the bar fits a 360px screen. */}
          <Link href="/record" className={`whitespace-nowrap rounded-[0.625rem] bg-primary px-3 py-2 font-medium text-on-primary hover:bg-primary-hover sm:px-4`}>
            <span className="sm:hidden">Record</span>
            <span className="hidden sm:inline">{navy ? "Start free" : "Start recording"}</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
