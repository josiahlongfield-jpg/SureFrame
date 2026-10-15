import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import FeatureFrames from "@/components/home/FeatureFrames";
import { Icon } from "@/components/home/icons";
import { points } from "@/components/home/points";
import { BRAND } from "@/lib/brand";
import { RETENTION_DAYS } from "@/lib/retention";

const PILLARS = [
  {
    title: "Protected from crashes",
    body: "Videos upload as you record, and a copy stays on your device until the upload finishes. If the browser crashes or Wi-Fi drops, reopen it on the same device and your video carries on uploading by itself.",
    icon: "M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z",
  },
  {
    title: "Share in a second",
    body: "Your link is ready the moment you hit stop. No “processing” screen, no waiting for a render before your client can watch.",
    icon: "M10 14l11-11M21 3l-7 18-3-8-8-3z",
  },
  {
    title: "Private by design",
    body: "Every video is encrypted on your device before it uploads. Only you, the team members you allow and the client you send it to can open it. Not even we can.",
    icon: "M6 11h12v10H6zM9 11V7a3 3 0 0 1 6 0v4",
  },
  {
    title: "Works in your browser",
    body: "Record on a computer or a phone with nothing to install. iPhone and Android apps are coming soon.",
    icon: "M7 2h10v20H7zM11 18h2",
  },
  {
    title: "Everything for each client in one place",
    body: "Send a video, add their to-dos and notes, and set email reminders, all private to you and them.",
    icon: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  },
  {
    title: "Your brand, front and centre",
    body: "On paid plans, your logo and colours are on every page and email your clients see.",
    icon: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4-4-7.8-9-7.8zM7.5 11h.01M10.5 7.5h.01M15 8h.01",
  },
];

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
        <section className="mx-auto grid max-w-[1440px] items-center gap-10 px-4 pb-16 pt-6 sm:px-6 sm:pt-10 xl:min-h-[calc(100svh-72px)] xl:grid-cols-[500px_minmax(0,1fr)] xl:gap-14 xl:px-16 xl:pb-10 xl:pt-0">
          <div className="grid content-center gap-4 sm:gap-[18px]">
            <p className="kicker inline-flex items-center gap-2"><span className="h-[13px] w-[13px]">{Icon.lockFilled}</span>Private video for you and your clients</p>
            <h1 className="display text-[40px] sm:text-[56px] xl:text-[62px]">
              One take is <span className="text-highlight">all it takes.</span>
            </h1>
            <p className="max-w-[30em] text-[15px] leading-relaxed text-muted sm:text-[17px]">Record it once, send it privately, and keep every client on track.</p>
            <div className="flex flex-wrap items-center gap-2.5">
              <Link href="/record" className="rounded-[10px] bg-primary px-4 py-3 text-sm font-medium text-on-primary shadow-[0_8px_24px_-10px_rgb(79_110_247/0.9)] hover:bg-primary-hover sm:px-[18px] sm:text-[15px]">
                Record your first video, free
              </Link>
              <Link href="/pricing" className="rounded-[10px] border border-line bg-solid px-4 py-3 text-sm font-medium text-on-solid hover:bg-solid-hover sm:px-[18px] sm:text-[15px]">
                See pricing
              </Link>
              <span className="ml-1.5 text-[13px] text-muted max-sm:hidden">Free for 3 clients</span>
            </div>
            <ul className="mt-1 grid grid-cols-2 gap-x-2.5 gap-y-2 border-t border-line pt-3 sm:mt-3.5 sm:gap-x-[22px] sm:gap-y-3.5 sm:pt-[22px]">
              {points(RETENTION_DAYS).map((p) => (
                <li key={p.title} className="grid grid-cols-[22px_1fr] items-center gap-x-[7px] sm:grid-cols-[34px_1fr] sm:items-start sm:gap-x-3 sm:gap-y-0.5">
                  <span className={`grid h-[22px] w-[22px] place-items-center rounded-md sm:row-span-2 sm:h-[34px] sm:w-[34px] sm:rounded-[9px] [&_svg]:h-[13px] [&_svg]:w-[13px] sm:[&_svg]:h-[18px] sm:[&_svg]:w-[18px] ${"coral" in p ? "bg-[rgb(255_93_79/0.14)] text-lock" : "bg-[rgb(142_163_255/0.12)] text-highlight"}`}>
                    {Icon[p.icon]}
                  </span>
                  <b className="text-[12.5px] font-medium leading-tight sm:text-[14.5px] sm:font-semibold sm:tracking-[-0.01em]">{p.title}</b>
                  <span className="text-[12.5px] leading-snug text-muted max-sm:hidden">{p.line}</span>
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
          <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
            {PILLARS.map((p) => (
              <div key={p.title}>
                <div className="mb-4 grid h-10 w-10 place-items-center rounded-[10px] bg-[rgb(142_163_255/0.12)] text-highlight">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d={p.icon} /></svg>
                </div>
                <h3 className="font-semibold tracking-tight">{p.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-line bg-canvas-2/60 py-20">
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

        <section className="border-t border-line py-20">
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

        <section className="border-y border-line bg-surface py-10 text-center">
          <p className="mx-auto max-w-3xl px-4 text-lg font-medium sm:px-6">Your clients never pay, never sign up and never see third-party ads.</p>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
            <p className="kicker">Studio and Agency</p>
            <h2 className="display mt-3 text-3xl sm:text-4xl">Ready for your whole team</h2>
            <p className="mt-4 text-lg font-medium">Know who&apos;s waiting on a reply. See your whole team&apos;s client follow-up at a glance.</p>
            <p className="mt-4 text-muted">
              Studio includes 3 staff logins and Agency includes 10, the owner&rsquo;s own login included. Assign clients to staff, choose what each person can see and do, see how the team is keeping up with clients, and keep billing with the owner. Clients never need an account.
            </p>
            <p className="mt-6 font-medium">Free for 3 clients. Paid plans from US$15 a month.</p>
            <Link href="/pricing" className="mt-6 inline-block rounded-[10px] bg-primary px-6 py-3 font-medium text-on-primary hover:bg-primary-hover">
              Compare plans
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
