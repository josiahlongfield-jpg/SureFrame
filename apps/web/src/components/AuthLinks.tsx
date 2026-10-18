import Link from "next/link";

/** The sign-in pages have no site header or footer, so a few links back to what a hesitant visitor wants to read (V44). */
export default function AuthLinks() {
  const link = "hover:text-ink hover:underline";
  return (
    <nav aria-label="More about SureFrame" className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-line pt-4 text-xs text-dim short:mt-3 short:pt-2">
      <Link href="/pricing" className={link}>Pricing</Link>
      <Link href="/faq" className={link}>FAQ</Link>
      <Link href="/legal/privacy" className={link}>Privacy</Link>
      <Link href="/legal/terms" className={link}>Terms</Link>
    </nav>
  );
}
