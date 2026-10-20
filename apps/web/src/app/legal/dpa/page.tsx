import Link from "next/link";
import LegalPage, { SubprocessorList } from "@/components/LegalPage";
import { LEGAL, operatorLine, R2_LOCATION, SUBPROCESSORS_UPDATED } from "@/lib/legal";

export const metadata = { title: "Data Processing Agreement" };

export default function Page() {
  const mail = <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;
  return (
    <LegalPage title="Data Processing Agreement" version={LEGAL.dpaVersion} updated={LEGAL.dpaUpdated}>
      <p>
        {operatorLine()} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). This Data Processing Agreement (&ldquo;DPA&rdquo;) forms part of the {LEGAL.product}{" "}
        <Link href="/legal/terms">Terms of Service</Link> (the &ldquo;Terms&rdquo;) between us and the business that uses {LEGAL.product} (&ldquo;you&rdquo;). It
        applies when we process personal data for you that is protected by Data Protection Law. You accept it by accepting the Terms, so there&rsquo;s nothing to
        sign. If you need a signed copy, email {mail}.
      </p>

      <h2>1. Definitions</h2>
      <ul>
        <li>
          &ldquo;Data Protection Law&rdquo; means Regulation (EU) 2016/679 (the &ldquo;EU GDPR&rdquo;), the EU GDPR as it forms part of the law of the United
          Kingdom (the &ldquo;UK GDPR&rdquo;) with the UK Data Protection Act 2018, and the laws that supplement them, as far as they apply to the processing.
        </li>
        <li>
          &ldquo;Customer Personal Data&rdquo; means personal data that you or your team put into {LEGAL.product}, or that your clients give through it, and that we
          process for you.
        </li>
        <li>&ldquo;Sub-processor&rdquo; means a third party we use that processes Customer Personal Data.</li>
        <li>&ldquo;SCCs&rdquo; means the standard contractual clauses annexed to Commission Implementing Decision (EU) 2021/914.</li>
        <li>
          &ldquo;UK Addendum&rdquo; means the International Data Transfer Addendum to the EU SCCs issued by the UK Information Commissioner under section 119A of
          the Data Protection Act 2018.
        </li>
        <li>
          Controller, processor, personal data, processing, personal data breach, data subject and supervisory authority have the meanings given in Data Protection
          Law.
        </li>
      </ul>

      <h2>2. Roles</h2>
      <p>
        You&rsquo;re the controller of Customer Personal Data and we&rsquo;re your processor. If you act as a processor for someone else, you confirm they&rsquo;ve
        authorised your instructions and this DPA, and we&rsquo;re your sub-processor.
      </p>
      <p>
        Information we handle for our own purposes isn&rsquo;t covered by this DPA: your account, sign-in, billing and support information, the questions your
        clients type into the help chat on their pages (kept with your business&rsquo;s name but not who asked, for {LEGAL.clientQuestionDays} days, and listed in
        a weekly email to our support inbox, so we can find and fix problems), the information we use to keep {LEGAL.product} secure, records of agreement to the Terms and our privacy policy, and the records we keep when we act under section 9 of the Terms
        (which can include, for example, the name and email address of a client whose link we turned off). We&rsquo;re the controller of that information, and our <Link href="/legal/privacy">privacy policy</Link> covers it.
      </p>

      <h2>3. Details of the processing</h2>
      <p>This section also completes Annex I.B of the SCCs.</p>
      <ul>
        <li>
          <strong>Subject matter and purpose:</strong> providing {LEGAL.product} to you under the Terms.
        </li>
        <li>
          <strong>Duration:</strong> while you use {LEGAL.product}, plus the deletion periods in section 10.
        </li>
        <li>
          <strong>Nature:</strong>
          <ul>
            <li>storing, relaying and deleting end-to-end encrypted content;</li>
            <li>storing client and team details and using them to send links, reminders and notifications;</li>
            <li>controlling who can access what, including pausing, suspending or turning off access as the Terms describe;</li>
            <li>and, only if you switch on the AI add-on, sending transcript text to our AI provider for a summary.</li>
          </ul>
        </li>
        <li>
          <strong>Data subjects:</strong> your clients (and parents or guardians acting for them), your staff and team members, and anyone who appears in, or is
          mentioned in, content.
        </li>
        <li>
          <strong>Categories of personal data:</strong>
          <ul>
            <li>
              Information we can read: client names and email addresses, link status (when a link was sent or first opened, and whether it&rsquo;s paused, removed
              or turned off), reminder preferences and assignments; staff names, email addresses, roles, permissions and settings; video titles, reply author
              names, dates, sizes, lengths and view counts; to-do due dates and repeat and reminder settings; reminder messages and staff reminders; and Team
              overview activity figures.
            </li>
            <li>
              Content that is end-to-end encrypted, which we can&rsquo;t read: video and voice recordings, video stills, text replies, to-dos, notes, transcripts and
              summaries.
            </li>
            <li>Transcript text, while it&rsquo;s sent for an AI summary.</li>
          </ul>
        </li>
        <li>
          <strong>Special categories:</strong> we don&rsquo;t ask for them, but content may contain them (for example health details). They stay end-to-end
          encrypted, except transcript text you choose to send for a summary.
        </li>
        <li>
          <strong>Frequency:</strong> continuous.
        </li>
      </ul>

      <h2>4. Your instructions</h2>
      <p>
        We process Customer Personal Data only on your documented instructions. These are the Terms (including section 9 on suspension, closure and legal hold),
        this DPA, and how you and your team set up and use {LEGAL.product}. We&rsquo;ll tell you if we think an instruction breaks Data Protection Law. If the law
        requires us to process Customer Personal Data in another way, we&rsquo;ll tell you first, unless that law forbids it.
      </p>

      <h2>5. Your responsibilities</h2>
      <p>You&rsquo;re responsible for:</p>
      <ul>
        <li>having a lawful basis for the Customer Personal Data;</li>
        <li>giving your clients and staff the information the law requires, including about the Team page and the AI add-on;</li>
        <li>keeping your devices, recovery key and client links secure;</li>
        <li>and making sure your instructions comply with Data Protection Law.</li>
      </ul>

      <h2>6. Confidentiality</h2>
      <p>
        Everyone we allow to access Customer Personal Data is bound by confidentiality and accesses only what they need. Today that&rsquo;s {LEGAL.product}&rsquo;s owner
        and anyone they authorise to help run {LEGAL.product}.
      </p>

      <h2>7. Security</h2>
      <p>
        We use the measures in <a href="#security">Annex 2</a> and keep them appropriate to the risk. We may change them, but not in a way that lowers the overall
        protection.
      </p>

      <h2>8. Sub-processors</h2>
      <p>
        You authorise the sub-processors in <a href="#subprocessors">Annex 3</a>. Each is bound by a written contract with data protection terms that protect
        Customer Personal Data at least as well as this DPA does, as far as they apply to its service. We remain responsible to you for their work. We&rsquo;ll
        update Annex 3 and email the workspace owner at least 30 days before a new sub-processor starts processing Customer Personal Data. If you object on
        reasonable data protection grounds, email {mail} within that time and we&rsquo;ll work with you in good faith. If we can&rsquo;t resolve it, you may delete
        your account, and we&rsquo;ll refund any fees you&rsquo;ve prepaid for the period after that.
      </p>

      <h2>9. Helping you</h2>
      <ul>
        <li>
          {LEGAL.product} lets you see, export, correct and delete Customer Personal Data yourself: on the Clients page, on each video, and in Settings &gt; Account.
        </li>
        <li>
          If a data subject contacts us about Customer Personal Data, we&rsquo;ll pass the request to you without undue delay and won&rsquo;t answer it ourselves,
          except to direct them to you, unless you ask us to.
        </li>
        <li>
          We&rsquo;ll give you reasonable help with your security obligations, breach notifications, data protection impact assessments and consultations with
          supervisory authorities, taking into account the nature of the processing and the information available to us. Because content is end-to-end encrypted,
          we can only help with the information we can read.
        </li>
      </ul>

      <h2>10. Deletion and return</h2>
      <ul>
        <li>Without cloud backup, recordings are deleted from our servers {LEGAL.retentionDays} days after they&rsquo;re recorded.</li>
        <li>
          A video or voice reply that was recorded but never sent is deleted {LEGAL.heldReplyDays} days after it was recorded, with or without cloud backup.
        </li>
        <li>
          When you remove a client, their link stops working straight away, and we delete their details and conversations {LEGAL.removedClientDays} days later,
          even with cloud backup, unless you restore them first. Recordings you also sent to other clients stay with those clients.
        </li>
        <li>
          When you delete your account, we keep Customer Personal Data for {LEGAL.deletionGraceDays} days so you can reactivate it, then delete it. If we close your
          account under section 9 of the Terms, we delete it {LEGAL.closureDeleteDays} days after closure (or on the date already set, if you&rsquo;d already
          deleted your account). Either way, a legal hold (below) can keep it longer.
        </li>
        <li>
          If we need to keep Customer Personal Data longer because the law requires it, or for a legal claim or a report to the authorities (a legal hold, as
          section 9 of the Terms describes), we keep only what we need, keep protecting it under this DPA, and delete it once it&rsquo;s no longer needed.
        </li>
        <li>
          Before your account is deleted, you can download your data in Settings &gt; Account and save videos to your device (if you deleted your account, keep it
          first). If we close your account under section 9 of the Terms, you can&rsquo;t sign in, so email {LEGAL.email} within {LEGAL.reviewDays} days of the
          closure and we&rsquo;ll send you your account data download, unless the law stops us. Encrypted content is returned in encrypted form, which only your
          keys can open.
        </li>
        <li>Deleted data may remain in our providers&rsquo; backups until those backups expire, and this DPA keeps applying to it until then.</li>
      </ul>

      <h2>11. Personal data breaches</h2>
      <p>
        We&rsquo;ll notify the workspace owner by email without undue delay after becoming aware of a personal data breach affecting Customer Personal Data.
        We&rsquo;ll include what we know of its nature, the categories and approximate numbers of people and records affected, the likely consequences, the measures
        taken or proposed, and who to contact. We&rsquo;ll add more as we learn it, and take reasonable steps to contain the breach. Notifying you isn&rsquo;t an
        admission of fault.
      </p>

      <h2>12. Information and audits</h2>
      <p>
        We&rsquo;ll give you the information you reasonably need to show we meet Article 28 of the EU GDPR (or the UK GDPR), including written answers to a
        reasonable security questionnaire once a year, or after a breach. If that isn&rsquo;t enough to meet a requirement of Data Protection Law or a supervisory
        authority&rsquo;s request:
      </p>
      <ul>
        <li>you, or an independent auditor bound by confidentiality who isn&rsquo;t our competitor, may audit our processing;</li>
        <li>you give at least 30 days&rsquo; notice, and the audit happens during {LEGAL.state} business hours, by document review and remote sessions;</li>
        <li>it happens no more than once a year, except after a breach or at an authority&rsquo;s request;</li>
        <li>and it&rsquo;s at your cost.</li>
      </ul>
      <p>Our providers are audited through their own reports.</p>

      <h2>13. International transfers</h2>
      <p>
        We&rsquo;re in {LEGAL.country}.{" "}
        {R2_LOCATION ? `Encrypted recordings are stored in the ${R2_LOCATION}, and our other sub-processors are` : "Our sub-processors are"} mainly in the United
        States (<a href="#subprocessors">Annex 3</a>).
      </p>
      <ul>
        <li>
          <strong>EU and EEA:</strong> for transfers of Customer Personal Data from the European Economic Area, the SCCs are incorporated into this DPA by reference:
          <ul>
            <li>Module 2 applies where you&rsquo;re a controller, and Module 3 where you&rsquo;re a processor.</li>
            <li>You&rsquo;re the data exporter and we&rsquo;re the data importer.</li>
            <li>Clause 7 applies.</li>
            <li>Clause 9(a) Option 2 applies, with the notice period in section 8.</li>
            <li>The optional wording in Clause 11 doesn&rsquo;t apply.</li>
            <li>The supervisory authority under Clause 13 is the one that clause determines.</li>
            <li>Under Clause 17, the SCCs are governed by the laws of Ireland, and under Clause 18, disputes go to the courts of Ireland.</li>
            <li>Annexes I, II and III of the SCCs are completed by section 3 and Annexes 1, 2 and 3 of this DPA.</li>
          </ul>
        </li>
        <li>
          <strong>UK:</strong> for transfers from the United Kingdom, the UK Addendum applies and is incorporated by reference:
          <ul>
            <li>Table 1: the parties are as in Annex 1.</li>
            <li>Table 2: the SCCs, with the modules and options above.</li>
            <li>Table 3: section 3 and Annexes 1 to 3.</li>
            <li>Table 4: either party may end the UK Addendum as allowed by its Section 19.</li>
          </ul>
        </li>
        <li>
          <strong>Onward transfers</strong> to sub-processors are made under contracts that include the SCCs or another safeguard Data Protection Law recognises.
        </li>
        <li>
          <strong>Order of precedence:</strong> if there&rsquo;s a conflict, the SCCs and the UK Addendum prevail over this DPA, and this DPA prevails over the
          Terms.
        </li>
      </ul>

      <h2>14. Liability</h2>
      <p>
        Each party&rsquo;s liability under this DPA is subject to section 16 of the Terms, except where Data Protection Law or the SCCs don&rsquo;t allow it to be
        limited, such as liability to data subjects.
      </p>

      <h2>15. Term, changes and governing law</h2>
      <p>
        This DPA lasts while we process Customer Personal Data for you. We may update it to reflect changes in the law, the SCCs or our sub-processors. We won&rsquo;t
        reduce its protection, and significant changes follow section 18 of the Terms. Apart from the SCCs and the UK Addendum, it&rsquo;s governed by section 20
        of the Terms.
      </p>

      <h2>16. Contact</h2>
      <p>
        {LEGAL.product}, {mail}
        {LEGAL.postalAddress && <>, {LEGAL.postalAddress}</>}. We haven&rsquo;t appointed a data protection officer or a representative in the EU or UK.
      </p>

      <h2 id="parties">Annex 1: Parties</h2>
      <ul>
        <li>
          <strong>Data exporter:</strong> the business named in its {LEGAL.product} account. Contact: the workspace owner&rsquo;s email address. Activities: using{" "}
          {LEGAL.product} as described in section 3. Role: controller (or processor).
        </li>
        <li>
          <strong>Data importer:</strong> {LEGAL.product}, the registered business name of a sole trader
          {LEGAL.abn && <>, ABN {LEGAL.abn}</>}
          {LEGAL.postalAddress && <>, {LEGAL.postalAddress}</>}, {mail}. Activities: providing {LEGAL.product} as described in section 3. Role: processor.
        </li>
        <li>
          <strong>Signature and date:</strong> both parties agree to this DPA, including the SCCs and the UK Addendum where they apply, when the data exporter
          accepts the Terms (by ticking the box we show, which we keep a record of), and that acceptance counts as signing it on that date.
        </li>
        <li>The rest of Annex I of the SCCs is completed by section 3 (description of the transfer) and section 13 (competent supervisory authority).</li>
      </ul>

      <h2 id="security">Annex 2: Security measures</h2>
      <ul>
        <li>
          <strong>End-to-end encryption:</strong> recordings are encrypted on the recording device, chunk by chunk, with AES-256-GCM using the browser&rsquo;s Web
          Crypto, before they&rsquo;re uploaded; while recording, the encrypted recording is uploaded in pieces every few seconds. Video stills, text replies,
          to-dos, notes, transcripts and summaries are encrypted on the device the same way before they&rsquo;re saved.
        </li>
        <li>
          <strong>Keys stay with you:</strong> keys are made on your team&rsquo;s devices, and our servers store only encrypted (wrapped) copies of them. Each
          client&rsquo;s key travels only in the part of their personal link after &ldquo;#&rdquo;, which browsers don&rsquo;t send to servers. When an owner or admin
          removes a staff member, the team key and every client key and link are replaced.
        </li>
        <li>
          <strong>Encryption in transit:</strong> the website and app are served over HTTPS only, with HSTS (2 years, including subdomains). Our servers connect to
          our providers over encrypted connections.
        </li>
        <li>
          <strong>Browser protections:</strong> other sites can&rsquo;t show our pages in a frame; content-type sniffing is blocked; referrers stay within our site;
          and camera, microphone and screen access is limited to our own site.
        </li>
        <li>
          <strong>Storage:</strong> browsers get signed, short-lived links to files. Upload links are valid for 15 minutes and limited to the exact size of the
          piece or part being uploaded. Playback links are valid for 1 hour.
        </li>
        <li>
          <strong>Access control:</strong> roles and permissions are checked by our servers on every request, and staff see only the clients assigned to them
          unless an owner or admin allows more. Clients get access only through their secret personal link, which stops working if the business removes them or
          its plan no longer covers them, or if we turn the link off or suspend or close the business&rsquo;s account. Our support tools are limited to named
          accounts, and we record each action taken with them.
        </li>
        <li>
          <strong>Sign-in:</strong> passwordless sign-in links that work once and expire after 24 hours. Sessions usually
          end when the browser closes, and after 8 hours without use; someone who ticks &ldquo;Keep me signed in&rdquo; when signing in, or turns it on later in
          Settings, stays signed in on that device for 30 days from when it was turned on. We can sign a login out on every device. Repeated attempts are rate-limited, and
          scheduled jobs need a secret to run.
        </li>
        <li>
          <strong>Data minimisation:</strong> notification emails don&rsquo;t include video titles, replies or to-do text. Copies of recordings are deleted from our servers
          automatically (see section 10). Recordings left unfinished are completed from their encrypted copy once untouched for at least 6 hours, leftover
          pieces are deleted after about a day, and uploads that can&rsquo;t be completed are removed after a week. Expired sign-in links are deleted, and IP addresses counted for rate limits
          are deleted within about two days (the help chat&rsquo;s limits for visitors and Free plans keep only a one-way fingerprint, for 31 days).
        </li>
        <li>
          <strong>AI add-on:</strong> transcripts are made on the team member&rsquo;s device, from a speech model served from our own storage. Only transcript text
          is sent for a summary; we don&rsquo;t log or store it in readable form, and the transcript and summary are saved end-to-end encrypted.
        </li>
      </ul>

      <h2 id="subprocessors">Annex 3: Sub-processors</h2>
      <p>We use these sub-processors for Customer Personal Data. List last changed {SUBPROCESSORS_UPDATED}.</p>
      <SubprocessorList customerData />
    </LegalPage>
  );
}
