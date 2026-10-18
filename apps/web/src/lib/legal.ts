import { BRAND } from "@/lib/brand";
import {
  ADMIN_ACTION_KEEP_YEARS,
  CLIENT_KEEP_DAYS,
  CLOSURE_DELETE_DAYS,
  CLIENT_PURGE_WARN_DAYS,
  DELETION_GRACE_DAYS,
  DELETION_WARN_DAYS,
  REVIEW_DAYS,
  TERMS_NOTICE_DAYS,
  TERMS_RECORD_KEEP_YEARS,
  CLIENT_QUESTION_KEEP_DAYS,
} from "@/lib/periods";
import { RETENTION_DAYS } from "@/lib/retention";
import { HELD_REPLY_DAYS } from "@/lib/heldReplies";

/**
 * Who runs the service, for the terms, privacy policy and data processing
 * agreement. The pages leave out the postal address while it's null.
 */
export const LEGAL = {
  product: BRAND.name,
  /**
   * SureFrame is registered with ASIC as the owner's business name (approved 14 October 2026). The pages name the
   * business and its ABN, not the owner (Josiah, 16 October 2026): the ABN identifies the sole trader behind it.
   */
  businessNameRegistered: true,
  abn: "38 364 192 034" as string | null,
  postalAddress: "PO Box 717, Rochedale South QLD 4123, Australia" as string | null,
  email: "support@sureframe.app",
  website: "sureframe.app",
  state: "Queensland",
  country: "Australia",
  minimumAge: 18,
  retentionDays: RETENTION_DAYS,
  /** Unsent video and voice replies are deleted this many days after they were recorded. */
  heldReplyDays: HELD_REPLY_DAYS,
  /** A removed client is kept this long, so the business can restore them, then deleted. */
  removedClientDays: CLIENT_KEEP_DAYS,
  /** The business is warned about this long before a removed client is deleted. */
  removedClientWarningDays: CLIENT_PURGE_WARN_DAYS,
  /** A deleted account is kept this long, so it can be reactivated, then permanently deleted. */
  deletionGraceDays: DELETION_GRACE_DAYS,
  /** An account we close is kept this long (the review time plus two weeks), then permanently deleted. */
  closureDeleteDays: CLOSURE_DELETE_DAYS,
  /** The account holder is reminded about this long before a deleted account is deleted for good. */
  deletionWarningDays: DELETION_WARN_DAYS,
  /** Records of support actions on accounts are kept this long. */
  supportRecordYears: ADMIN_ACTION_KEEP_YEARS,
  /** Questions typed into the help chat on client pages are kept this long. */
  clientQuestionDays: CLIENT_QUESTION_KEEP_DAYS,
  /** Records of agreeing to the Terms and Privacy Policy are kept this long. */
  agreementRecordYears: TERMS_RECORD_KEEP_YEARS,
  /** Time to ask us to review a suspension, closure or turned-off link. */
  reviewDays: REVIEW_DAYS,
  /** Existing account holders are emailed this long before a significant change takes effect for them (lib/terms.ts). */
  changeNoticeDays: TERMS_NOTICE_DAYS,
  /**
   * The versions people agree to on /agree (lib/terms.ts). Change one whenever its page changes in a way
   * people should agree to again, add the new version to LEGAL_VERSIONS, and keep the old text (git history,
   * and on request).
   */
  termsVersion: "2026-10-11",
  privacyVersion: "2026-10-11",
  dpaVersion: "1.0",
  /** When the DPA's current version took effect (it has its own numbering, not the dated versions in LEGAL_VERSIONS). */
  dpaSince: "11 October 2026",
  updated: "11 October 2026",
  /**
   * The Terms page's own "last updated" date. A change that only adds to what customers get (founding prices and
   * discount offers, 13 October 2026) isn't one to agree to again, so it keeps termsVersion and moves only this.
   * Discount codes limited to starting a subscription or moving up a plan, codes given to one business for one use, and the
   * referral programme (16 October 2026) keep it too: they only add to what customers get, and the site was closed for maintenance.
   * "Keep me signed in" and cancelling in Settings > Billing (17 October 2026) only add choices, so they keep it too.
   * Letting a code given to one business be added to a plan it already pays for, from its next bill (18 October 2026), only adds to
   * what customers get, so it keeps it too.
   * Saying the help chat on client pages is AI only and points clients to the business (18 October 2026) explains a new help option, so it keeps it too.
   */
  termsUpdated: "18 October 2026",
  /**
   * The Data Processing Agreement's own "last updated" date: "Keep me signed in" added to its security measures (17 October 2026).
   * Google sign-in taken out of its security measures, since only email sign-in links are offered, and file storage's location
   * worded plainly (18 October 2026): they describe what we already do, so it keeps dpaVersion.
   */
  dpaUpdated: "18 October 2026",
  /**
   * The Privacy Policy page's own "last updated" date. Describing discount codes, referrals and the sf_offer cookie
   * (16 October 2026) only explains more of what we already do, so it keeps privacyVersion. So do a short section for
   * clients, the intro shown once per device, "Keep me signed in" and its cookies, and clients deleting their own replies
   * (17 October 2026): they explain what we do or add choices, and take nothing away. Unsent video and voice replies
   * being deleted after 7 days (18 October 2026) keeps less, for less time, so it keeps privacyVersion too. Describing the
   * help chat on client pages and the question text it keeps for 90 days (18 October 2026) explains a new, optional help
   * feature that takes nothing away, so it keeps privacyVersion too. So does saying that an invited team member is
   * emailed to expect their link, and that a replaced client link is kept only as a one-way fingerprint, taking out
   * "Continue with Google", which isn't offered (only email sign-in links are), and saying plainly where recordings are
   * stored (18 October 2026).
   */
  privacyUpdated: "18 October 2026",
};

/**
 * Every version of the Terms of Service and Privacy Policy people have agreed to, newest first, for
 * /legal/archive. `changes` is the plain summary shown to existing account holders on /agree. A record of
 * that version, so its numbers are written out rather than read from today's settings.
 */
export const LEGAL_VERSIONS = [
  {
    terms: "2026-10-11",
    privacy: "2026-10-11",
    date: "11 October 2026",
    changes: [
      "The Free plan now includes 25 videos in total per workspace, not 25 a month. Deleting a video doesn’t give a place back.",
      "Removed clients and deleted accounts are kept for 30 days so they can be restored, then deleted for good.",
      "We explain when we may suspend or close an account or turn off a client’s link, sometimes without warning, and how to ask for a review.",
      "We added a section for people in the EU and UK and a data processing agreement for businesses, and we now keep a record of when you agree to these documents.",
    ],
  },
];

export const operatorLine = () =>
  `${LEGAL.product}${LEGAL.abn ? ` (ABN ${LEGAL.abn})` : ""} is ${LEGAL.businessNameRegistered ? "a registered business name of" : "run by"} a sole trader based in ${LEGAL.state}, ${LEGAL.country}`;

/**
 * Where Neon and the Cloudflare R2 bucket keep data. Null until confirmed: the pages then give no location. R2's is
 * Cloudflare's "Oceania" region; it's spelt out because the bare region name means little to most readers (V23).
 */
export const NEON_LOCATION: string | null = "United States";
export const R2_LOCATION: string | null = "Oceania region (Australia, New Zealand and the Pacific)";

/** Where data is kept, in the same words on the home page, FAQ, About page and Privacy Policy. */
export const DATA_LOCATIONS = `${R2_LOCATION ? `Encrypted video and voice recordings are stored in the ${R2_LOCATION}. Our other providers` : "Our providers"} store and process information outside Australia, mainly in the United States.`;

export type Subprocessor = {
  name: string;
  /** What we use them for, shown in brackets after the name. */
  purpose: string;
  /** The personal information they handle. */
  data: string;
  /** Where they store or process it, as a country or region. Null leaves it out. */
  location: string | null;
  /** Handles personal information we process for businesses, so it's listed in the DPA's Annex 3. */
  customerData: boolean;
};

/**
 * Service providers that handle personal information for us. The privacy
 * policy lists them all; the DPA lists those with `customerData`. Stripe
 * and Link aren't here: they're separate controllers.
 */
export const SUBPROCESSORS: Subprocessor[] = [
  {
    name: "Vercel",
    purpose: "hosting the website and app",
    data: "everything sent to or from the website and app passes through it, and it keeps request logs, including IP addresses",
    location: "United States",
    customerData: true,
  },
  {
    name: "Neon",
    purpose: "our database",
    data: "account, team, client, billing and support details, details of videos we can read (such as titles), records of support actions and of agreement to our terms, and the encrypted text of replies, to-dos, notes, transcripts and summaries",
    location: NEON_LOCATION,
    customerData: true,
  },
  {
    name: "Cloudflare R2",
    purpose: "file storage",
    data: "encrypted video and voice recordings",
    location: R2_LOCATION,
    customerData: true,
  },
  {
    name: "Resend",
    purpose: "email delivery",
    data: "names, email addresses and the emails we send, such as sign-in links, client links, reminders and team emails",
    location: "United States",
    customerData: true,
  },
  {
    name: "Anthropic",
    purpose: "the help chat’s AI assistant, and AI summaries for businesses that switch them on",
    data: "help chat messages, and transcript text when a business uses AI summaries",
    location: "United States",
    customerData: true,
  },
  {
    name: "Google Workspace",
    purpose: "our support email",
    data: "emails to and from our support inbox, including help chats passed to a person",
    location: "United States",
    customerData: true,
  },
];

/** When the sub-processor list last changed. Follows the pages' date until the list changes on its own. */
export const SUBPROCESSORS_UPDATED: string = LEGAL.updated;
