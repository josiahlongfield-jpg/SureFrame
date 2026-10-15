import type { Metadata } from "next";
import { auth } from "@/auth";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { ChatBoundary, SupportChat } from "@/components/SupportChat";

export const metadata: Metadata = {
  title: "Help",
  description: "Get help with recording, sending videos, clients, billing and your recovery key.",
};

export default async function Help() {
  const signedIn = !!(await auth())?.user;
  return (
    <div data-theme="navy" className="navy-glow min-h-screen text-ink">
      <SiteHeader navy />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <p className="kicker">Help</p>
          <h1 className="display mt-3 text-3xl   text-ink">How can we help?</h1>
        <p className="mt-2 text-muted">Our assistant answers straight away and passes anything it can&rsquo;t sort out to a person on the team.</p>
        <p className="mt-2 text-sm text-dim" data-testid="reply-time">
          When a person is needed, we reply within 2 business days (Queensland, Australia time), by email and here in the chat.
        </p>
        <div className="mt-8 flex h-[65vh] min-h-[26.25rem] flex-col overflow-hidden rounded-2xl border border-line bg-surface">
          <ChatBoundary>
            <SupportChat signedIn={signedIn} className="flex-1" />
          </ChatBoundary>
        </div>
      </main>
      <SiteFooter widget={false} />
    </div>
  );
}
