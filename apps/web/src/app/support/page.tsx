import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/session";
import { isSupportAdmin } from "@/lib/support/admin";
import { TALK_TO_PERSON } from "@/lib/support/person";
import { isSupportAgent } from "@/lib/support/tickets";
import { qldTime } from "@/lib/support/when";

export const metadata: Metadata = { title: "Support inbox" };

const LABEL = { NEEDS_HUMAN: "Needs you", ANSWERED: "Answered", OPEN: "Assistant handling", CLOSED: "Closed" } as const;

/** The inbox's three lists: what needs a person (the default), everything still open, and closed ones. */
const VIEWS = {
  needs: { label: "Needs you", where: { status: { in: ["NEEDS_HUMAN", "ANSWERED"] } }, empty: "Nothing needs you right now. The assistant is handling everything else." },
  open: { label: "All open", where: { status: { not: "CLOSED" } }, empty: "No open conversations." },
  closed: { label: "Closed", where: { status: "CLOSED" }, empty: "No closed conversations." },
} satisfies Record<string, { label: string; where: Prisma.SupportTicketWhereInput; empty: string }>;
type View = keyof typeof VIEWS;

const insensitive = (q: string) => ({ contains: q, mode: "insensitive" as const });

/** The founder's support inbox: conversations handed to a person come first; closed ones can be found and reopened. */
export default async function SupportInbox({ searchParams }: { searchParams: Promise<{ show?: string; q?: string; cleared?: string }> }) {
  const { user } = await requirePageUser("/support", { allowPaused: true, allowSuspended: true, allowTermsPending: true });
  if (!isSupportAgent(user.email)) notFound();
  // A suspended agent is cut off; only a support admin keeps working while their own login is suspended.
  if (user.suspendedAt && !isSupportAdmin(user.email)) redirect("/suspended");
  const { show, q: raw = "", cleared } = await searchParams;
  // "all" was the old name for every conversation.
  const view: View = show === "closed" ? "closed" : show === "open" || show === "all" ? "open" : "needs";
  const q = raw.trim().slice(0, 200);
  const search: Prisma.SupportTicketWhereInput = q
    ? { OR: [{ email: insensitive(q) }, { user: { email: insensitive(q) } }, { summary: insensitive(q) }, { messages: { some: { body: insensitive(q) } } }] }
    : {};
  const [tickets, counts] = await Promise.all([
    db.supportTicket.findMany({
      where: { AND: [VIEWS[view].where, search] },
      orderBy: [{ urgent: "desc" }, { updatedAt: "desc" }],
      take: 200,
      include: {
        user: { select: { email: true } },
        // The customer's own words, not the assistant's answer.
        messages: { where: { author: "CUSTOMER" }, orderBy: { createdAt: "desc" }, take: 3 },
      },
    }),
    db.supportTicket.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const order = { NEEDS_HUMAN: 0, ANSWERED: 1, OPEN: 2, CLOSED: 3 };
  tickets.sort((a, b) => order[a.status] - order[b.status]);
  const count = (statuses: string[]) => counts.filter((c) => statuses.includes(c.status)).reduce((n, c) => n + c._count._all, 0);
  const tabCount = { needs: count(["NEEDS_HUMAN", "ANSWERED"]), open: count(["NEEDS_HUMAN", "ANSWERED", "OPEN"]), closed: count(["CLOSED"]) };
  const href = (v: View) => (v === "needs" ? "/support" : `/support?show=${v}`);
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Support inbox</h1>
      {cleared && <p className="mt-6 rounded-xl bg-ok-bg p-3 text-sm text-ok-fg">Every conversation was deleted.</p>}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap gap-2" aria-label="Which conversations">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <Link
              key={v}
              href={href(v)}
              aria-current={v === view ? "page" : undefined}
              data-testid={`inbox-${v}`}
              className={`rounded-full border px-3 py-1 text-sm ${v === view ? "border-transparent bg-solid font-medium text-on-solid" : "border-line-strong text-muted hover:bg-hover"}`}
            >
              {VIEWS[v].label} ({tabCount[v]})
            </Link>
          ))}
        </nav>
        <form method="get" className="flex gap-2" role="search">
          {view !== "needs" && <input type="hidden" name="show" value={view} />}
          <input
            name="q"
            type="search"
            defaultValue={raw}
            placeholder="Search email or words"
            aria-label="Search conversations"
            className="min-w-0 flex-1 rounded-xl border border-line-strong px-3 py-1.5 text-sm sm:w-56"
          />
          <button className="rounded-xl border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover">Search</button>
        </form>
      </div>
      {q && (
        <p className="mt-3 text-sm text-muted" data-testid="inbox-search-note">
          {tickets.length} {VIEWS[view].label.toLowerCase()} conversation{tickets.length === 1 ? "" : "s"} matching &ldquo;{q}&rdquo;.{" "}
          <Link href={href(view)} className="text-accent hover:underline">
            Clear search
          </Link>
        </p>
      )}
      {tickets.length === 0 && !q && <p className="mt-8 text-muted">{VIEWS[view].empty}</p>}
      {tickets.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-surface" data-testid="inbox-list">
          {tickets.map((t) => {
            // What they asked: their latest message, passing over the "Talk to a person" line.
            const asked = t.messages.find((m) => m.body !== TALK_TO_PERSON) ?? t.messages[0];
            return (
              <li key={t.id}>
                <Link href={`/support/${t.id}`} className="block p-4 hover:bg-hover">
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate font-medium text-ink">{t.user?.email ?? t.email ?? "Website visitor"}</p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${t.status === "NEEDS_HUMAN" ? (t.urgent ? "bg-danger-bg text-danger-fg" : "bg-warn-bg text-warn-fg") : "bg-surface-2 text-muted"}`}
                    >
                      {t.urgent && t.status === "NEEDS_HUMAN" ? "Urgent" : LABEL[t.status]}
                    </span>
                  </div>
                  {asked && (
                    <p className="mt-1 line-clamp-2 break-words text-sm text-ink" data-testid="inbox-question">
                      &ldquo;{asked.body}&rdquo;
                    </p>
                  )}
                  {t.summary && <p className="mt-1 line-clamp-1 break-words text-xs text-muted">Summary: {t.summary}</p>}
                  <p className="mt-1 text-xs text-dim">{qldTime(t.updatedAt)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-10 text-xs text-dim">
        Test chats and spam can be deleted one at a time from each conversation, or{" "}
        <Link href="/support/clear" className="underline hover:text-ink" data-testid="clear-link">
          all at once
        </Link>
        .
      </p>
    </div>
  );
}
