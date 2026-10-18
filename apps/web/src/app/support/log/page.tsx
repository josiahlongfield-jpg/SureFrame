import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ADMIN_ACTION_KEEP_YEARS } from "@/lib/support/admin";
import { qldDay } from "@/lib/support/when";
import { ACTION_LABELS, consoleAdmin, Done, History } from "../_console/ui";

export const metadata: Metadata = { title: "Support log", robots: { index: false } };

const PAGE = 100;
const insensitive = (q: string) => ({ contains: q, mode: "insensitive" as const });
const field = "rounded-xl border border-line-strong px-3 py-2 text-sm";

/** Support admins: every support action, newest first, a page at a time, with search and a filter by kind. */
export default async function SupportLog({ searchParams }: { searchParams: Promise<{ done?: string; q?: string; action?: string; before?: string }> }) {
  await consoleAdmin("/support/log");
  const { done, q: raw = "", action = "", before } = await searchParams;
  const q = raw.trim().slice(0, 200);
  const kind = action in ACTION_LABELS ? action : "";
  const until = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : null;
  const where: Prisma.AdminActionWhereInput = {
    ...(q ? { OR: [{ target: insensitive(q) }, { reason: insensitive(q) }, { actorEmail: insensitive(q) }, { userId: q }, { workspaceId: q }] } : {}),
    ...(kind ? { action: kind } : {}),
    ...(until ? { createdAt: { lt: until } } : {}),
  };
  const rows = await db.adminAction.findMany({ where, orderBy: { createdAt: "desc" }, take: PAGE + 1 });
  const more = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const params = (extra: Record<string, string>) => new URLSearchParams({ ...(q ? { q } : {}), ...(kind ? { action: kind } : {}), ...extra }).toString();
  const filtered = !!(q || kind || until);
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Support log</h1>
      <p className="mt-2 text-sm text-muted">
        Each use of the support powers and the free-plan tools: who did what, to whom and when, with the reason given. Records are kept {ADMIN_ACTION_KEEP_YEARS}{" "}
        years, also after the account is deleted.
      </p>
      <Done id={done} />
      <form method="get" className="mt-6 flex flex-col gap-2 sm:flex-row" role="search" data-testid="log-search">
        <input name="q" type="search" defaultValue={raw} placeholder="Email, business, reason or id" aria-label="Search the support log" className={`${field} min-w-0 flex-1`} />
        <select name="action" defaultValue={kind} aria-label="Kind of action" className={field}>
          <option value="">Every kind</option>
          {Object.entries(ACTION_LABELS)
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
        </select>
        <button className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">Show</button>
      </form>
      {filtered && (
        <p className="mt-3 text-sm text-muted">
          {until ? `Older than ${qldDay(until)}. ` : ""}
          <Link href="/support/log" className="text-accent hover:underline">
            Show the latest of everything
          </Link>
        </p>
      )}
      <div className="mt-6">
        <History rows={shown} links empty={filtered ? "Nothing matches." : "No support actions yet."} />
      </div>
      {more && (
        <p className="mt-4">
          <Link href={`/support/log?${params({ before: shown.at(-1)!.createdAt.toISOString() })}`} className="text-sm font-medium text-accent hover:underline" data-testid="log-older">
            Older →
          </Link>
        </p>
      )}
    </div>
  );
}
