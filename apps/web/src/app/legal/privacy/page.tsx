import Link from "next/link";
import LegalPage, { SubprocessorList } from "@/components/LegalPage";
import { DATA_LOCATIONS, LEGAL, operatorLine, R2_LOCATION } from "@/lib/legal";

export const metadata = { title: "Privacy Policy" };

export default function Page() {
  const mail = <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;
  return (
    <LegalPage title="Privacy Policy" version={LEGAL.privacyVersion} updated={LEGAL.privacyUpdated}>
      <p>
        {operatorLine()} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy explains what personal information we collect when you use {LEGAL.product}, why, and what
        choices you have. We handle personal information in line with the Australian Privacy Principles in the Privacy Act 1988 (Cth). Where they apply, we also
        follow the EU and UK General Data Protection Regulation (see <a href="#eu-uk">If you&rsquo;re in the EU or UK</a>).
      </p>

      <h2>The short version</h2>
      <ul>
        <li>Your videos, replies, to-dos and notes are end-to-end encrypted in your browser. We can&rsquo;t open them, and neither can anyone we work with.</li>
        <li>
          If a business switches on our optional AI transcripts and summaries, the text of each video&rsquo;s transcript (never the audio or video) is sent to our AI
          provider to write a summary. It&rsquo;s off unless the business turns it on.
        </li>
        <li>We collect only what we need to run your account, bill you and help you.</li>
        <li>We don&rsquo;t sell personal information, show third-party ads or use advertising trackers. Clients of businesses on the Free plan see a short SureFrame introduction before videos.</li>
      </ul>

      <h2 id="for-clients">For clients</h2>
      <p>If a business sends you videos through {LEGAL.product}, here&rsquo;s what it and we can see.</p>
      <ul>
        <li>
          <strong>The business can see</strong> your name and email address as it entered them, when you first opened your personal link, how many times you&rsquo;ve
          opened each video it sent you, your replies (video, voice and text) and reactions, and whether you&rsquo;ve turned off its emails. Your conversation
          is between you and the business&rsquo;s team: no other client can see it.
        </li>
        <li>
          <strong>We can&rsquo;t see</strong> the videos the business sends you, any message it adds to a video, or the video, voice and text replies you send: they&rsquo;re end-to-end encrypted,
          and the key is in your personal link, which never reaches our servers. We can see your name and email address, the titles of videos sent to you, when
          you opened your link and how many times you opened each video, and the emoji reactions you send.
        </li>
        <li>Clients can delete their own replies, at any time. A deleted reply is removed from our servers straight away.</li>
        <li>
          A video or voice reply is only shared once you choose to send it. If a recording is interrupted, it&rsquo;s kept for you alone to send or delete next
          time, and is never sent automatically. A reply you don&rsquo;t send is deleted {LEGAL.heldReplyDays} days after you recorded it.
        </li>
        <li>
          Your browser keeps the key to a business&rsquo;s videos on your device. &ldquo;Remove from this device&rdquo; in your inbox deletes that key and our
          cookie for that business from that device only.
        </li>
        <li>
          The Help button on your pages opens a help chat answered by an AI assistant (Anthropic). It receives what you type there, which business&rsquo;s page
          you&rsquo;re on, which browser and device you&rsquo;re using (as your browser reports it, so its steps fit yours), and what that page already shows: whether your link works, whether the business&rsquo;s emails to you are on, whether the business uses
          AI summaries and, on a video page, whether that video&rsquo;s copy on our servers has been or will be deleted. It never receives your videos, their
          titles, messages, replies, to-dos or notes. Nobody from our team answers it, and it can&rsquo;t pass the conversation to the business or to us: for
          anything it can&rsquo;t help with, it gives you the business&rsquo;s name and, if the business set one, its reply-to email address. We keep the text of
          each question you type (up to 500 characters), with the business&rsquo;s name and the page you asked on, but not who asked, for{" "}
          {LEGAL.clientQuestionDays} days. Once a week our team is emailed a list of these questions, grouped by business, so we can find and fix problems; that
          email stays in our support inbox. The rest of the conversation stays in your browser tab. Please don&rsquo;t type personal details there that you
          don&rsquo;t want kept.
        </li>
        <li>
          On a free-plan business, the short SureFrame intro is shown once per device for each business; your browser remembers this. You don&rsquo;t need an
          account and never pay.
        </li>
        <li>
          The business holds your details and decides what to send you. See <a href="#clients">Clients of businesses using {LEGAL.product}</a> for more, including
          what happens if it removes you or closes its account.
        </li>
      </ul>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> your name, email address, business name, branding and settings, and how many videos your workspace has recorded
          (for the Free plan&rsquo;s limit).
        </li>
        <li>
          <strong>Team details:</strong> for businesses with staff, each team member&rsquo;s name, email address and role, which clients they look after, what
          they&rsquo;re allowed to see and do, and their own email and reminder settings (such as a reply-to address for their clients). Reminders that owners and admins send to staff are stored and emailed as written, so
          they aren&rsquo;t end-to-end encrypted. If you invite someone by their email address, we email them to say they&rsquo;ve been invited, and we email
          staff you remove to tell them.
        </li>
        <li>
          <strong>Client details you add:</strong> the names and email addresses of clients you invite, so we can send them new-video emails, reminders and,
          after a key reset, a replacement link. We never email a client their first personal link: it holds their key, so the business sends it itself. When a
          business resets its keys (after someone leaves its team), we keep a one-way fingerprint (a hash) of each client&rsquo;s old link until that client is
          deleted, so the old link can say it was replaced.
        </li>
        <li>
          <strong>Encrypted content:</strong> video and reply recordings, the video stills shown in your library, text replies, and the text of to-dos and notes. These are encrypted on your device before
          they reach us, and the keys stay with you and your clients, so we hold only scrambled copies of them. Some details aren&rsquo;t encrypted, because we need to
          read them to show your library and send reminders: video titles, client names and email addresses, the names shown on replies, emoji reactions, to-do due dates, repeat and
          reminder settings, and the reminder message a business writes. We also keep basic information about content, such as when it was created, its size and
          length, and who it was sent to, and we record when a client first opens their personal link and how many times they open each video sent to them,
          which the business can see.
        </li>
        <li>
          <strong>Billing:</strong> your plan and subscription status, and the customer and subscription references from our payment provider. Subscriptions are
          sold through Link, Stripe&rsquo;s merchant-of-record service: Link collects your card, billing address and tax details at checkout and handles them under
          its own privacy policy, and we never see or store your card. We give Stripe your email address and business name to set up your account there,
          when you first go to checkout or when we give your business a discount code.
        </li>
        <li>
          <strong>Discounts and referrals:</strong> discount codes we give your business (which Stripe ties to your business so only it can use them), and your
          business&rsquo;s referral code with whether and when it was used, which business used it, and when the referral discount started or ended. The
          business that shared a code sees only that it was used and when, not which business used it.
        </li>
        <li>
          <strong>Support conversations:</strong> what you type into our help chat, and the email address you give us there. From the help chat on client pages,
          only the text of each question (up to 500 characters), which business&rsquo;s page and which page it was asked on, and whether the chat could answer it.
        </li>
        <li>
          <strong>Technical information:</strong> IP address, browser type and logs of requests, used to keep the service secure, prevent abuse and fix problems.
        </li>
        <li>
          <strong>Support and safety records:</strong> when we act on an account through our support tools (for example a warning, a suspension, turning off a
          client&rsquo;s link, closing an account, blocking an email address, deleting an account at its holder&rsquo;s request, correcting a plan or giving a
          discount code), we record
          what we did, when, why and who did it. The record names who or what it was about as they were at the time, such as the login&rsquo;s email address, the
          workspace&rsquo;s name with its owner&rsquo;s email address, a client&rsquo;s name and email address, or the email address blocked. It also notes the
          changes made (including to billing) and whether we emailed anyone about it. When we delete an account at its holder&rsquo;s request, the record also
          keeps details that show the account existed and was deleted: when it was created, its workspaces&rsquo; names and plans, and its references with our
          payment provider.
        </li>
        <li>
          <strong>Blocked email addresses:</strong> if we block an email address from being used with {LEGAL.product} (usually when we close an account for
          breaking our terms), we keep a one-way fingerprint (a hash) of the address, with the reason, the date, who blocked it and the account it came from, so it
          can&rsquo;t be used to sign in or sign up again.
        </li>
        <li>
          <strong>Records of agreement:</strong> each time you agree to our Terms of Service and this policy, we record which versions you agreed to, when, the
          email address on your account at the time, your IP address and browser, the version of {LEGAL.product} that showed them to you, and whether it was when
          you signed up or for an update.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>
          To provide {LEGAL.product}: storing and delivering your videos, and sending clients new-video emails, reminders and replacement links after a key
          reset, as well as sign-in emails, team emails (such as a client
          replying, or a staff member sending videos), a warning before a recording is deleted from our servers, and notices about accounts, such as when a
          client&rsquo;s access ends, about {LEGAL.removedClientWarningDays} days before a removed client is deleted for good, about{" "}
          {LEGAL.deletionWarningDays} days before an account you deleted is deleted for good, when an account is closed, kept or deleted, or when we take action
          on an account.
        </li>
        <li>To bill you and manage your subscription.</li>
        <li>To answer support requests.</li>
        <li>To keep the service secure, prevent misuse, enforce our terms (including suspending or closing accounts that break them) and meet our legal obligations.</li>
        <li>To keep evidence that you agreed to our Terms of Service and this policy, in case there&rsquo;s ever a dispute or legal claim about them.</li>
        <li>To tell you about important changes to the service. We&rsquo;ll only send marketing emails if you&rsquo;ve agreed to them, and you can opt out at any time.</li>
      </ul>
      <p>
        We don&rsquo;t make decisions about you that have legal or similarly significant effects solely by automated means. Some things happen automatically under
        our terms, such as plan limits, pausing clients or staff beyond what a plan covers, stopping renewal while a disputed payment is looked into, and limits on
        repeated attempts. Decisions to suspend or close an account, or to turn off a client&rsquo;s link, are made by a person.
      </p>

      <h2>Within a business&rsquo;s team</h2>
      <p>If a business has staff on {LEGAL.product}, some information is shared inside that business:</p>
      <ul>
        <li>
          <strong>What staff can see:</strong> staff see the clients assigned to them, those clients&rsquo; videos and conversations, and the videos they recorded
          themselves, unless the owner or an admin gives them access to more. Owners and admins can see every client and video in the business.
        </li>
        <li>
          <strong>Names:</strong> everyone on a team can see the others&rsquo; names, email addresses and roles. If a team member has set their name, clients see it on
          the videos that person sends, as &ldquo;Name from Business&rdquo;, but never their email address. Without a name set, clients see the business&rsquo;s name.
          When someone leaves a team, the videos and replies they made stay with the business and are shown as &ldquo;Former team member&rdquo;, without their
          name.
        </li>
        <li>
          <strong>Team overview:</strong> owners and admins can see how the team is keeping up with clients, worked out from dates and who sent what: for example
          videos each staff member sent, clients who haven&rsquo;t had a video for a while, client replies waiting for an answer and average reply times. They can
          choose to be emailed when staff send videos or clients reply, can see each staff member&rsquo;s own email and reminder settings, and can send staff
          reminders and see whether they were dismissed. None of this involves
          reading encrypted content.
        </li>
        <li>The business is responsible for telling its staff how their activity is shown to owners and admins.</li>
      </ul>

      <h2>Our AI support assistant</h2>
      <p>
        The help chat is answered first by an AI assistant provided by Anthropic. Your messages, which browser and device you&rsquo;re using (as your browser reports it, so steps fit yours), and for signed-in customers a summary of your plan, usage and account status, are sent
        to Anthropic to generate replies. The assistant can&rsquo;t see your videos, replies, to-dos or notes. A person on our team reads the conversation if you
        choose Talk to a person, or if the assistant passes it on because it needs a person (for example a billing problem or something that looks broken).
        Visitors without an account and businesses on the Free plan can be passed to a person only so often (see our{" "}
        <Link href="/legal/terms#help-limits">Terms of Service</Link>). Please don&rsquo;t share passwords, recovery keys or card numbers in the chat. We don&rsquo;t use your content or chats to train AI models, and Anthropic doesn&rsquo;t use them to train its models either.
      </p>
      <p>
        Clients have their own help chat on their pages, also answered by the AI assistant. Nobody from our team answers it, and it can&rsquo;t pass the
        conversation to the business or to us; we keep only the questions, as <a href="#for-clients">For clients</a> explains.
      </p>

      <h2>AI transcripts and summaries (optional)</h2>
      <p>
        Businesses can choose to add AI transcripts and summaries to their videos. It&rsquo;s off by default; only the workspace owner can switch it on (or ask
        us to), and they can switch it off again at any time in Settings &gt; Billing. When it&rsquo;s on:
      </p>
      <ul>
        <li>
          <strong>On the device:</strong> when a team member chooses to make one, the transcript is made in their browser from the decrypted recording. The audio and
          video don&rsquo;t leave that device for this. The speech model is downloaded from our own servers or storage, not from a public model site.
        </li>
        <li>
          <strong>Sent to our AI provider:</strong> the transcript text is sent through our servers to Anthropic, which provides the Claude AI model that writes the
          summary. Anthropic acts as our service provider (sub-processor) and processes it mainly in the United States. Anthropic
          doesn&rsquo;t use it to train its models. It may keep it for a limited time to detect misuse and then deletes it, in line with its commercial terms. The
          transcript may include anything said in the video, including personal information about the business, its clients or others.
        </li>
        <li>
          <strong>Stored encrypted:</strong> we don&rsquo;t keep a readable copy of the transcript or summary or put them in our logs. The browser encrypts both with
          the video&rsquo;s key before saving them, so, like replies, only the business&rsquo;s team members who can see the video and the clients it was sent to can read them.
        </li>
        <li>
          <strong>Removing them:</strong> the team can remove a video&rsquo;s transcript and summary at any time. They&rsquo;re also deleted when the video is
          deleted, when its copy on our servers is deleted, or when the account is permanently deleted.
        </li>
        <li>
          <strong>Clients:</strong> clients of a business using the add-on see a note saying so. The business is responsible for telling its clients and getting any
          consent the law requires. Questions about a business&rsquo;s use of it are best sent to that business first.
        </li>
      </ul>
      <p>Transcripts and summaries are made by machines and can contain mistakes.</p>

      <h2 id="extension">Our browser extension (optional)</h2>
      <p>
        The {LEGAL.product} extension for Chrome, Edge and other Chromium browsers shows your camera in a floating bubble, with Pause and Stop, on the web pages you
        visit while you record your screen with {LEGAL.product}. Your camera picture is only shown on your own screen: the extension never records, stores or sends it.
        When the bubble is on screen it becomes part of your screen recording, which is encrypted on your device like every recording. The extension doesn&rsquo;t collect,
        keep or send the addresses or content of the pages you visit. When it&rsquo;s installed or updated, it checks the addresses of tabs already open only to tell{" "}
        {LEGAL.product} tabs apart, and keeps nothing. To know whether the bubble is on screen, it notes which tab is in front, and keeps that only in
        your browser&rsquo;s memory while you record. It remembers the bubble&rsquo;s place and size, and whether its controls are tucked away, in your browser&rsquo;s storage for the
        extension. While you record, it also keeps the recording&rsquo;s state (the time, whether it&rsquo;s paused, and your camera&rsquo;s name, so the bubble shows
        the same camera) and any button you press on the bubble in the browser&rsquo;s temporary storage for the extension; this is cleared when the recording ends
        or the browser closes. Removing the extension removes all of this.
      </p>

      <h2 id="own-ai">Your own AI assistant (optional)</h2>
      <p>
        You can choose to use your own AI assistant, signed in with your own account (for example Claude in Chrome), to read your {LEGAL.product} pages and make reports. It works with what your browser or device has already unlocked with your keys: we don&rsquo;t
        send it anything and can&rsquo;t see what it reads. What it reads goes to that assistant&rsquo;s provider under your own agreement with them, not ours,
        and we aren&rsquo;t responsible for how they handle it. If that includes your clients&rsquo; details or conversations, you&rsquo;re responsible for telling
        them and getting any consent the law requires. An assistant that can click on your pages can also send or delete things, so only let it do what you&rsquo;d
        do yourself.
      </p>

      <h2>Who we share it with</h2>
      <p>We use trusted service providers to run {LEGAL.product}. They may only use your information to provide their service to us:</p>
      <SubprocessorList />
      <p>
        Businesses can also find this list in our <Link href="/legal/dpa#subprocessors">data processing agreement</Link>.
      </p>
      <p>These services handle your information under their own terms and privacy policies, as separate controllers:</p>
      <ul>
        <li>
          Link, Stripe&rsquo;s merchant-of-record service, which sells subscriptions, collects tax and sends receipts, and Stripe, which processes payments and
          manages subscriptions.
        </li>
      </ul>
      <p>
        We may also disclose information to law enforcement agencies, regulators, courts or others where the law requires or permits it, for example to respond to
        a valid legal request, to report suspected unlawful activity, or to protect the rights and safety of our users or others. Because content is end-to-end
        encrypted, we can&rsquo;t hand over encrypted content (videos, replies, to-dos, notes, transcripts and summaries). We can only disclose what we hold in
        readable form, such as account details, video titles, client names, reminder and staff-reminder messages, support chats and support records.
      </p>
      <p>If our business is sold or transferred, your information may pass to the new owner, who must keep handling it in line with this policy.</p>

      <h2>Overseas storage</h2>
      <p>
        We run {LEGAL.product} from Australia, and we may access information from there. {DATA_LOCATIONS} We choose providers with strong security and privacy practices. Your encrypted content stays encrypted wherever it&rsquo;s stored. The
        exception is transcript text sent for AI summaries (only for businesses that switch them on), which Anthropic must be able to read to write the summary;
        it&rsquo;s sent over an encrypted connection and processed mainly in the United States. If you&rsquo;re in the EU or UK, see{" "}
        <a href="#eu-uk">below</a> for how we protect these transfers.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          Without cloud backup, the encrypted copy of a video on our servers is deleted {LEGAL.retentionDays} days after it&rsquo;s recorded, and after that it
          can&rsquo;t be watched from its link. Video and voice replies follow the same rule. A recording stays on the device it was made on only until its upload
          finishes; to keep your own copy, open the video and choose Save to device. We try to email the person who recorded a video about a day before, but please
          don&rsquo;t rely on that email alone.
        </li>
        <li>
          While you record, the recording is encrypted on your device and uploaded in pieces every few seconds. If recording stops unexpectedly (for example the
          page closes or the device dies), we finish it from that encrypted copy when the person who recorded it next opens {LEGAL.product} on any of their
          devices, or with our daily clean-up once it&rsquo;s been untouched for at least 6 hours. A client&rsquo;s or team member&rsquo;s reply finished this way
          is kept unsent, for its author only (see the next points). Leftover pieces are deleted after about a day.
        </li>
        <li>
          With cloud backup, encrypted content is kept until you delete it, the client it was sent to is removed and then deleted (see below), or your account is
          permanently deleted. If cloud backup ends (you switch it off, cancel, or your paid plan ends), our copies are deleted {LEGAL.retentionDays} days later;
          if it ends while the account is suspended or closed, those {LEGAL.retentionDays} days start when it&rsquo;s unsuspended, reopened or kept.
        </li>
        <li>
          A video or voice reply that was recorded but never sent is deleted from our servers {LEGAL.heldReplyDays} days after it was recorded, with or without
          cloud backup. Until then only the person who recorded it can see it, send it or delete it.
        </li>
        <li>Text replies, to-dos and notes are kept until they&rsquo;re deleted, the client they belong to is deleted (see below), or the account is permanently deleted.</li>
        <li>
          When a business removes a client, the client&rsquo;s personal link stops working straight away. We keep the client&rsquo;s details and conversations for{" "}
          {LEGAL.removedClientDays} days in case the business restores them, then delete them for good, even with cloud backup: the client&rsquo;s name and email
          address, the recordings sent only to them, their to-dos and notes, and their conversations, including the team&rsquo;s replies in them. Recordings the
          business also sent to other clients stay with those clients. We try to email the business about {LEGAL.removedClientWarningDays} days before. At the
          business&rsquo;s request, we can restore a removed client, keep them for longer, or delete them sooner.
        </li>
        <li>
          Your business&rsquo;s referral code and its record are kept while your account is open, and deleted with it. If your business used another
          business&rsquo;s code, that business&rsquo;s record keeps a reference to your account, which no longer points to anything once your account is deleted.
        </li>
        <li>
          Support chats are kept for as long as we need them to help you, and we delete them if you ask. They aren&rsquo;t deleted automatically when an account is
          deleted.
        </li>
        <li>
          Questions typed into the help chat on client pages are deleted {LEGAL.clientQuestionDays} days after they&rsquo;re asked, or sooner with the
          business&rsquo;s account. The weekly list of these questions emailed to our team stays in our support inbox.
        </li>
        <li>
          Records of team emails (who was told about which reply or video) are deleted about 30 days after the email is sent. Reminders sent to staff are kept
          with the account as a history for owners and admins.
        </li>
        <li>
          Account details are kept while your account is open. When you delete your account, it&rsquo;s closed straight away: you&rsquo;re signed out on every
          device, your clients&rsquo; links stop working, emails in your business&rsquo;s name stop, pending team invites are cancelled and your plan won&rsquo;t
          renew. You then have {LEGAL.deletionGraceDays} days to change your mind: sign in within that time to reactivate your account, with your workspace and
          content as they were, except that recordings without cloud backup still leave our servers on their usual schedule and removed clients whose{" "}
          {LEGAL.removedClientDays} days end in the meantime are still deleted. We email you a reminder about {LEGAL.deletionWarningDays} days before the date.
          After {LEGAL.deletionGraceDays} days we permanently delete your account, workspace and content, and ask our payment provider to delete your customer
          record and saved cards. If you&rsquo;re on someone else&rsquo;s team, deleting your account takes you off that team straight away, and the recordings and replies you
          made for it stay with the team, shown as &ldquo;Former team member&rdquo;.
        </li>
        <li>
          If we close an account under our terms, we permanently delete the account, its workspaces and their content {LEGAL.closureDeleteDays} days later (or on
          the date already set, if its holder had already deleted it), unless we need to keep them for legal reasons (see the last point below). The account
          holder can&rsquo;t sign in, but can email us within {LEGAL.reviewDays} days of the closure for a copy of their account data download.
        </li>
        <li>
          After an account is deleted, some records stay, as described here: billing records, support chats until you ask us to delete them, records of support
          actions and of agreement, and a blocked address&rsquo;s fingerprint. Our providers&rsquo; logs and backups, and our payment provider&rsquo;s own records,
          are kept on their own schedules.
        </li>
        <li>
          Records of support actions on an account are kept for {LEGAL.supportRecordYears} years, even after the account is deleted, so we can deal with legal
          claims and repeated abuse. They include the email addresses and names they were about (see What we collect).
        </li>
        <li>
          Records of agreement to our Terms of Service and this policy are kept for {LEGAL.agreementRecordYears} years after each agreement, even after the account
          is deleted, as evidence of the agreement if there&rsquo;s ever a dispute or legal claim. Your latest agreement is also kept for as long as your account
          exists. Records of when we emailed you about a change to these documents are kept for the same {LEGAL.agreementRecordYears} years.
        </li>
        <li>
          A blocked email address&rsquo;s fingerprint is kept for as long as we need to stop that address being used again, until we lift the block. The record
          of blocking it, which includes the address itself, is a support record and is kept for {LEGAL.supportRecordYears} years.
        </li>
        <li>IP addresses we count to limit repeated attempts (for example at sign-in) are deleted within about two days.</li>
        <li>
          To keep the help chat&rsquo;s limits for visitors and Free plans, we record when someone uses it with a one-way fingerprint of their IP address and email
          address (not the addresses themselves) or their account. These records are deleted after 31 days.
        </li>
        <li>We keep billing records for as long as tax law requires, usually 5 years.</li>
        <li>
          We may keep information for longer than described here, and pause its automatic deletion (a legal hold), where the law requires it, to deal with a legal
          claim, or for a report to the authorities. We delete it once it&rsquo;s no longer needed for that: anything already past its deletion date is then
          deleted.
        </li>
      </ul>

      <h2>Cookies and local storage</h2>
      <p>We only use cookies needed to run {LEGAL.product}:</p>
      <ul>
        <li>
          <strong>Sign-in cookie:</strong> keeps you signed in to your account. It holds your account&rsquo;s id, your name and email address, and when you signed in, so a sign-in from before
          you closed your account, or before we signed your account out everywhere, no longer works.
        </li>
        <li>
          <strong>Sign-in security cookies:</strong> short-lived cookies our sign-in system uses to protect the sign-in process, for example against forged requests.
        </li>
        <li>
          <strong>sf_active:</strong> records the time of your last activity. Together with the sign-in cookie it signs you out when the browser is closed or after
          8 hours without use, and it&rsquo;s deleted when you close your browser. If you tick &ldquo;Keep me signed in&rdquo; when signing in, or turn it on
          later in Settings &gt; Account &gt; This device, you stay signed in on that device for 30 days from when it was turned on, and sf_active is kept for
          those 30 days instead; after that, once you turn it off, or once you sign out, the usual rules apply again.
        </li>
        <li>
          <strong>sf_keep:</strong> set only if you choose &ldquo;Keep me signed in&rdquo;. It marks that device as kept signed in, expires 30 days after it was
          turned on, and is removed if you turn it off. <strong>sf_keep_next</strong> carries that choice from the sign-in page through the email link, for up to
          a day, and is removed when the sign-in finishes. The choice is also carried in the sign-in link itself, so it still works if the link opens in another
          browser.
        </li>
        <li>
          <strong>sf_signin_to:</strong> holds the email address a sign-in link was just sent to, for up to an hour, so the sign-in page can show it and offer to
          send it again. It&rsquo;s only sent to our sign-in pages.
        </li>
        <li>
          <strong>sf_tz:</strong> your browser&rsquo;s time zone name (for example &ldquo;Australia/Sydney&rdquo;), for up to a year, so times in the app are
          shown in your own time zone.
        </li>
        <li>
          <strong>sf_lib_view</strong> and <strong>sf_lib_layout:</strong> how you chose to view your library (by date or by client, as tiles or a list), for up
          to a year. <strong>sf_inbox_layout</strong> does the same for a client&rsquo;s inbox (tiles or a list).
        </li>
        <li>
          <strong>sf_signed_out:</strong> set for 5 minutes after we sign you out this way, so the sign-in page can explain why.
        </li>
        <li>
          <strong>Client link cookie:</strong> remembers a client&rsquo;s personal link on their device for up to a year, so they can get back to
          their videos without an account.
        </li>
        <li>
          <strong>fc_key_&lt;client&gt;:</strong> marks that this browser holds a client&rsquo;s key, for up to a year, so their pages know they can show their
          videos here. It never holds the key itself, and it&rsquo;s removed with the key.
        </li>
        <li>
          <strong>sf_offer:</strong> remembers a discount or referral code you opened a link for, or entered on Settings &gt; Billing, for up to 30 days, so it
          comes off at checkout. It holds only the code and a signature that shows we set it.
        </li>
        <li>
          <strong>fc_removed:</strong> set for 10 minutes after opening a client link that no longer opens anything (access ended, the link was turned off, or
          the business&rsquo;s account is closed or unavailable), so the page can say why. It holds that link&rsquo;s code and gives no access.
        </li>
      </ul>
      <p>
        We also use your browser&rsquo;s storage to hold your encryption keys and recordings that haven&rsquo;t finished uploading, a link back to your help chat so
        you can return to it, a team invite you&rsquo;ve opened but not yet accepted, for businesses using AI transcripts a copy of the speech model so it
        doesn&rsquo;t download again, and small settings such as a prompt you&rsquo;ve dismissed, which replies you&rsquo;ve seen, the shape of your camera&rsquo;s picture, which video stills
        this browser has already redrawn more sharply, and whether you&rsquo;ve already
        seen the SureFrame introduction before a video. On a free-plan business, the short SureFrame intro is shown once per device for each business; your browser
        remembers this. We don&rsquo;t use advertising or tracking cookies.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>You can view and update your account details in Settings.</li>
        <li>
          You can export your data, or delete your account, from Settings &gt; Account, including before you&rsquo;ve agreed to an updated version of our terms
          or this policy. After you delete it, you have {LEGAL.deletionGraceDays} days to change your mind. If you&rsquo;d like it deleted sooner, or to cancel
          the deletion before the date, email {mail} from your account&rsquo;s email address.
        </li>
        <li>You can ask us for a copy of the personal information we hold about you, or ask us to correct it, by emailing {mail}.</li>
        <li>Clients can turn off emails from a business (reminders and new-video emails) from the link in any of them.</li>
      </ul>

      <h2 id="clients">Clients of businesses using {LEGAL.product}</h2>
      <p>
        If a business invited you as a client, that business decides what to send you and holds your details, and it&rsquo;s responsible for handling them
        lawfully (in data protection terms, the business is the controller and we&rsquo;re its processor). We store them on the business&rsquo;s behalf. Contact
        them first about your information. You can also email us and we&rsquo;ll help.
      </p>
      <p>
        If a business removes you as a client, your link stops working straight away, and the business may email you to let you know. Your details and
        conversations with that business are deleted for good {LEGAL.removedClientDays} days later, unless the business restores your access before then. The
        business can also ask us to restore your access, keep your details for longer, or delete them sooner.
      </p>
      <p>
        If a business deletes its {LEGAL.product} account, your link stops working and says the business has closed its account. Your details and conversations
        with that business are deleted with its account {LEGAL.deletionGraceDays} days later, unless it keeps its account before then. If we suspend or close a
        business&rsquo;s account, or turn off your link, your link stops working and says the videos are unavailable or that the link has been turned off. When we
        close a business&rsquo;s account, your details and conversations with it are deleted with that account.
      </p>

      <h2>Security</h2>
      <p>
        We use end-to-end encryption for content, encryption in transit, and access controls on our systems. No system is perfectly secure. If a data breach is likely
        to cause you serious harm, we&rsquo;ll notify you and the Office of the Australian Information Commissioner as the law requires.
      </p>

      <h2>Age</h2>
      <p>
        {LEGAL.product} accounts are for people aged {LEGAL.minimumAge} and over. Businesses may have clients who are children, such as a tutor&rsquo;s students.
        Clients under 18 may use a client link only with a parent&rsquo;s or guardian&rsquo;s permission, which the business is responsible for getting.
      </p>

      <h2 id="eu-uk">If you&rsquo;re in the EU or UK</h2>
      <p>
        This section applies if the EU General Data Protection Regulation (GDPR) or the UK GDPR covers your information, for example because you&rsquo;re in the
        European Union, the wider European Economic Area or the United Kingdom. It adds to the rest of this policy.
      </p>

      <h3>Who is responsible for your information</h3>
      <ul>
        <li>
          <strong>When a business uses {LEGAL.product}:</strong> the business is the controller of the information it and its team put into {LEGAL.product} about
          its clients and staff, including client details, recordings, replies, to-dos, notes, transcripts and Team overview activity. We&rsquo;re its processor: we
          handle that information only on the business&rsquo;s instructions, to provide {LEGAL.product}, under our{" "}
          <Link href="/legal/dpa">data processing agreement</Link>. If you&rsquo;re a client or staff member of a business, please contact the business first. If
          you contact us, we&rsquo;ll pass your request on to the business (unless the law stops us) and help it respond.
        </li>
        <li>
          <strong>For our own purposes:</strong> we&rsquo;re the controller of account holders&rsquo; account, sign-in and billing details, help chat and support
          conversations, questions typed into the help chat on client pages (and the weekly list of them emailed to our team), support and safety records (including email fingerprints kept to stop closed accounts signing up again), records of agreement to our
          terms and this policy, and the technical information we use to keep {LEGAL.product} secure for everyone who uses it, including clients.
        </li>
        <li>
          <strong>Others:</strong> Link and Stripe are separate controllers for the payment and tax details they collect at checkout.
        </li>
      </ul>

      <h3>Our legal bases</h3>
      <ul>
        <li>
          <strong>Contract:</strong> to create and run your account, provide {LEGAL.product}, bill you, answer your support requests and record that you&rsquo;ve
          agreed to our terms. We need your email address to create an account; without it we can&rsquo;t provide the service.
        </li>
        <li>
          <strong>Legitimate interests:</strong> to keep {LEGAL.product} secure, prevent misuse and enforce our terms (for example sign-in protection, limits on
          repeated attempts, suspending or closing accounts and turning off links that break our terms, keeping records of those actions, and stopping closed
          accounts signing up again), to keep records of agreement to our terms and this policy as evidence if there&rsquo;s a dispute or legal claim (for{" "}
          {LEGAL.agreementRecordYears} years, including after an account is deleted, and your latest one while your account exists), to deal with legal claims, to fix problems, to answer the help chat with our
          AI assistant, and to tell you about important changes. We&rsquo;ve weighed these against your rights and use as little information as we can for them.
        </li>
        <li>
          <strong>Legal obligation:</strong> to keep tax and business records, to keep information when the law requires it, and to respond to lawful requests from
          authorities.
        </li>
        <li>
          <strong>Consent:</strong> for marketing emails, if you&rsquo;ve agreed to them. You can withdraw your consent at any time; this doesn&rsquo;t affect anything
          we did before.
        </li>
      </ul>
      <p>
        The cookies and browser storage described above are used only to provide {LEGAL.product}, keep it secure and remember choices you make in it, so we
        don&rsquo;t ask for cookie consent.
      </p>

      <h3>Your rights</h3>
      <p>
        You can ask us to give you a copy of the personal information we hold about you, correct it, delete it, restrict how we use it, or send it to you or another
        provider in a machine-readable format (account holders can also download a copy from Settings &gt; Account). You can also object to our use of it based on
        legitimate interests. Email {mail}. We&rsquo;ll reply within one month, or tell you within that time if a complex request needs up to two more months, and we
        may need to confirm your identity first. Some rights have legal limits; for example, we may need to keep billing records, records of action we&rsquo;ve
        taken on an account, or records of your agreement to our terms. Because content is end-to-end encrypted, we can&rsquo;t read or search it to answer a request: the business, or you for your own
        account, can see, export and delete it in the app.
      </p>

      <h3>International transfers</h3>
      <p>
        We&rsquo;re based in Australia.{" "}
        {R2_LOCATION ? `Encrypted recordings are stored in the ${R2_LOCATION}, and our other providers` : "Our providers"} store and process information mainly
        in the United States (see Overseas storage above). Where personal
        information is transferred to us or our providers from the EU or UK, and the destination doesn&rsquo;t have an adequacy decision, we rely on the European
        Commission&rsquo;s Standard Contractual Clauses and, for the UK, the UK International Data Transfer Addendum. For information we process for businesses,
        these are part of our <Link href="/legal/dpa">data processing agreement</Link>. Our providers&rsquo; data processing terms include the Standard Contractual
        Clauses or another safeguard the law recognises. To ask for a copy of the safeguards, email {mail}.
      </p>

      <h3>Data breaches</h3>
      <p>
        If a breach affects people in the EU or UK, we&rsquo;ll also notify the relevant supervisory authority and the people affected where the GDPR or UK GDPR
        requires it. For information we process for a business, we&rsquo;ll tell the business so it can do this.
      </p>

      <h3>Complaints</h3>
      <p>
        Please contact us first at {mail} and we&rsquo;ll try to put things right. You also have the right to complain to a data protection supervisory authority. In
        the EU or EEA, that&rsquo;s the authority in the country where you live or work, or where you think the problem happened (
        <a href="https://www.edpb.europa.eu/about-edpb/about-edpb/members_en">list of authorities</a>). In the UK, it&rsquo;s the Information Commissioner&rsquo;s
        Office (<a href="https://ico.org.uk/make-a-complaint/">ico.org.uk</a>).
      </p>

      <h3>Contacting us</h3>
      <p>
        We haven&rsquo;t appointed a representative in the EU or UK, or a data protection officer. Please contact us directly at {mail} about anything
        in this policy. We handle requests from the EU and UK the same way as any other.
      </p>

      <h2>Changes</h2>
      <p>
        We&rsquo;ll update this page when our practices change, and tell you by email about significant changes. When we update it, we ask account holders to
        read and agree to the new version before carrying on, and we keep a record of that. If you already have an account, we email you first, and you can carry
        on for {LEGAL.changeNoticeDays} days after that email before you need to agree. Each version has a number, shown at the top. Versions from 11
        October 2026 onwards are listed in our <Link href="/legal/archive">archive of versions</Link>, and we&rsquo;ll send you a copy of any earlier version if you
        ask.
      </p>

      <h2>Contact and complaints</h2>
      <p>
        Email {mail} with any question or complaint about privacy, and we&rsquo;ll reply within 30 days. If you&rsquo;re not satisfied with our response, you can
        contact the Office of the Australian Information Commissioner at <a href="https://www.oaic.gov.au">oaic.gov.au</a>.
      </p>
      {LEGAL.postalAddress && <p>Postal address: {LEGAL.postalAddress}</p>}
    </LegalPage>
  );
}
