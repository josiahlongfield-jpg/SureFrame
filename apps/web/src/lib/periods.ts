/**
 * How long things are kept, in one place for the code that keeps them and for
 * the legal pages (lib/legal.ts). No imports, so anything can use it without
 * an import cycle.
 */

/** A removed client is kept this long, so the business can restore them, then deleted (lib/clientRemoval.ts). */
export const CLIENT_KEEP_DAYS = 30;
/** The business is warned this long before a removed client is deleted. */
export const CLIENT_PURGE_WARN_DAYS = 3;
/**
 * A deleted or closed account is kept this long, then deleted for good (lib/accountDeletion.ts).
 * Fixed on purpose: not RETENTION_DAYS, which can be changed per deployment.
 */
export const DELETION_GRACE_DAYS = 30;
/** The account holder is reminded this long before a closed account is deleted. */
export const DELETION_WARN_DAYS = 3;
/** Time to ask for a review of a suspension, closure or turned-off link (support's notices, the Terms). */
export const REVIEW_DAYS = 30;
/**
 * An account support closed is deleted this long after the closure (lib/support/admin.ts closeAccount):
 * the review window plus two weeks, so a review asked for on its last day can still reopen it.
 */
export const CLOSURE_DELETE_DAYS = REVIEW_DAYS + 14;
/** Support records (AdminAction) are kept this long: tax and legal-claims periods (lib/support/admin.ts). */
export const ADMIN_ACTION_KEEP_YEARS = 7;
/** Records of agreeing to the Terms and Privacy Policy (TermsAcceptance) are kept this long (lib/terms.ts). */
export const TERMS_RECORD_KEEP_YEARS = 7;
/**
 * Existing account holders are emailed about new Terms and Privacy Policy versions this long before they take effect
 * for them (lib/terms.ts sendTermsNotices); until then they carry on under the version they agreed to.
 */
export const TERMS_NOTICE_DAYS = 30;
/** Questions clients type into the help chat on their pages are kept this long for the weekly digest (lib/support/clientQuestions.ts). */
export const CLIENT_QUESTION_KEEP_DAYS = 90;
/**
 * The weekly digest of those questions emailed to the support inbox is kept this many months (Terms 13, Privacy Policy;
 * decision 7, 22 October 2026). The digest records in the database go after a year (pruneClientQuestions); the emails
 * themselves are deleted from the support inbox by hand or an inbox rule.
 */
export const CLIENT_QUESTION_DIGEST_KEEP_MONTHS = 12;
