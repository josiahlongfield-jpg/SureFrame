import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import FeatureFrames from "@/components/home/FeatureFrames";
import { Icon } from "@/components/home/icons";
import { points } from "@/components/home/points";
import { BRAND } from "@/lib/brand";
import { RETENTION_DAYS } from "@/lib/retention";

const AUDIENCES = "Coaches, personal trainers, consultants, tutors, agencies, clinics and many more.";

const PRIVACY = [
  ["Encrypted on your device", "Videos, replies, to-dos and notes are locked before they leave your phone or computer. Our servers only hold scrambled copies of them."],
  ["Every client gets their own copy", "Send one video to one client or a hundred. Each opens it from their own private link, and nobody sees anyone else's replies."],
  ["Staff who leave are locked out", `Remove someone from your team and your team's keys and every client link are reset, so they can't open anything through ${BRAND.name} again.`],
];

const STEPS = [
  ["Record", "Pick screen, camera, or both. Press start."],
  ["Send", "Pick a client, or several at once. Only they can open it, from their own private link."],
  ["Reply", "Clients answer with their own video, a voice note or a message. No account needed."],
];

export default function Home() {
  return (
    <div data-theme="navy" className="navy-glow min-h-screen text-ink">
      <SiteHeader navy />
      <main>
        <section className="mx-auto grid max-w-[90rem] items-center gap-10 px-4 pb-16 pt-6 sm:px-6 sm:pt-10 xl:min-h-[calc(100svh-4.5rem)] xl:grid-cols-[31.25rem_minmax(0,1fr)] xl:gap-14 xl:px-16 xl:pb-10 xl:pt-0">
          <div className="grid content-center gap-4 sm:gap-[1.125rem]">
            <p className="kicker inline-flex items-center gap-2"><span className="h-[0.8125rem] w-[0.8125rem]">{Icon.lockFilled}</span>Private video for you and your clients</p>
            <h1 className="display text-[2.5rem] sm:text-[3.5rem] xl:text-[3.875rem]">
              One take is <span className="text-highlight">all it takes.</span>
            </h1>
            <p className="max-w-[30em] text-[0.9375rem] leading-relaxed text-muted sm:text-[1.0625rem]">Record it once, send it privately, and keep every client on track.</p>
            <div className="flex flex-wrap items-center gap-2.5">
              <Link href="/record" className="rounded-[0.625rem] bg-primary px-4 py-3 text-sm font-medium text-on-primary shadow-[0_0.5rem_1.5rem_-0.625rem_rgb(79_110_247/0.9)] hover:bg-primary-hover sm:px-[1.125rem] sm:text-[0.9375rem]">
                Record your first video, free
              </Link>
              <Link href="/pricing" className="rounded-[0.625rem] border border-line bg-solid px-4 py-3 text-sm font-medium text-on-solid hover:bg-solid-hover sm:px-[1.125rem] sm:text-[0.9375rem]">
                See pricing
              </Link>
              <span className="ml-1.5 text-[0.8125rem] text-muted max-sm:hidden">Free for 3 clients</span>
            </div>
            <ul className="mt-1 grid grid-cols-2 gap-x-2.5 gap-y-2 border-t border-line pt-3 sm:mt-3.5 sm:gap-x-[1.375rem] sm:gap-y-3.5 sm:pt-[1.375rem]">
              {points(RETENTION_DAYS).map((p) => (
                <li key={p.title} className="grid grid-cols-[1.375rem_1fr] items-center gap-x-[0.4375rem] sm:grid-cols-[2.125rem_1fr] sm:items-start sm:gap-x-3 sm:gap-y-0.5">
                  <span className={`grid h-[1.375rem] w-[1.375rem] place-items-center rounded-md sm:row-span-2 sm:h-[2.125rem] sm:w-[2.125rem] sm:rounded-[0.5625rem] [&_svg]:h-[0.8125rem] [&_svg]:w-[0.8125rem] sm:[&_svg]:h-[1.125rem] sm:[&_svg]:w-[1.125rem] ${"coral" in p ? "bg-[rgb(255_93_79/0.14)] text-lock" : "bg-[rgb(142_163_255/0.12)] text-highlight"}`}>
                    {Icon[p.icon]}
                  </span>
                  <b className="text-[0.78125rem] font-medium leading-tight sm:text-[0.90625rem] sm:font-semibold sm:tracking-[-0.01em]">{p.title}</b>
                  <span className="text-[0.78125rem] leading-snug text-muted max-sm:hidden">{p.line}</span>
                </li>
              ))}
            </ul>
          </div>
          <FeatureFrames retentionDays={RETENTION_DAYS} />
        </section>

        <section className="border-t border-line bg-canvas-2/60 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="kicker text-center">How it works</p>
            <h2 className="display mt-3 text-center text-3xl sm:text-4xl">Three steps. That&apos;s it.</h2>
            <ol className="mt-12 grid gap-4 sm:grid-cols-3">
              {STEPS.map(([t, b], i) => (
                <li key={t} className="rounded-2xl border border-line bg-surface p-6">
                  <span className="font-mono text-sm font-medium text-highlight">0{i + 1}</span>
                  <h3 className="mt-2 text-lg font-semibold tracking-tight">{t}</h3>
                  <p className="mt-1 text-sm text-muted">{b}</p>
                </li>
              ))}
            </ol>
            <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-muted">{AUDIENCES}</p>
          </div>
        </section>

        <section className="border-t border-line py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="kicker text-center">Private by design</p>
            <h2 className="display mt-3 text-center text-3xl sm:text-4xl">How we keep it private</h2>
            <div className="mt-12 grid gap-4 sm:grid-cols-3">
              {PRIVACY.map(([t, b]) => (
                <div key={t} className="rounded-2xl border border-line bg-surface p-6">
                  <h3 className="font-semibold tracking-tight">{t}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{b}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-line bg-canvas-2/60 py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <p className="kicker">AI add-on</p>
            <h2 className="display mt-3 text-3xl sm:text-4xl">Transcripts made on your device.</h2>
            <p className="mt-4 text-muted">
              With the optional AI add-on, videos up to 30 minutes can get a written transcript and a short summary with key points and action items. The
              transcript is made on your own device (it works best on a computer); only its text is sent to write the summary, and both are stored encrypted.
              Available on paid plans. AI summaries can contain mistakes.
            </p>
            <Link href="/pricing#add-ons" className="mt-6 inline-block text-sm font-semibold text-accent hover:underline">
              See add-on pricing
            </Link>
          </div>
        </section>

        <section className="border-t border-line py-20">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
            <p className="kicker">Studio and Agency</p>
            <h2 className="display mt-3 text-3xl sm:text-4xl">Ready for your whole team</h2>
            <p className="mt-4 text-lg font-medium">Know who&apos;s waiting on a reply. See your whole team&apos;s client follow-up at a glance.</p>
            <p className="mt-4 text-muted">
              Studio includes 3 staff logins and Agency includes 10, the owner&rsquo;s own login included. Assign clients to staff, choose what each person can see and do, see how the team is keeping up with clients, and keep billing with the owner. Clients never need an account.
            </p>
            <p className="mt-6 font-medium">Free for 3 clients. Paid plans from US$15 a month.</p>
            <Link href="/pricing" className="mt-6 inline-block rounded-[0.625rem] bg-primary px-6 py-3 font-medium text-on-primary hover:bg-primary-hover">
              Compare plans
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
