import type { Metadata } from "next";
import { auth } from "@/auth";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { ChatBoundary, SupportChat } from "@/components/SupportChat";
import Link from "next/link";
import { BUSINESS_FAQ, CLIENT_FAQ, FaqList } from "@/components/Faq";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Help",
  description: "Get help with recording, sending videos, clients, billing and your recovery key.",
};

export default async function Help() {
  const signedIn = !!(await auth())?.user;
  return (
    <div data-theme="fresh" className="min-h-screen bg-canvas text-ink">
      <SiteHeader navy />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <p className="kicker">Help</p>
        <h1 className="display mt-3 text-3xl text-ink">How can we help?</h1>
        <p className="mt-2 text-muted">Our assistant answers straight away and passes anything it can&rsquo;t sort out to a person on the team.</p>
        <p className="mt-2 text-sm text-dim" data-testid="reply-time">
          When a person is needed, we reply within 2 business days (Queensland, Australia time), by email and here in the chat.
        </p>
        <p className="mt-2 text-sm text-muted" data-testid="help-email">
          Rather email? Write to <a href={`mailto:${LEGAL.email}`} className="font-medium text-accent hover:underline">{LEGAL.email}</a>. Or{" "}
          <a href="#faq" className="font-medium text-accent hover:underline">browse common questions</a> below.
        </p>
        <div className="mt-8 flex h-[65vh] min-h-[26.25rem] flex-col overflow-hidden rounded-2xl border border-line bg-surface">
          <ChatBoundary>
            <SupportChat signedIn={signedIn} className="flex-1" />
          </ChatBoundary>
        </div>
        <section id="faq" className="mt-12 scroll-mt-20" aria-labelledby="faq-h" data-testid="help-faq">
          <h2 id="faq-h" className="text-xl font-semibold text-ink">Common questions</h2>
          <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-dim">For businesses</h3>
          <div className="mt-3">
            <FaqList items={BUSINESS_FAQ} />
          </div>
          <h3 className="mt-8 text-sm font-semibold uppercase tracking-wide text-dim">For clients</h3>
          <div className="mt-3">
            <FaqList items={CLIENT_FAQ} />
          </div>
          <p className="mt-6 text-sm text-muted">
            Also see the <Link href="/faq" className="font-medium text-accent hover:underline">FAQ page</Link> and{" "}
            <Link href="/about" className="font-medium text-accent hover:underline">About {LEGAL.product}</Link>: who runs it, where data is kept and what&rsquo;s
            encrypted.
          </p>
        </section>
      </main>
      <SiteFooter widget={false} />
    </div>
  );
}
