import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { mcpResource } from "@/lib/connector/oauth";
import { USE_KEEP_DAYS } from "@/lib/connector/grants";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Use SureFrame with Claude",
  description: "Connect your own Claude to SureFrame to make reports on your clients, replies and to-dos. Read-only, and your encrypted content stays private.",
};

const ASK = [
  "Which clients are waiting for an answer, and for how long?",
  "Make a weekly report for my team: videos sent, opened, and replies waiting.",
  "Which clients haven't had a video in two weeks?",
  "What's overdue this week?",
];

/** How the SureFrame connectors for Claude work (lib/connector). Linked from Settings > Connections and the sign-in metadata. */
export default function HelpClaude() {
  const p = LEGAL.product;
  return (
    <div data-theme="fresh" className="min-h-screen bg-canvas text-ink">
      <SiteHeader navy />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <p className="kicker">Help</p>
        <h1 className="display mt-3 text-3xl text-ink">Use {p} with Claude</h1>
        <p className="mt-3 text-muted">
          Connect your own Claude to {p} and ask it for reports in plain words. It can only read, never send, change or delete anything, and it only
          sees what you can see in {p}. You choose to connect it, and you can disconnect it any time.
        </p>

        <h2 className="mt-10 text-xl font-semibold text-ink">Things to ask</h2>
        <ul className="mt-3 grid list-disc gap-1 pl-5 text-muted">
          {ASK.map((q) => (
            <li key={q}>&ldquo;{q}&rdquo;</li>
          ))}
        </ul>

        <h2 className="mt-10 text-xl font-semibold text-ink">Two ways to connect</h2>
        <div className="mt-4 grid gap-4">
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h3 className="font-semibold text-ink">Online (Claude on the web, phone or computer)</h3>
            <p className="mt-1 text-sm text-muted">
              Reads activity: client names and who looks after them, videos sent and whether they were opened, when clients replied and who&apos;s
              waiting, and to-do due dates. Your messages, replies, notes, to-do text and transcripts are end-to-end encrypted, so this one can&apos;t
              read them, and neither can we.
            </p>
            <p className="mt-2 text-sm text-muted">
              In Claude, open Settings, then Connectors, choose Add custom connector, and paste <code className="break-all text-ink">{mcpResource()}</code>.
              Then choose Connect, sign in to {p} and choose Allow.
            </p>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h3 className="font-semibold text-ink">Claude Desktop (also reads your notes and conversations)</h3>
            <p className="mt-1 text-sm text-muted">
              Install {p} for Claude Desktop from Settings &gt; Connections and paste in a connection code made there. The code holds your team&apos;s
              key, which Claude Desktop keeps in your computer&apos;s keychain. The connector fetches your encrypted to-dos, notes, messages, replies
              and AI summaries and unlocks them on your computer, so {p}&apos;s servers still never see your key or what&apos;s inside.
            </p>
          </section>
        </div>

        <h2 className="mt-10 text-xl font-semibold text-ink">Privacy</h2>
        <ul className="mt-3 grid list-disc gap-2 pl-5 text-sm text-muted">
          <li>What Claude reads goes to Anthropic under your own Claude account and their terms, not ours.</li>
          <li>
            If you use it on your clients&apos; details or conversations, you&apos;re responsible for telling them and for any consent the law needs.
          </li>
          <li>
            We keep a list of which tools each connection used and when (never what they read) for {USE_KEEP_DAYS} days, so you can see it in Settings &gt;
            Connections.
          </li>
          <li>Owners and admins can see and disconnect their staff&apos;s connections.</li>
        </ul>
        <p className="mt-4 text-sm text-muted">
          More in our <Link href="/legal/privacy#own-ai" className="font-medium text-accent hover:underline">Privacy Policy</Link>. Questions?{" "}
          <Link href="/help" className="font-medium text-accent hover:underline">Ask us</Link>.
        </p>
      </main>
      <SiteFooter widget={false} />
    </div>
  );
}
