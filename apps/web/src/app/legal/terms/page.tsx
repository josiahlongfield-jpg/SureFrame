import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { LEGAL, operatorLine } from "@/lib/legal";
import { AI_SUMMARIES_PER_MONTH, PLANS } from "@/lib/plans";

export const metadata = { title: "Terms of Service" };

export default function Page() {
  const mail = <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;
  const freeVideos = PLANS.FREE.maxVideos;
  return (
    <LegalPage title="Terms of Service" version={LEGAL.termsVersion} updated={LEGAL.termsUpdated}>
      <p>
        {operatorLine()} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). These terms apply when you use {LEGAL.product} at {LEGAL.website} (and in any apps we release).
      </p>
      <p>
        To use {LEGAL.product} with an account, you must agree to these terms and our <Link href="/legal/privacy">privacy policy</Link> by ticking the box we show
        you, when you sign up and again whenever we update them (see section 18). We keep a record of each time you agree: when, which versions, and the email
        address, IP address and browser you used. Until you agree, you can still sign out, download your data, manage or cancel your subscription and delete your
        account, and a recording that was already uploading still finishes, but you can&rsquo;t otherwise use {LEGAL.product}.
      </p>

      <h2>1. Who can use {LEGAL.product}</h2>
      <p>
        You must be {LEGAL.minimumAge} or older. If you use {LEGAL.product} for a business, you confirm you&rsquo;re allowed to accept these terms for that business,
        and &ldquo;you&rdquo; includes the business.
      </p>

      <h2>2. Your account and your team</h2>
      <ul>
        <li>Keep your sign-in details safe. You&rsquo;re responsible for what happens in your account and in the accounts of staff you invite.</li>
        <li>Tell us straight away at {mail} if you think someone has accessed your account without permission.</li>
        <li>
          For your security, you&rsquo;re usually signed out when you close your browser, and after 8 hours without using {LEGAL.product}. Some browsers that
          restore your tabs can keep you signed in, so sign out yourself on shared devices.
        </li>
        <li>
          The workspace owner, and any admins they appoint, decide who joins the team, which clients each staff member looks after and what each staff member can
          see and do. You&rsquo;re responsible for these choices and for removing staff who should no longer have access.
        </li>
        <li>
          Owners and admins can see a Team overview of staff activity (such as videos sent, clients waiting for a reply and reply times), can choose to be emailed
          when staff send videos, and can send staff reminders. You&rsquo;re responsible for telling your staff about this and for following any workplace and
          privacy laws that apply to you.
        </li>
        <li>When a team member has set their name, clients see it on the videos that person sends, as &ldquo;Name from Business&rdquo;.</li>
      </ul>

      <h2>3. Encryption and your recovery key</h2>
      <p>
        Your videos, replies, to-dos and notes are end-to-end encrypted, and we never hold the keys. That means we can&rsquo;t recover your content if you lose your
        recovery key and no signed-in device still has it unlocked. Keep your recovery key somewhere safe. We&rsquo;re not responsible for content that can&rsquo;t be
        decrypted because a key was lost.
      </p>

      <h2>4. Your clients</h2>
      <ul>
        <li>Clients you invite use {LEGAL.product} free of charge, through their personal links.</li>
        <li>
          You&rsquo;re responsible for your relationship with your clients, including having their permission to contact them, to send them content and to store their
          details with us.
        </li>
        <li>Keep client links private. Anyone with a client&rsquo;s link can see what was shared with that client.</li>
        <li>
          When you remove a client, their link stops working straight away. We keep their details and conversations for {LEGAL.removedClientDays} days in case you
          restore them, then delete them for good, even with cloud backup, including the recordings sent only to them and your team&rsquo;s replies to them.
          Recordings you also sent to other clients stay with those clients. We try to email the owner, and whoever removed them, about{" "}
          {LEGAL.removedClientWarningDays} days before. You can choose to email the client that their access has ended; where the law requires you to tell them,
          that&rsquo;s your responsibility. At your request, we can also restore a removed client, keep them for longer or delete them sooner (see section 9).
        </li>
        <li>
          Clients under 18 may use a client link only with a parent&rsquo;s or guardian&rsquo;s permission, which the business is responsible for getting.
        </li>
        <li>
          You&rsquo;re responsible for following the privacy, spam and recording laws that apply to you, including getting any consent needed before recording people
          and taking extra care with sensitive information such as health details.
        </li>
        <li>
          If the EU or UK GDPR applies to the personal information we process for you (such as your clients&rsquo; details and content), our{" "}
          <Link href="/legal/dpa">Data Processing Agreement</Link> forms part of these terms and applies automatically.
        </li>
        <li>If you&rsquo;re a client using {LEGAL.product} through a business&rsquo;s link, these terms apply to you too, apart from the sections about plans and billing.</li>
      </ul>

      <h2>5. Plans, billing and cancelling</h2>
      <ul>
        <li>
          Paid plans are subscriptions billed in advance, monthly or yearly, in US dollars, and renew automatically until cancelled. Prices are on our{" "}
          <Link href="/pricing">pricing page</Link>.
        </li>
        <li>
          Purchases are sold through Link, Stripe&rsquo;s merchant-of-record service. Link charges you, adds any tax that applies where you are, sends your receipts
          and handles payment questions. Your statement shows LINK.COM* SUREFRAME.APP.
        </li>
        <li>
          When you change plans, we show you the cost before you confirm. Your new plan starts straight away, you&rsquo;re credited for unused time on your old plan,
          and your billing date moves to the day of the change.
        </li>
        <li>
          Extra clients, extra staff logins and add-ons (such as cloud backup or AI summaries) are charged when you add them, for the rest of the current billing
          period, then renew with your plan. Removing one credits the unused time against your next bill.
        </li>
        <li>
          You can cancel any time in Settings &gt; Billing. Your plan stays active until the end of the period you&rsquo;ve paid for, then your workspace moves to the
          Free plan.
        </li>
        <li>
          Each plan covers a set number of clients and staff logins. To move to a smaller plan or fewer seats, first remove the clients or staff it doesn&rsquo;t
          cover. If your plan drops for another reason (you cancel, a payment fails and isn&rsquo;t fixed, or a free plan we gave you ends), the clients and staff
          beyond the new plan&rsquo;s limits are paused: they can&rsquo;t open anything or be sent anything until you upgrade or remove others. The owner and the
          longest-standing clients keep access, as do admins and then the longest-standing staff. A pause doesn&rsquo;t delete anything, though recordings still
          expire on the usual schedule.
        </li>
        <li>
          We email the workspace owner when anyone is paused. It&rsquo;s your responsibility to tell your staff and clients about any change to your plan that
          affects them.
        </li>
        <li>
          Apart from the credits described above, payments aren&rsquo;t refundable for partial periods, except where the law requires a refund (including under the Australian Consumer Law), or where Link
          gives one under its own terms. If you think you&rsquo;ve been charged in error, email {mail}.
        </li>
        <li>We may change our prices. We&rsquo;ll give you at least 30 days&rsquo; notice by email, and the new price applies from your next renewal.</li>
        <li id="founding-prices">
          Founding prices are the exception. If your subscription started while we offered founding prices, our price changes don&rsquo;t apply to your plan,
          extra clients or extra staff logins for as long as that subscription stays active, including when you switch plans or between monthly and yearly
          billing. They don&rsquo;t cover add-ons or tax. They end if the subscription ends (for example, you cancel and the period you paid for runs out), and a
          new subscription pays our prices at the time.
        </li>
        <li id="discounts">
          Discount codes and offers work as described when you use them: how much comes off, what it comes off and for how long. A discount code we give
          your business works once and only for your business: it can&rsquo;t be passed on, sold or used by anyone else. A discount that lasts a
          number of months comes off every bill that starts within those months, so on yearly billing it comes off your first yearly bill in full. Codes can
          only be used when you start a paid subscription or move up to a bigger plan, and when moving up a code can&rsquo;t bring the new plan below what
          your current plan costs. When a discount ends, the normal price applies from your next bill. Apart from a referral discount
          (below), only one discount applies to a subscription at a time. Discounts can&rsquo;t be exchanged for cash, and some are only for businesses we&rsquo;ve never billed before. An offer
          closes when its last day or number of uses is reached, but a discount you already have keeps running for the time it was offered.
        </li>
        <li id="referrals">
          Referrals: a business on a paid plan can share its referral code from Settings &gt; Billing. A business we&rsquo;ve never billed before that starts a
          paid plan with it gets 10% off its plan (not extra clients, extra staff or add-ons) on every bill for as long as that subscription lasts. Once its
          first payment goes through, the business that shared the code gets 10% off its own plan from its next bill on, for as long as the business it
          referred stays subscribed and its own subscription continues. Nothing is given if the sharer&rsquo;s subscription ends first, and a code
          can&rsquo;t be used while the sharer&rsquo;s subscription is set to end. Each code works
          once, each business can take part once (a business that joined with a code has no code to share), and a business can&rsquo;t use its own or its
          team&rsquo;s code. We may refuse or remove a referral discount gained by misuse, such as a business set up only to get one. We may end the referral
          programme for new referrals at any time; referral discounts already given keep running as described here.
        </li>
        <li>If a payment fails, we may limit paid features until it&rsquo;s resolved.</li>
      </ul>

      <h2>6. Free plan</h2>
      <p>
        The Free plan has the limits shown on our pricing page, including {freeVideos} videos in total per workspace. Every new video recorded in a workspace counts
        once it finishes uploading, whatever plan the workspace is on, so videos recorded on a paid or complimentary plan count too. Deleting a video, or its copy
        being deleted from our servers, doesn&rsquo;t give a place back. Replies, and sending a video to more clients, don&rsquo;t count. Once a Free workspace has
        used all {freeVideos}, it can&rsquo;t record new videos unless it moves to a paid plan, but its team can still watch videos, send existing videos to more
        clients and reply. On the Free plan, your team&rsquo;s video and voice replies can be up to {PLANS.FREE.maxDurationMin} minutes long. We may correct the
        count of videos your workspace has used (for example after a failed upload), and we&rsquo;ll usually tell the owner by email when we do.
      </p>
      <p>
        Clients of Free workspaces see a short {LEGAL.product} introduction before videos. We may change or end the Free plan with reasonable notice.
      </p>

      <h2>7. Storage and lost recordings</h2>
      <p>
        Without cloud backup, the encrypted copy of a video on our servers is deleted {LEGAL.retentionDays} days after it&rsquo;s recorded, and after that it can&rsquo;t
        be watched from its link. Video and voice replies follow the same rule; text replies, to-dos and notes are kept until they&rsquo;re deleted. A recording
        stays on the device it was made on only until its upload finishes. To keep your own copy, open the video and choose Save
        to device. With cloud backup, content is kept until you delete it or your account is permanently deleted (see section 17). If cloud backup ends (you switch
        it off, cancel, or your paid plan ends), our copies are deleted {LEGAL.retentionDays} days later; if it ends while your account is suspended or
        closed, those {LEGAL.retentionDays} days start when it&rsquo;s unsuspended, reopened or kept. Removing a client also deletes their conversations after{" "}
        {LEGAL.removedClientDays} days, even with cloud backup (see section 4). We may pause these deletions where we need to keep information for legal reasons (see section 9). Please
        keep your own copies of anything important.
      </p>
      <p>
        {LEGAL.product} is built to protect recordings from crashes and dropped connections, but no system can rule out every loss. A recording or other content can
        still be lost, for example if a device is lost, damaged or out of storage before an upload finishes, if browser data is cleared, if a recovery key is lost, or
        because of a fault on our side or at one of our providers. We don&rsquo;t promise that content will never be lost, damaged or unavailable, and you&rsquo;re
        responsible for keeping copies of anything you can&rsquo;t afford to lose. To the extent the law allows, we&rsquo;re not liable for lost or damaged content,
        and section 16 (limit of liability) applies to any claim about it.
      </p>

      <h2>8. Your content</h2>
      <p>
        You own what you create and upload. You give us permission to store, encrypt, copy and deliver it only as needed to run {LEGAL.product} for you. Because content
        is encrypted, we don&rsquo;t view or review it.
      </p>
      <p>
        We own {LEGAL.product}, including its software, design, name and logo. We give you a personal, non-transferable right to use it under these terms. If you send us
        ideas or feedback, we may use them freely without paying you.
      </p>

      <h2 id="suspension">9. Acceptable use, suspension and closure</h2>
      <p>You agree not to use {LEGAL.product} to:</p>
      <ul>
        <li>break the law, or send content that is unlawful, harassing, threatening, defamatory or infringes anyone else&rsquo;s rights;</li>
        <li>share child sexual abuse material, or content that promotes terrorism or violent extremism. We report this to the authorities;</li>
        <li>record or share images of people without the consent the law requires, or impersonate anyone;</li>
        <li>scam, defraud or mislead anyone, including your clients;</li>
        <li>send spam or unwanted messages to people who haven&rsquo;t agreed to hear from you;</li>
        <li>distribute malware, or try to break into, overload or disrupt the service or other people&rsquo;s accounts;</li>
        <li>copy, resell or reverse-engineer the service, except as the law allows;</li>
        <li>use automated tools to access the service or create accounts, except through features we provide for that;</li>
        <li>give us false information, or pay with a card or account you&rsquo;re not allowed to use;</li>
        <li>get around a suspension, a closure or a plan limit, for example by opening another account;</li>
        <li>use the service where it&rsquo;s prohibited by Australian or other applicable sanctions laws.</li>
      </ul>

      <h3>Suspension and closure</h3>
      <p>
        To protect people and {LEGAL.product}, we can suspend an account, turn off a client&rsquo;s link, or permanently close an account. {LEGAL.product}&rsquo;s
        operator, {LEGAL.operator}, and anyone he authorises can take these steps through {LEGAL.product}&rsquo;s support tools. We may take any of them straight
        away and without warning if we reasonably believe that:
      </p>
      <ul>
        <li>these terms have been broken seriously or repeatedly;</li>
        <li>an account is being used for something unlawful, fraudulent, harmful or abusive, including anything in the list above;</li>
        <li>someone gave us false information, or a payment was fraudulent;</li>
        <li>it&rsquo;s needed to protect people, {LEGAL.product} or other users from harm or risk; or</li>
        <li>the law requires it, or a court, regulator or law enforcement agency requires or asks for it.</li>
      </ul>
      <p>
        For other breaches of these terms, where it&rsquo;s reasonable, we&rsquo;ll warn you first and give you a chance to fix the problem. What we do depends on
        how serious the problem is.
      </p>

      <h3>What each step does</h3>
      <ul>
        <li>
          <strong>Warning:</strong> we email you about the problem. Nothing in the account changes.
        </li>
        <li>
          <strong>Suspending an account:</strong> your team can&rsquo;t use the workspace, apart from getting help, downloading their data, switching to another
          workspace they&rsquo;re on and, for the owner, managing or cancelling the subscription. Your clients&rsquo; links show that your videos are unavailable
          for now, and nobody new can join the team. Reminders and other emails stop, and reminders that come due meanwhile aren&rsquo;t sent later. Nothing is
          deleted because of a suspension, but the usual schedules carry on: recordings without cloud backup still leave our servers, and removed clients are
          still deleted when their {LEGAL.removedClientDays} days end, unless there&rsquo;s a legal hold. A suspension lasts until we lift it or close the account.
          We may also suspend a single team member&rsquo;s login in the same way: it can&rsquo;t use any workspace or join a team, and the rest of its team carries
          on.
        </li>
        <li>
          <strong>Turning off a client&rsquo;s link:</strong> the client sees that their link has been turned off and can&rsquo;t open or reply to anything through
          it, and you can&rsquo;t send them anything, but they keep their seat and nothing is deleted. For example, we might do this after a report under section 11.
        </li>
        <li>
          <strong>Closing an account:</strong> the account is signed out on every device, and it and the workspaces it owns (or is the only member of) are
          suspended straight away. Unlike when you delete your own account (section 17), you can&rsquo;t keep or reactivate it by signing in. If the owner has a
          team, the whole workspace is closed and its staff are taken off it, keeping their own logins. A closed login is also taken off any other team it&rsquo;s
          on, and pending invites are cancelled. Any subscription is cancelled straight away. We may also stop the account&rsquo;s email address being used to sign
          in or sign up again. The account, its workspaces and their content are permanently deleted {LEGAL.closureDeleteDays} days after closure (or on the date
          already set, if you&rsquo;d already deleted your account), unless the law requires us to keep them or they&rsquo;re on legal hold. Because you can&rsquo;t
          sign in, you can email {mail} within {LEGAL.reviewDays} days of the closure for a copy of your account data download, unless the law stops us sending
          it. If a review finds we got it wrong before the deletion date, we can reopen the account (if you&rsquo;d already deleted it yourself, it goes back to
          being deleted on its date unless you keep it); a subscription we cancelled and staff taken off the team don&rsquo;t come back, so you would subscribe
          and invite them again.
        </li>
        <li>
          <strong>Legal hold:</strong> where the law requires it, to deal with a legal claim, or for a report to the authorities, we may keep an account&rsquo;s
          information and pause all of its automatic deletion (including the deletion of recordings, unfinished uploads, removed clients and the account itself)
          until it&rsquo;s no longer needed. While it lasts, the account isn&rsquo;t deleted, even if you delete it or ask us to. We may not tell you about a legal hold, for
          example where it&rsquo;s for a report to the authorities. When it ends, anything already past its deletion date is deleted.
        </li>
      </ul>
      <p>
        We also use these support tools to keep accounts secure, to correct errors and to act on requests. For example, we can sign a login out on every device;
        correct the number of Free plan videos used; re-check a subscription with our payment provider and re-apply plan limits (which can pause or restore
        clients and staff); give or end a complimentary plan or add-on; stop an email address being used to sign in or sign up, or lift that block; and reopen an
        account we closed, after a review. When a business asks, we can restore a removed client (even beyond its plan&rsquo;s client seats, in which case the
        newest clients over the limit are paused), keep a removed client for longer, or delete them sooner. When an account holder asks from the account&rsquo;s
        email address, we can delete the account straight away, or cancel its scheduled deletion (except for an account we closed).
      </p>

      <h3>Telling you and asking for a review</h3>
      <p>
        Where it&rsquo;s lawful and safe to do so, we&rsquo;ll email the workspace owner (or the team member whose login is affected) to say what we did and why. We
        might not tell you, for example, where the law forbids it, where it would put someone at risk, or where it would get in the way of an investigation by the
        authorities.
      </p>
      <p>
        If you think we&rsquo;ve got it wrong, reply to our email or email {mail} within {LEGAL.reviewDays} days of hearing from us (or of finding out, if we
        couldn&rsquo;t tell you) and tell us why. A person will review the decision and tell you the outcome. If we made a mistake, we&rsquo;ll put things right as
        far as we reasonably can. This doesn&rsquo;t affect your other rights, including under section 19.
      </p>

      <h3>Billing</h3>
      <ul>
        <li>
          A suspension doesn&rsquo;t stop billing. Your subscription keeps renewing unless we stop its renewal at the end of the current period, which we may do
          while the account is suspended.
        </li>
        <li>
          Closing an account cancels its subscription straight away, and there are no further charges. If we close an account because of a breach of these terms or
          unlawful use, we won&rsquo;t refund the current billing period, except where the law requires (for example under the Australian Consumer Law).
        </li>
        <li>
          If we close accounts for a reason that isn&rsquo;t about how they were used (for example because we stop providing {LEGAL.product}), we&rsquo;ll give at
          least 30 days&rsquo; notice by email, unless the law requires us to act sooner, and refund fees you&rsquo;ve prepaid for the time after your account
          closes.
        </li>
      </ul>

      <h3>Records</h3>
      <p>
        We keep a record of each of these actions, including those we take at your request: what we did, when, why, who did it, and the account, workspace,
        client or email address it was about, as named at the time. Our <Link href="/legal/privacy">privacy policy</Link> explains how long we keep these
        records.
      </p>
      <p>Nothing in this section limits your rights under the Australian Consumer Law (see section 15).</p>

      <h2>10. Fair use of plans</h2>
      <ul>
        <li>
          Each business may have one Free workspace. Don&rsquo;t create extra accounts or workspaces to get around plan limits, such as the Free plan&rsquo;s{" "}
          {freeVideos} videos.
        </li>
        <li>Staff logins are for one person each. Don&rsquo;t share a login between people.</li>
        <li>We may delete Free workspaces that haven&rsquo;t been used for 12 months, after emailing you at least 30 days beforehand.</li>
        <li>
          If a payment is disputed, your subscription stops renewing (it stays active until the end of the period already paid for) while we look into it. If
          you dispute a valid charge with your bank instead of contacting us, or a payment turns out to be fraudulent, we may also suspend your account until
          it&rsquo;s resolved, or close it under section 9 if the payment was fraudulent.
        </li>
      </ul>

      <h2>11. Reporting content</h2>
      <p>
        To report content you believe is unlawful or infringes your rights, email {mail} with the link and details. Because content is encrypted, we can&rsquo;t review
        it ourselves, but we can take the steps in section 9, such as turning off a client&rsquo;s link or suspending an account, and we may report it to and
        cooperate with the authorities where the law requires or allows.
      </p>

      <h2>12. Your responsibility for your use</h2>
      <p>
        To the extent the law allows, if you use {LEGAL.product} for a business, you agree to cover our reasonable losses and costs from claims by others (including
        your clients and staff) that arise from your content, your dealings with your clients, or your breach of these terms or the law. This doesn&rsquo;t apply to
        the extent a loss was caused by us.
      </p>

      <h2>13. Help chat</h2>
      <p>
        Our help chat is answered first by an AI assistant, which can make mistakes. It gives general help with using {LEGAL.product} only and isn&rsquo;t legal,
        financial or other professional advice. A person from our team will step in when needed.
      </p>

      <h2>14. Availability and changes</h2>
      <p>
        We work hard to keep {LEGAL.product} running and your recordings safe, but we can&rsquo;t promise the service will always be available or error-free. We may
        improve, change or remove features over time, and we&rsquo;ll tell you in advance about changes that significantly affect you.
      </p>
      <p>
        {LEGAL.product} relies on third-party services such as hosting, payments and email. We&rsquo;re not responsible for their own terms or for outages on their side,
        though we&rsquo;ll do what we reasonably can to keep you working.
      </p>

      <h2>15. Australian Consumer Law</h2>
      <p>
        Nothing in these terms excludes, restricts or modifies any rights you have under the Australian Consumer Law or other laws that can&rsquo;t be excluded. Where
        we&rsquo;re allowed to limit our liability for failing to meet a consumer guarantee, our liability is limited to supplying the service again or paying the cost
        of having it supplied again.
      </p>

      <h2>16. Limit of liability</h2>
      <p>
        To the extent the law allows, we&rsquo;re not liable for indirect or consequential loss, such as lost profits, revenue or data. Our total liability for any
        claim relating to {LEGAL.product} is limited to the greater of the amount paid for {LEGAL.product} in the 12 months before the claim arose and US$50.
      </p>
      <p>
        We&rsquo;re not responsible for delays or failures caused by events outside our reasonable control, such as outages at our providers, internet failures,
        natural disasters or government action.
      </p>

      <h2>17. Closing your account</h2>
      <p>
        You can delete your account at any time in Settings &gt; Account, including before you&rsquo;ve agreed to an updated version of these terms. It&rsquo;s
        closed straight away: you&rsquo;re signed out on every device, your clients&rsquo; links stop working, reminders and other emails stop (reminders that
        come due while it&rsquo;s closed aren&rsquo;t sent later), pending team invites are cancelled, and your plan won&rsquo;t renew. A paid-up plan stays
        until the end of the period you&rsquo;ve paid for, as when you cancel; a subscription with a payment outstanding is cancelled straight away. We email you
        to confirm, and again about {LEGAL.deletionWarningDays} days before it&rsquo;s deleted.
      </p>
      <p>
        We keep your workspace and content for {LEGAL.deletionGraceDays} days in case you change your mind: sign in within that time to reactivate your account
        with everything as it was, except that recordings without cloud backup still leave our servers on their usual schedule, and removed clients whose{" "}
        {LEGAL.removedClientDays} days end meanwhile are still deleted. A browser that was still signed in when you deleted your account can&rsquo;t reactivate
        it: sign in again first. If your paid period ends during those days, your workspace moves to the Free plan, and you can subscribe again after
        reactivating. After {LEGAL.deletionGraceDays} days, your account, workspace and content are permanently deleted and can&rsquo;t be recovered, so save
        anything you want to keep first: save videos from each video&rsquo;s page (text in the data export stays encrypted). To have your account deleted sooner,
        or to cancel the deletion before the date if you can&rsquo;t sign in, email {mail} from your account&rsquo;s email address.
      </p>
      <p>
        If you own a workspace with staff, remove them first. If you&rsquo;re on someone else&rsquo;s team, deleting your account takes you off that team straight
        away. The videos and replies you made for it stay with the team, and if you reactivate your account you&rsquo;ll need a new invite to rejoin.
      </p>
      <p>We may also close accounts as section 9 describes.</p>

      <h2>18. Changes to these terms</h2>
      <p>
        We may update these terms. If a change is significant, we&rsquo;ll email you at least {LEGAL.changeNoticeDays} days before it takes effect. When we update
        them, we&rsquo;ll ask you to read the new version and agree to it by ticking the box before you carry on using {LEGAL.product}, and we keep a record of your
        agreement (see the start of these terms). If you already have an account, you can keep using {LEGAL.product} under the version you agreed to until the
        new one takes effect for you, {LEGAL.changeNoticeDays} days after we email you about it. Continuing to use {LEGAL.product} after agreeing to an updated version means that version applies. If you don&rsquo;t agree to a
        change, don&rsquo;t tick the box: you can stop using {LEGAL.product}, and you can still download your data, cancel your subscription and delete your account
        (see section 17). If you
        use {LEGAL.product} only as a client, through a business&rsquo;s link, the version published here when you use it applies.
      </p>
      <p>
        Each version has a number, shown at the top. Versions from 11 October 2026 onwards are listed in our <Link href="/legal/archive">archive of versions</Link>,
        and we&rsquo;ll send you a copy of any earlier version if you ask.
      </p>

      <h2>19. Disputes</h2>
      <p>
        If you have a problem with {LEGAL.product}, please email {mail} first. We&rsquo;ll both try in good faith to sort it out within 30 days before starting any
        formal claim. This doesn&rsquo;t stop either of us seeking urgent relief from a court.
      </p>

      <h2>20. Governing law</h2>
      <p>
        These terms are governed by the laws of {LEGAL.state}, {LEGAL.country}, and the courts of {LEGAL.state} have jurisdiction. If you&rsquo;re a consumer in
        another country, you keep any protections your local law gives you.
      </p>

      <h2>21. General</h2>
      <ul>
        <li>
          These terms, with our <Link href="/legal/privacy">privacy policy</Link>, our <Link href="/legal/dpa">data processing agreement</Link> (where it
          applies) and our pricing page, are the whole agreement between you and us about {LEGAL.product}.
        </li>
        <li>If part of these terms can&rsquo;t be enforced, the rest still applies. If we don&rsquo;t enforce a term straight away, we can still enforce it later.</li>
        <li>
          We may transfer these terms to someone who takes over {LEGAL.product} or our business, and we&rsquo;ll tell you if that happens. You can&rsquo;t transfer your
          account without our written permission.
        </li>
        <li>We&rsquo;ll send notices to the email address on your account. Send notices to us at {mail}.</li>
      </ul>

      <h2>22. AI transcripts and summaries</h2>
      <p>
        AI transcripts and summaries is an optional paid add-on, off unless the workspace owner switches it on (or asks us to). These points apply to it, on top of the rest of
        these terms:
      </p>
      <ul>
        <li>
          <strong>How it works.</strong> When a team member chooses to make one, a transcript of the video is made on their device, using a speech-to-text model that
          runs in the browser. The transcript text (not the audio or video) is then sent to our AI provider to write a short summary. The transcript and summary are stored
          end-to-end encrypted, and your team and the clients the video was sent to can read them.
        </li>
        <li>
          <strong>Devices and browsers.</strong> Making a transcript needs a recent browser and enough memory, and works best on a computer. On older or low-memory
          devices, phones, some browsers, or with long videos, a transcript may be slow, may not finish, or may not be possible. Poor audio, accents, background noise,
          several people talking at once, or some languages can also mean a transcript is incomplete or can&rsquo;t be made.
        </li>
        <li>
          <strong>Accuracy.</strong> Transcripts and summaries are made by machines. They can mishear words, names and numbers, get things wrong, or leave things out.
          They aren&rsquo;t professional advice (legal, medical, financial or otherwise) and aren&rsquo;t an official record of what was said. Check the video before
          relying on them, and don&rsquo;t use them as the only basis for important decisions.
        </li>
        <li>
          <strong>Telling your clients.</strong> Before switching it on, you&rsquo;re responsible for telling your clients and staff that you use AI transcripts and
          summaries, and for getting any consent the law requires, including under recording, surveillance and privacy laws. Take extra care with sensitive
          information such as health details, and don&rsquo;t use the add-on where you aren&rsquo;t allowed to share that information with a service provider. Your
          clients also see a short note on their pages that you use AI summaries.
        </li>
        <li>
          <strong>Fair use.</strong> Each workspace can make up to {AI_SUMMARIES_PER_MONTH.SOLO} summaries a month on Solo, {AI_SUMMARIES_PER_MONTH.STUDIO} on Studio
          and {AI_SUMMARIES_PER_MONTH.AGENCY} on Agency. Once the limit is reached, summaries pause until the next calendar month (UTC). Transcripts made on your
          devices aren&rsquo;t limited.
        </li>
        <li>
          <strong>Changes.</strong> We may change the speech-to-text model or AI provider, or the models they use, and we may pause or end the add-on (for example if
          a provider is unavailable). If we end it, we&rsquo;ll stop charging for it and give notice as described in section 14.
        </li>
        <li>
          <strong>Refunds.</strong> Please check the add-on works on your devices soon after switching it on; you can switch it off at any time in Settings &gt;
          Billing. We don&rsquo;t refund the add-on fee because a device or browser can&rsquo;t make transcripts, except where the Australian Consumer Law requires
          (see section 15).
        </li>
        <li>
          <strong>Switching it off.</strong> Switching it off stops new transcripts and summaries and removes the add-on from your next bill. Transcripts already made
          stay with their videos until your team removes them or the video is deleted.
        </li>
        <li>Section 16 (limit of liability) applies to any claim about the add-on, including about transcripts or summaries that are missing or wrong.</li>
      </ul>

      <h2>23. Contact</h2>
      <p>Questions about these terms? Email {mail}.</p>
      {LEGAL.postalAddress && <p>Postal address: {LEGAL.postalAddress}</p>}
    </LegalPage>
  );
}
