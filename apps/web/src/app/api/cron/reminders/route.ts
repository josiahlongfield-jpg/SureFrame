import { runReminders } from "@/lib/reminders";
import { purgeExpired } from "@/lib/retention";
import { flushTeamNotifications } from "@/lib/teamNotify";
import { cronAuthorized } from "@/lib/secrets";
import { unlessPaused } from "@/lib/maintenance";
import { warnExpiring } from "@/lib/expiryWarning";
import { purgeRemovedClients, warnClientPurge } from "@/lib/clientRemoval";
import { purgeScheduledAccounts, warnScheduledDeletions } from "@/lib/accountDeletion";

export const maxDuration = 300;

const JOBS = ["reminders", "digests", "expiryWarnings", "purged", "clientWarnings", "clientsPurged", "accountWarnings", "accountsPurged"] as const;

/** Run every few minutes (e.g. Vercel Cron) with Authorization: Bearer $CRON_SECRET. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  // Each job runs even if another fails, so one bad row can't hold up the rest.
  // While maintenance mode is on, emails and deletions wait (lib/maintenance.ts).
  const results = await Promise.allSettled([
    unlessPaused(() => runReminders()),
    // Team emails held back by the 15-minute limit go out as a digest.
    unlessPaused(() => flushTeamNotifications()),
    // Recorders hear ~24 hours before a relay copy is deleted (lib/expiryWarning.ts).
    unlessPaused(() => warnExpiring()),
    // Copies are deleted close to the time shown, not just once a day.
    unlessPaused(() => purgeExpired(new Date(), 20_000)),
    // Removed clients: the business hears ~3 days ahead, and they're deleted close to the date shown.
    unlessPaused(() => warnClientPurge()),
    unlessPaused(() => purgeRemovedClients(new Date(), 20_000)),
    // Closed accounts: reminded ~3 days ahead, and deleted close to the date shown.
    unlessPaused(() => warnScheduledDeletions()),
    unlessPaused(() => purgeScheduledAccounts(new Date(), 20_000)),
  ]);
  const out: Record<string, unknown> = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") out[JOBS[i]] = r.value;
    else {
      out[JOBS[i]] = "failed";
      console.error(JSON.stringify({ level: "error", message: `[cron/reminders] ${JOBS[i]} failed`, error: String(r.reason) }));
    }
  });
  const reminders = out.reminders;
  return Response.json({ ...(typeof reminders === "object" && reminders ? reminders : { reminders }), digests: out.digests, expiryWarnings: out.expiryWarnings, purged: out.purged, clientWarnings: out.clientWarnings, clientsPurged: out.clientsPurged, accountWarnings: out.accountWarnings, accountsPurged: out.accountsPurged });
}
