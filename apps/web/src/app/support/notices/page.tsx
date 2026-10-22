import Link from "next/link";
import { db } from "@/lib/db";
import { qldTime } from "@/lib/support/when";
import { earliestStart, longDate, NOTICE_ACTION, NOTICE_DAYS, NOTICE_SUBJECT, noticeRecipients } from "@/lib/support/subprocessorNotice";
import { consoleAdmin } from "../_console/ui";
import { supportTitle } from "../_console/meta";
import NoticeForm from "./NoticeForm";

export const generateMetadata = supportTitle("Sub-processor notice", "admin", { robots: { index: false } });

type Details = { name?: string; purpose?: string; location?: string; startsOn?: string; recipients?: number; sent?: number; status?: string };

/**
 * Support admins: email every business owner that a new sub-processor starts on a date at least 30 days away, as the
 * DPA (section 8) promises (decision 22). Update the list in lib/legal.ts (SUBPROCESSORS) as well.
 */
export default async function Notices() {
  await consoleAdmin("/support/notices");
  const [owners, past] = await Promise.all([
    noticeRecipients().then((r) => r.length),
    db.adminAction.findMany({ where: { action: NOTICE_ACTION }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">New sub-processor notice</h1>
      <p className="mt-2 text-sm text-muted">
        Our Data Processing Agreement (section 8) promises every business owner an email at least {NOTICE_DAYS} days before a new sub-processor starts
        handling their customers&rsquo; information. This sends that email, headed &ldquo;{NOTICE_SUBJECT}&rdquo;, to all {owners} business owner
        {owners === 1 ? "" : "s"} and records it in the <Link href="/support/log" className="font-medium text-accent hover:underline">Support log</Link>. Add the
        sub-processor to the list in the Privacy Policy and the DPA&rsquo;s Annex 3 too.
      </p>
      <NoticeForm owners={owners} earliest={earliestStart()} days={NOTICE_DAYS} />
      <h2 className="mt-8 text-lg font-semibold text-ink">Sent before</h2>
      {past.length === 0 ? (
        <p className="mt-2 text-sm text-muted">None yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface text-sm" data-testid="notice-history">
          {past.map((a) => {
            const d = (a.details ?? {}) as Details;
            return (
              <li key={a.id} className="p-4">
                <p className="font-medium text-ink">
                  {d.name} from {d.startsOn ? longDate(d.startsOn) : "?"}
                </p>
                <p className="text-muted">
                  {qldTime(a.createdAt)} by {a.actorEmail}: {d.sent ?? 0} of {d.recipients ?? 0} sent{d.status === "sending" ? " (still sending, or stopped)" : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
