import Link from "next/link";
import { auth } from "@/auth";
import { BRAND } from "@/lib/brand";
import { LEGAL } from "@/lib/legal";
import SupportWidget from "./SupportChat";

/** `widget={false}` leaves out the floating help chat, for pages that already show the chat. */
export default async function SiteFooter({ widget = true }: { widget?: boolean } = {}) {
  const signedIn = !!(await auth())?.user;
  return (
    <footer className="border-t border-line py-10 text-sm text-dim">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
        <p>© {new Date().getFullYear()} {LEGAL.operator} trading as {BRAND.name}. All rights reserved.{LEGAL.abn && ` ABN ${LEGAL.abn}`}</p>
        <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <Link href="/pricing" className="hover:text-ink">Pricing</Link>
          <Link href="/help" className="hover:text-ink">Help</Link>
          <Link href="/legal/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/legal/terms" className="hover:text-ink">Terms</Link>
          <Link href="/legal/dpa" className="hover:text-ink" title="Data Processing Agreement">DPA</Link>
        </nav>
      </div>
      {widget && <SupportWidget signedIn={signedIn} />}
    </footer>
  );
}
