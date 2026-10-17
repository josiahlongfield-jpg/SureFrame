import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import { LEGAL } from "@/lib/legal";
import { HELD_REPLY_DAYS } from "@/lib/heldReplies";
import { CLOUD_BACKUP_PRICE, EXTRA_SEAT_PRICE, EXTRA_SEAT_PRICE_YEARLY, MAX_REPLY_MINUTES, PLANS } from "@/lib/plans";
import { RETENTION_DAYS } from "@/lib/retention";

type Qa = { id: string; q: string; a: ReactNode };

/*
 * Questions people asked when trying SureFrame, answered only with what the app and our Terms and Privacy Policy
 * already say (lib/plans.ts, lib/retention.ts, lib/support/knowledge.ts, app/legal). Change an answer when what it
 * describes changes.
 */

const mail = <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;
const free = PLANS.FREE;

export const BUSINESS_FAQ: Qa[] = [
  {
    id: "storage",
    q: "How long are my videos kept?",
    a: (
      <>
        <p>
          On every plan, the encrypted copy of a video on our servers is deleted {RETENTION_DAYS} days after it&rsquo;s recorded, unless Cloud backup is on. After
          that it can&rsquo;t be watched from its link. Video and voice replies follow the same rule, and one that&rsquo;s recorded but never sent is deleted after {HELD_REPLY_DAYS} days. Text replies, to-dos and notes stay until they&rsquo;re deleted.
        </p>
        <p>
          Cloud backup (US${CLOUD_BACKUP_PRICE} a month, on paid plans) keeps our encrypted copies until you delete them. To keep your own copy, open a video and
          choose Save to device. We try to email whoever recorded a video about a day before it&rsquo;s deleted, but please don&rsquo;t rely on that email alone.
        </p>
      </>
    ),
  },
  {
    id: "free-plan",
    q: "What does the Free plan include?",
    a: (
      <p>
        {free.clientSeats} clients, {free.maxVideos} videos in total (not per month; deleted videos still count), up to {free.maxDurationMin} minutes per video and{" "}
        {free.maxResolution}p recording. Your clients see a short {BRAND.name} intro, once on each device. Videos are deleted from our servers {RETENTION_DAYS} days
        after they&rsquo;re recorded, and we may delete a Free workspace that hasn&rsquo;t been used for 12 months, after emailing you at least 30 days beforehand.{" "}
        <Link href="/pricing#free-in-full">See the Free plan in full</Link>.
      </p>
    ),
  },
  {
    id: "free-runs-out",
    q: "When my free videos run out, can my clients still watch?",
    a: (
      <p>
        Yes. Once all {free.maxVideos} are used, you and your clients can still watch your videos, you can send them to more clients, and everyone can still reply.
        You need a paid plan to record new videos. Videos still leave our servers {RETENTION_DAYS} days after they were recorded.
      </p>
    ),
  },
  {
    id: "first-email",
    q: "Why can't I email a new client their first video?",
    a: (
      <p>
        Your videos are end-to-end encrypted. Each client&rsquo;s personal link holds their private key, which only your team&rsquo;s devices have, so we
        can&rsquo;t email it without being able to see their videos. The first time, copy the client&rsquo;s link (Copy link after you send, or Copy personal link on
        the Clients page) and send it from your own email, texts or messages. Once they&rsquo;ve opened it, Send by email works for them too.
      </p>
    ),
  },
  {
    id: "clients-see",
    q: "What do my clients see?",
    a: (
      <p>
        A private page with your video, opened from their personal link. They don&rsquo;t need an account and never pay. They can reply with a video, a voice
        note or a message, and see any to-dos you share with them. On Free they see a short {BRAND.name} intro, once on each device; paid plans remove it and let
        you add your own logo and colours.
      </p>
    ),
  },
  {
    id: "phone",
    q: "Can I record on my phone?",
    a: (
      <p>
        Yes, in the browser, with nothing to install. Phone browsers can&rsquo;t share the screen, so on a phone you record with your camera. To record your
        screen, use a computer. Putting your camera in a screen recording works best in Chrome, Edge or Brave.
      </p>
    ),
  },
  {
    id: "recovery-key",
    q: "What is the recovery key, and what if I lose it?",
    a: (
      <>
        <p>
          Your recovery key unlocks your videos on a new phone or computer, or in another browser. You&rsquo;re shown it when you set up your account, and again any
          time from Settings &gt; Account (Show recovery key) on a device that&rsquo;s already unlocked. Keep it somewhere safe and private.
        </p>
        <p>
          If you lose it, any device that&rsquo;s still unlocked keeps working, and you can show the key again there. If no device is unlocked any more, nobody,
          including us, can open your old videos: we never have the key.
        </p>
      </>
    ),
  },
  {
    id: "extra-clients",
    q: "How do extra clients work?",
    a: (
      <p>
        Solo includes {PLANS.SOLO.clientSeats} clients, Studio {PLANS.STUDIO.clientSeats} and Agency {PLANS.AGENCY.clientSeats}. On any paid plan you can add more
        for US${EXTRA_SEAT_PRICE.toFixed(2)} a month each (US${EXTRA_SEAT_PRICE_YEARLY} a year on yearly billing) from the Clients page. Extra clients are charged
        today for the rest of your billing period, then renew with your plan; removing unused ones credits your next bill. Moving to a bigger plan takes off the
        extra clients it now includes.
      </p>
    ),
  },
  {
    id: "cancel",
    q: "How do I cancel, and do you give refunds?",
    a: (
      <p>
        Choose Cancel plan in Settings &gt; Billing. Your plan stays until the end of the period you&rsquo;ve paid for, then your workspace moves to Free; you can
        undo it before then with Keep my plan. Payments aren&rsquo;t refundable for part of a period, except where the law requires a refund (including under the
        Australian Consumer Law). If you think you&rsquo;ve been charged in error, email {mail}.
      </p>
    ),
  },
  {
    id: "signed-in",
    q: "How long do I stay signed in?",
    a: (
      <p>
        For your security, you&rsquo;re signed out when you close your browser, or after 8 hours without using {BRAND.name}. If you tick Keep me signed in, you
        stay signed in on that device for 30 days from when you sign in. Don&rsquo;t tick it on a shared device.
      </p>
    ),
  },
  {
    id: "data-location",
    q: "Where is my data stored?",
    a: (
      <p>
        Our providers store and process information outside Australia, mainly in the United States; encrypted recordings are stored in Oceania. Videos, replies,
        to-dos and notes stay end-to-end encrypted wherever they&rsquo;re stored. If your business has its own rules about client information (a health practice,
        say), check them against our <Link href="/legal/privacy">Privacy Policy</Link> and <Link href="/legal/dpa">Data Processing Agreement</Link>.{" "}
        <Link href="/about#data">More on where data is kept</Link>.
      </p>
    ),
  },
];

export const CLIENT_FAQ: Qa[] = [
  {
    id: "only-me",
    q: "Is this video only for me?",
    a: (
      <p>
        Yes. Each client gets their own private copy and their own conversation. Only you and the business&rsquo;s team can watch it, from your personal link.
        Anyone you give your link to could open it too, so keep it to yourself.
      </p>
    ),
  },
  {
    id: "who-sees-replies",
    q: "Who sees my replies?",
    a: (
      <p>
        The business&rsquo;s team. No other client can see your conversation. Your replies are end-to-end encrypted, so we ({BRAND.name}) can&rsquo;t see them.
        You can delete your own replies.
      </p>
    ),
  },
  {
    id: "business-told",
    q: "Is the business told when I reply?",
    a: <p>Usually, yes: the team member looking after you gets an email saying you replied. The email never includes your reply, because it&rsquo;s encrypted.</p>,
  },
  {
    id: "replies-kept",
    q: "Are my replies deleted with the video?",
    a: (
      <p>
        If the business deletes the video, the conversation goes with it. Video and voice replies also leave our servers {RETENTION_DAYS} days after
        they&rsquo;re recorded, unless the business has Cloud backup. Text replies stay until they&rsquo;re deleted. Video and voice replies can be up to{" "}
        {MAX_REPLY_MINUTES} minutes long.
      </p>
    ),
  },
  {
    id: "new-device",
    q: "Do I need my personal link again on a new phone?",
    a: (
      <p>
        Yes, once on each new phone, computer or browser. After you&rsquo;ve opened your personal link there, that device remembers it. Safari and iPhone browsers
        can forget it after a week or so without a visit; then open your personal link again, or ask the business to send it.
      </p>
    ),
  },
  {
    id: "client-cost",
    q: "Do I need an account, or have to pay?",
    a: <p>No. You watch and reply straight from your personal link. Clients never pay and never see third-party ads.</p>,
  },
  {
    id: "todos",
    q: "What are to-dos and notes?",
    a: (
      <p>
        Lists the business keeps for you, such as tasks with due dates. The ones it shares with you appear with your videos, and you may get reminder emails before
        they&rsquo;re due. To-dos and notes are end-to-end encrypted, so reminder emails never include what they say.
      </p>
    ),
  },
  {
    id: "stop-emails",
    q: "How do I stop emails from a business?",
    a: <p>Use the link at the bottom of any email from it. That turns off its reminders and new-video emails.</p>,
  },
];

/** One group of questions, each opening in place. */
export function FaqList({ items, headingLevel = 3 }: { items: Qa[]; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
      {items.map((x) => (
        <details key={x.id} id={x.id} className="group scroll-mt-20 px-5 py-4" data-testid="faq-item">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
            <H className="text-[0.9375rem] font-semibold text-ink">{x.q}</H>
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-dim transition group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="mt-3 space-y-2 text-sm leading-6 text-muted [&_a]:font-medium [&_a]:text-accent [&_a]:underline">{x.a}</div>
        </details>
      ))}
    </div>
  );
}
