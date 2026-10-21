import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { DATA_LOCATIONS, LEGAL, SUBPROCESSORS } from "@/lib/legal";
import { RETENTION_DAYS } from "@/lib/retention";

export const metadata: Metadata = {
  title: "About and contact",
  description: "Who runs SureFrame, how to contact us, where data is kept, what's end-to-end encrypted, and what the recovery key is.",
};

/*
 * Who runs SureFrame and how it handles data, in plain words. Everything here is taken from the Privacy Policy and Terms
 * (lib/legal.ts for the business and its providers), so change those first. The business is named, never the owner.
 */

const ENCRYPTED = [
  "Videos and video or voice replies",
  "Video stills (the preview pictures of each video)",
  "Text replies",
  "To-dos and notes",
  "AI transcripts and summaries, for businesses that use them",
];
const NOT_ENCRYPTED = [
  "Video titles",
  "Client names and email addresses",
  "The names shown on replies, and emoji reactions",
  "To-do due dates, repeat and reminder settings, and the reminder message a business writes",
  "Reminders owners and admins send to staff",
  "When things were created or sent, and who they were sent to",
  `Help chat messages (questions typed into the help chat on client pages are kept as text for ${LEGAL.clientQuestionDays} days)`,
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-2xl border border-line bg-surface p-6" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-muted [&_a]:font-medium [&_a]:text-accent [&_a]:underline">{children}</div>
    </section>
  );
}

export default function About() {
  const mail = <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;
  return (
    <div data-theme="fresh" className="min-h-screen bg-canvas text-ink">
      <SiteHeader navy />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="kicker">About</p>
        <h1 className="display mt-3 text-3xl text-ink sm:text-4xl">About {LEGAL.product}</h1>
        <p className="mt-3 text-muted">Private video messaging between a business and its clients, end-to-end encrypted in the browser.</p>
        <div className="mt-8 grid gap-6">
          <Section id="who" title="Who runs it">
            <p data-testid="about-operator">
              Made in {LEGAL.state}. {LEGAL.product} is a registered business name{LEGAL.abn && <> (ABN {LEGAL.abn})</>} of a sole trader who builds it, runs
              it and answers support.
            </p>
            {LEGAL.postalAddress && <p>Postal address: {LEGAL.postalAddress}.</p>}
          </Section>

          <Section id="contact" title="Contact">
            <p>
              Email {mail}, or ask in <Link href="/help">Help</Link>, where our assistant answers straight away and you can choose Talk to a person (with limits
              for visitors and the Free plan). When a person is needed, we reply within 2 business days (Queensland, Australia time).
            </p>
            <p>
              Answers to common questions are in the <Link href="/faq">FAQ</Link>.
            </p>
          </Section>

          <Section id="data" title="Where data is kept">
            <p>
              We run {LEGAL.product} from Australia. {DATA_LOCATIONS} Encrypted content stays encrypted wherever it&rsquo;s stored.
            </p>
            <ul className="space-y-1">
              {SUBPROCESSORS.map((s) => (
                <li key={s.name} className="ml-5 list-disc">
                  <span className="font-medium text-ink">{s.name}</span>, {s.purpose}
                  {s.location && <>: {s.location}</>}
                </li>
              ))}
            </ul>
            <p>
              Payments are handled by Link, Stripe&rsquo;s merchant-of-record service, under its own privacy policy; we never see your card. More detail is in our{" "}
              <Link href="/legal/privacy">Privacy Policy</Link> and, for businesses, the <Link href="/legal/dpa">Data Processing Agreement</Link>.
            </p>
          </Section>

          <Section id="encryption" title="What's encrypted, and what isn't">
            <p>
              These are encrypted on your device before they reach us, and the keys stay with you, your team and your clients. We can&rsquo;t open them, and neither
              can anyone we work with:
            </p>
            <ul className="space-y-1">
              {ENCRYPTED.map((x) => (
                <li key={x} className="ml-5 list-disc">{x}</li>
              ))}
            </ul>
            <p>These aren&rsquo;t end-to-end encrypted, because we need to read them to show your library and send emails and reminders:</p>
            <ul className="space-y-1">
              {NOT_ENCRYPTED.map((x) => (
                <li key={x} className="ml-5 list-disc">{x}</li>
              ))}
            </ul>
            <p>
              Everything travels over encrypted connections. For businesses that switch on AI summaries, the text of a video&rsquo;s transcript (never the audio or
              video) is sent to Anthropic to write the summary. Without cloud backup, our encrypted copy of a video is deleted {RETENTION_DAYS} days after it&rsquo;s
              recorded.
            </p>
          </Section>

          <Section id="recovery-key" title="Your recovery key">
            <p>
              Each workspace has a recovery key. It unlocks your videos on a new phone or computer, or in another browser, because each browser keeps its own copy of
              your keys. You&rsquo;re shown it when you set up your account, and again any time from Settings &gt; Account (Show recovery key) on a device that&rsquo;s
              already unlocked.
            </p>
            <p>
              If you lose it, a device that&rsquo;s still unlocked keeps working, and you can show the key again there. If no device is unlocked any more, nobody,
              including us, can open your old videos, because we never have the key. Keep it somewhere safe and private.
            </p>
          </Section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
