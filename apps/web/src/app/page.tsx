import Link from "next/link";
import { auth } from "@/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import FeatureFrames from "@/components/home/FeatureFrames";
import { Icon } from "@/components/home/icons";
import { points } from "@/components/home/points";
import { BRAND } from "@/lib/brand";
import { CLAUDE_BONUS } from "@/lib/claudeBonus";
import { MAX_TRANSCRIBE_MINUTES } from "@/lib/ai/limits";
import { PLANS } from "@/lib/plans";
import { DATA_LOCATIONS, LEGAL } from "@/lib/legal";
import { RETENTION_DAYS } from "@/lib/retention";

const AUDIENCES = "Coaches, personal trainers, consultants, tutors, agencies, clinics and many more.";

const PRIVACY = [
  ["Encrypted on your device", "Videos, replies, to-dos and notes are locked before they leave your phone or computer. Our servers only hold scrambled copies of them."],
  ["Every client gets their own copy", "Send one video to one client or a hundred. Each opens it from their own personal link, and nobody sees anyone else's replies."],
  // What clients experience when a key reset replaces their link (V9): lib/rekey.ts and lib/newLinkEmail.ts.
  [
    "Staff who leave are locked out",
    `Remove someone from your team and we reset your team's keys and every client's link, so they can't open anything through ${BRAND.name} again. Clients who've opened their link are emailed a new one that works on the device they used before; nothing they have is lost.`,
  ],
];

// The Send step answers its own "why is the first one different?" with a link to the FAQ (V5).
const STEPS: [string, string, { href: string; text: string }?][] = [
  ["Record", "Pick screen, camera, or both. Press start."],
  [
    "Send",
    "Pick a client, or several. Send a new client's first video from your own email or texts. After that, Send by email does it for you.",
    { href: "/faq#first-email", text: "Why the first one comes from you" },
  ],
  ["Reply", "Clients answer with their own video, a voice note or a message. No account needed."],
];

export default async function Home() {
  // "Free" buttons open sign-up; someone already signed in goes straight to the recorder (V8).
  const start = (await auth())?.user ? "/record" : "/signup";
  return (
    <div data-theme="fresh" className="min-h-screen bg-canvas text-ink">
      <SiteHeader navy />
      <main>
        {/* The first screen is navy, like the top bar above it. */}
        <div data-theme="navy" className="navy-glow text-ink">
        <section className="mx-auto grid max-w-[90rem] items-center gap-10 xl:content-center xl:items-stretch px-4 pb-16 pt-6 sm:px-6 sm:pt-10 xl:min-h-[calc(100svh-4.5rem)] xl:grid-cols-[31.25rem_minmax(0,1fr)] xl:gap-14 xl:px-16 xl:pb-10 xl:pt-0">
          <div className="grid content-center gap-4 sm:gap-[1.125rem]">
            <p className="kicker inline-flex items-center gap-2"><span className="h-[0.8125rem] w-[0.8125rem]">{Icon.lockFilled}</span>Private video for you and your clients</p>
            <h1 className="display text-[2.5rem] sm:text-[3.5rem] xl:text-[3.875rem]">
              One take is <span className="text-highlight">all it takes.</span>
            </h1>
            <p className="max-w-[30em] text-[0.9375rem] leading-relaxed text-muted sm:text-[1.0625rem]">Record it once, send it privately, and keep every client on track.</p>
            <div className="flex flex-wrap items-center gap-2.5">
              <Link href={start} className="rounded-[0.625rem] bg-primary px-4 py-3 text-sm font-medium text-on-primary hover:bg-primary-hover sm:px-[1.125rem] sm:text-[0.9375rem]">
                Record your first video, free
              </Link>
              <Link href="/pricing" className="rounded-[0.625rem] border border-line bg-solid px-4 py-3 text-sm font-medium text-on-solid hover:bg-solid-hover sm:px-[1.125rem] sm:text-[0.9375rem]">
                See plans
              </Link>
              <span className="text-[0.8125rem] text-muted max-sm:basis-full sm:ml-1.5" data-testid="hero-free">Free for {PLANS.FREE.clientSeats} clients</span>
            </div>
            <ul className="mt-1 grid gap-x-2.5 gap-y-3 border-t border-line pt-3 min-[480px]:grid-cols-2 sm:mt-3.5 sm:gap-x-[1.375rem] sm:gap-y-3.5 sm:pt-[1.375rem]" data-testid="hero-points">
              {points(RETENTION_DAYS).map((p) => (
                <li key={p.title} className="grid grid-cols-[1.375rem_1fr] items-start gap-x-[0.4375rem] gap-y-0.5 sm:grid-cols-[2.125rem_1fr] sm:gap-x-3">
                  <span className={`row-span-2 grid h-[1.375rem] w-[1.375rem] place-items-center rounded-md sm:h-[2.125rem] sm:w-[2.125rem] sm:rounded-[0.5625rem] [&_svg]:h-[0.8125rem] [&_svg]:w-[0.8125rem] sm:[&_svg]:h-[1.125rem] sm:[&_svg]:w-[1.125rem] bg-primary-soft text-highlight`}>
                    {Icon[p.icon]}
                  </span>
                  <b className="text-[0.78125rem] font-medium leading-tight sm:text-[0.90625rem] sm:font-semibold sm:tracking-[-0.01em]">{p.title}</b>
                  <span className="text-[0.78125rem] leading-snug text-muted">{p.line}</span>
                </li>
              ))}
            </ul>
          </div>
          <FeatureFrames retentionDays={RETENTION_DAYS} />
        </section>
        </div>

        <section className="py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="kicker text-center">How it works</p>
            <h2 className="display mt-3 text-center text-3xl sm:text-4xl">Three steps. That&apos;s it.</h2>
            <ol className="mt-12 grid gap-4 sm:grid-cols-3">
              {STEPS.map(([t, b, more], i) => (
                <li key={t} className="rounded-2xl border border-line border-t-[0.1875rem] border-t-primary bg-surface p-6">
                  <span className="font-mono text-sm font-medium text-highlight">0{i + 1}</span>
                  <h3 className="mt-2 text-lg font-semibold tracking-tight">{t}</h3>
                  <p className="mt-1 text-sm text-muted">
                    {b}
                    {more && (
                      <>
                        {" "}
                        <Link href={more.href} className="font-medium text-accent hover:underline" data-testid="home-step-why">
                          {more.text}
                        </Link>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ol>
            {/* A sample of the client's side, rather than only the mock-up in the demo frame (V11). */}
            <p className="mt-6 text-center text-sm">
              <Link href="/example" className="font-semibold text-accent hover:underline" data-testid="home-example">
                See what your client sees
              </Link>
            </p>
            {/* Said up front as well as by the plans (V6): it's the limit a visitor most needs to know. */}
            <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-muted" data-testid="home-storage">
              Videos are kept on our servers for {RETENTION_DAYS} days after they&rsquo;re recorded, unless you add Cloud backup on a paid plan. Save any video to
              your device to keep your own copy.
            </p>
            <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-muted">{AUDIENCES}</p>
          </div>
        </section>

        <section data-theme="navy" className="bg-canvas py-20 text-ink">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="kicker text-center">Private by design</p>
            <h2 className="display mt-3 text-center text-3xl sm:text-4xl">How we keep it private</h2>
            <div className="mt-12 grid gap-4 sm:grid-cols-3">
              {PRIVACY.map(([t, b]) => (
                <div key={t} className="rounded-2xl border border-line border-t-[0.1875rem] border-t-primary bg-surface p-6">
                  <h3 className="font-semibold tracking-tight">{t}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{b}</p>
                </div>
              ))}
            </div>
            {/* Who's behind it and where data lives, the two things visitors asked about trust (V9, V23). */}
            <p className="mx-auto mt-10 max-w-3xl text-center text-sm leading-6 text-muted" data-testid="home-trust">
              {LEGAL.product} is run from {LEGAL.state}, {LEGAL.country}
              {LEGAL.abn && <> (ABN {LEGAL.abn})</>}. {DATA_LOCATIONS}{" "}
              <Link href="/about" className="font-medium text-ink underline hover:text-highlight">Who runs it and where data is kept</Link>
            </p>
          </div>
        </section>

        <section className="bg-band py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <p className="kicker">AI add-on</p>
            <h2 className="display mt-3 text-3xl sm:text-4xl">Transcripts made on your device.</h2>
            <p className="mt-4 text-muted">
              With the optional AI add-on, videos up to {MAX_TRANSCRIBE_MINUTES} minutes long can get a written transcript and a short summary with key points and
              action items; longer videos don&rsquo;t get one. The
              transcript is made on your own device (it works best on a computer); only its text is sent to write the summary, and both are stored encrypted.
              Available on paid plans. AI summaries can contain mistakes.
            </p>
            <p className="mt-3 text-sm font-medium text-ink">{CLAUDE_BONUS.addOnTeaser}</p>
            <Link href="/pricing#add-ons" className="mt-6 inline-block text-sm font-semibold text-accent hover:underline">
              See plans
            </Link>
          </div>
        </section>

        <section className="py-20" data-testid="home-claude">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <p className="kicker">{CLAUDE_BONUS.kicker}</p>
            <h2 className="display mt-3 text-3xl sm:text-4xl">{CLAUDE_BONUS.title}</h2>
            <p className="mt-4 text-muted">
              {CLAUDE_BONUS.blurb}
            </p>
            <p className="mt-3 font-medium text-ink" data-testid="home-claude-addon">{CLAUDE_BONUS.withAddOn}</p>
            <p className="mt-3 text-sm text-muted">{CLAUDE_BONUS.privacy}</p>
            <p className="mt-3 text-sm text-muted" data-testid="home-claude-separate">{CLAUDE_BONUS.notTheAddOn}</p>
            <Link href="/help/claude" className="mt-6 inline-block text-sm font-semibold text-accent hover:underline">
              How it works
            </Link>
            <p className="mt-6 text-xs text-dim">
              {CLAUDE_BONUS.needs} {CLAUDE_BONUS.trademark}
            </p>
          </div>
        </section>

        <section className="bg-band py-20">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
            <p className="kicker">Studio and Agency</p>
            <h2 className="display mt-3 text-3xl sm:text-4xl">Ready for your whole team</h2>
            <p className="mt-4 text-lg font-medium">Know who&apos;s waiting on a reply. See your whole team&apos;s client follow-up at a glance.</p>
            <p className="mt-4 text-muted">
              Studio includes {PLANS.STUDIO.staffSeats} staff logins and Agency includes {PLANS.AGENCY.staffSeats}, the owner&rsquo;s own login included. Assign clients to staff, choose what each person can see and do, see how the team is keeping up with clients, and keep billing with the owner. Clients never need an account.
            </p>
            <p className="mt-6 font-medium">Free for {PLANS.FREE.clientSeats} clients. Paid plans from US${PLANS.SOLO.priceMonthly} a month.</p>
            <Link href="/pricing" className="mt-6 inline-block rounded-[0.625rem] bg-primary px-6 py-3 font-medium text-on-primary hover:bg-primary-hover">
              See plans
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
