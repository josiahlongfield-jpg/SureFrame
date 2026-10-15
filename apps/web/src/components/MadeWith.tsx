import Link from "next/link";
import LogoMark from "./LogoMark";

/**
 * Small credit on pages clients see, so a business's branding never hides
 * where it was made, with the privacy policy and terms that apply to clients too.
 */
export default function MadeWith() {
  return (
    <footer className="py-8 text-center text-xs text-dim">
      <Link href="/?ref=badge" className="inline-flex items-center gap-1.5 hover:text-muted">
        <LogoMark size={14} tone="mono" />
        Made with SureFrame
      </Link>
      <p className="mt-2 space-x-3">
        <Link href="/legal/privacy" className="hover:text-muted">Privacy</Link>
        <Link href="/legal/terms" className="hover:text-muted">Terms</Link>
      </p>
    </footer>
  );
}
