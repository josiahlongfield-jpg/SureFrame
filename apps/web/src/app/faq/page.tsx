import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { BUSINESS_FAQ, CLIENT_FAQ, FaqList } from "@/components/Faq";
import OpenFaqFromHash from "@/components/OpenFaqFromHash";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers about plans, how long videos are kept, the recovery key, sending to clients, and what clients see and can do.",
};

export default function Faq() {
  return (
    <div data-theme="fresh" className="min-h-screen bg-canvas text-ink">
      <SiteHeader navy />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="kicker">FAQ</p>
        <h1 className="display mt-3 text-3xl text-ink sm:text-4xl">Questions and answers</h1>
        <p className="mt-3 text-muted">
          Can&rsquo;t find what you need? Ask in <Link href="/help" className="font-medium text-accent hover:underline">Help</Link> or email{" "}
          <a href={`mailto:${LEGAL.email}`} className="font-medium text-accent hover:underline">{LEGAL.email}</a>.
        </p>
        <h2 id="businesses" className="mt-10 scroll-mt-20 text-xl font-semibold text-ink">For businesses</h2>
        <div className="mt-4">
          <FaqList items={BUSINESS_FAQ} />
        </div>
        <h2 id="clients" className="mt-10 scroll-mt-20 text-xl font-semibold text-ink">For clients</h2>
        <div className="mt-4">
          <FaqList items={CLIENT_FAQ} />
        </div>
        <p className="mt-10 text-sm text-muted">
          Who runs {LEGAL.product}, where data is kept and what&rsquo;s encrypted: <Link href="/about" className="font-medium text-accent hover:underline">About {LEGAL.product}</Link>.
        </p>
      </main>
      <OpenFaqFromHash />
      <SiteFooter />
    </div>
  );
}
