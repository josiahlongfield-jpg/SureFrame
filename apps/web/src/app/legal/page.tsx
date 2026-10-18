import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Legal",
  description: "SureFrame's Terms of Service, Privacy Policy and Data Processing Agreement, and earlier versions of them.",
};

const DOCS = [
  { href: "/legal/terms", title: "Terms of Service", line: "The agreement for using SureFrame: plans, billing, cancelling, and what you and we are responsible for.", updated: LEGAL.termsUpdated },
  { href: "/legal/privacy", title: "Privacy Policy", line: "What information we collect, why, who handles it, where it's kept and for how long.", updated: LEGAL.privacyUpdated },
  { href: "/legal/dpa", title: "Data Processing Agreement", line: "For businesses: how we handle the client information you put into SureFrame.", updated: LEGAL.dpaUpdated },
  { href: "/legal/archive", title: "Earlier versions", line: "Each version of the Terms and Privacy Policy people have agreed to, and what changed.", updated: null },
];

/** /legal itself: the legal documents in one list, for anyone who trims a document's address. */
export default function Legal() {
  return (
    <div data-theme="fresh" className="min-h-screen bg-canvas text-ink">
      <SiteHeader navy />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Legal</h1>
        <ul className="mt-8 grid gap-3" data-testid="legal-index">
          {DOCS.map((d) => (
            <li key={d.href}>
              <Link href={d.href} className="block rounded-2xl border border-line bg-surface p-5 hover:bg-hover">
                <span className="font-semibold text-ink">{d.title}</span>
                <span className="mt-1 block text-sm text-muted">{d.line}</span>
                {d.updated && <span className="mt-1 block text-xs text-dim">Last updated {d.updated}</span>}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-sm text-muted">
          Questions about any of these? Email{" "}
          <a href={`mailto:${LEGAL.email}`} className="font-medium text-accent hover:underline">{LEGAL.email}</a>.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
