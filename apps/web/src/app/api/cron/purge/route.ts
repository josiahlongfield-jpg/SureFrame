import { after } from "next/server";
import { abortStaleUploads, pruneLeftovers, purgeExpired } from "@/lib/retention";
import { pruneRateLimits } from "@/lib/rateLimit";
import { pruneSupportUse } from "@/lib/support/allowance";
import { cronAuthorized } from "@/lib/secrets";
import { unlessPaused } from "@/lib/maintenance";
import { pruneTeamNotifications } from "@/lib/teamNotify";
import { warnExpiring } from "@/lib/expiryWarning";
import { reconcileSubscriptions } from "@/lib/subscription";
import { purgeRemovedClients, warnClientPurge } from "@/lib/clientRemoval";
import { purgeScheduledAccounts, warnScheduledDeletions } from "@/lib/accountDeletion";
import { pruneAdminActions } from "@/lib/support/admin";
import { pruneTermsAcceptances } from "@/lib/terms";
import { sendTermsNotices } from "@/lib/termsNotice";
import { purgeHeldReplies } from "@/lib/replies";
import { pruneClientQuestions, sendClientQuestionDigest } from "@/lib/support/clientQuestions";

export const maxDuration = 300;

const JOBS = ["purged", "rateLimits", "supportUse", "staleUploads", "teamNotifications", "leftovers", "expiryWarnings", "clientsPurged", "clientWarnings", "accountWarnings", "accountsPurged", "adminActionsPruned", "agreementsPruned", "termsNotices", "unsentReplies", "clientQuestionDigest", "clientQuestionsPruned"] as const;

/** Run daily (e.g. Vercel Cron) with Authorization: Bearer $CRON_SECRET. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  // Each job runs even if another fails, so one storage hiccup doesn't skip the rest.
  // Checked after the response, so a slow Stripe doesn't hold up the clean-up.
  after(() => reconcileSubscriptions().catch((err) => console.error(JSON.stringify({ level: "error", message: "[cron/purge] subscription check failed", error: String(err) }))));
  // While maintenance mode is on, emails and deletions wait (lib/maintenance.ts).
  const results = await Promise.allSettled([
    // Mostly done by the 5-minute job by now; this works through any backlog.
    unlessPaused(() => purgeExpired(new Date(), 120_000)),
    pruneRateLimits(),
    // Help-chat allowance records for people who aren't paying, after 31 days.
    pruneSupportUse(),
    abortStaleUploads(),
    pruneTeamNotifications(),
    pruneLeftovers(),
    // Normally sent by the 5-minute reminders job; this catches anything it missed.
    unlessPaused(() => warnExpiring()),
    // Removed clients whose 30 days are up, and the business's warning 3 days before (also every 5 minutes).
    unlessPaused(() => purgeRemovedClients(new Date(), 120_000)),
    unlessPaused(() => warnClientPurge()),
    // Closed accounts: the reminder 3 days before, and deletion once the date comes (also every 5 minutes).
    unlessPaused(() => warnScheduledDeletions()),
    unlessPaused(() => purgeScheduledAccounts(new Date(), 120_000)),
    // Support records and records of agreeing to the terms, older than 7 years.
    pruneAdminActions(),
    pruneTermsAcceptances(),
    // Existing account holders told about new Terms and Privacy versions, 30 days before they take effect for them.
    unlessPaused(() => sendTermsNotices()),
    // Video and voice replies their authors never sent, 7 days after recording (lib/replies.ts).
    unlessPaused(() => purgeHeldReplies(new Date(), 60_000)),
    // Client help questions: the support inbox's weekly digest (checked daily, sent once a week), and the 90-day clean-up.
    unlessPaused(() => sendClientQuestionDigest()),
    pruneClientQuestions(),
  ]);
  const out: Partial<Record<(typeof JOBS)[number], unknown>> = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") out[JOBS[i]] = r.value;
    else {
      out[JOBS[i]] = "failed";
      console.error(JSON.stringify({ level: "error", message: `[cron/purge] ${JOBS[i]} failed`, error: String(r.reason) }));
    }
  });
  const { purged, expiryWarnings, clientsPurged, clientWarnings, accountWarnings, accountsPurged, adminActionsPruned, agreementsPruned, termsNotices, unsentReplies, clientQuestionDigest, clientQuestionsPruned } = out;
  return Response.json({ purged, expiryWarnings, clientsPurged, clientWarnings, accountWarnings, accountsPurged, adminActionsPruned, agreementsPruned, termsNotices, unsentReplies, clientQuestionDigest, clientQuestionsPruned });
}
