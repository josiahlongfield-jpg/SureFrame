import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { requirePageUser } from "@/lib/session";
import { isSupportAdmin } from "@/lib/support/admin";
import { isSupportAgent } from "@/lib/support/tickets";
import { qldTime } from "@/lib/support/when";
import ConfirmAction from "../_console/ConfirmAction";
import { deleteTicket, reply, setStatus } from "../actions";
import { supportTitle } from "../_console/meta";

export const generateMetadata = supportTitle("Support conversation");

const WHO = { CUSTOMER: "Customer", ASSISTANT: "Assistant", STAFF: "You" } as const;
const quiet = "rounded-xl border border-line-strong px-4 py-2.5 text-sm font-medium text-muted hover:bg-hover";

/**
 * An old conversation's address (an inbox email's link, say) once it's been deleted, or a mistyped one: said in the
 * support pages, with the way back to the inbox, rather than the app's "page not found" (P12). The support log says
 * who deleted it and when.
 */
async function Gone({ id }: { id: string }) {
  const deleted = await db.adminAction.findFirst({
    where: { OR: [{ action: "support.delete", details: { path: ["ticketId"], equals: id } }, { action: "support.delete_all", details: { path: ["ticketIds"], array_contains: [id] } }] },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div data-testid="ticket-gone">
      <Link href="/support" className="text-sm text-accent hover:underline">
        ← Support inbox
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">{deleted ? "This conversation was deleted" : "This conversation isn’t here"}</h1>
      <p className="mt-2 text-sm text-muted">
        {deleted
          ? `${deleted.action === "support.delete_all" ? "Every conversation was deleted" : "It was deleted"} on ${qldTime(deleted.createdAt)} by ${deleted.actorEmail}, for good: it's gone for the customer too.`
          : "It may have been deleted, or the address may be mistyped."}
      </p>
    </div>
  );
}

export default async function SupportTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sent?: string; error?: string; done?: string }>;
}) {
  const { id } = await params;
  const { sent, error, done } = await searchParams;
  const { user } = await requirePageUser(`/support/${id}`, { allowPaused: true, allowSuspended: true, allowTermsPending: true });
  if (!isSupportAgent(user.email)) notFound();
  if (user.suspendedAt && !isSupportAdmin(user.email)) redirect("/suspended");
  // The inbox is /support itself; /support/inbox is a natural guess at its address (P57).
  if (id === "inbox") redirect("/support");
  const ticket = await db.supportTicket.findUnique({ where: { id }, include: { user: true, messages: { orderBy: { createdAt: "asc" } } } });
  if (!ticket) return <Gone id={id} />;
  const workspace = ticket.workspaceId ? await db.workspace.findUnique({ where: { id: ticket.workspaceId } }) : null;
  const email = ticket.user?.email ?? ticket.email;
  const closed = ticket.status === "CLOSED";
  const admin = isSupportAdmin(user.email);
  return (
    <div>
      <Link href={closed ? "/support?show=closed" : "/support"} className="text-sm text-accent hover:underline">
        ← {closed ? "Closed conversations" : "Support inbox"}
      </Link>
      <h1 className="mt-3 break-all text-2xl font-semibold tracking-tight text-ink">{email ?? "Website visitor"}</h1>
      <p className="mt-1 text-sm text-muted">
        {workspace ? `${workspace.name} · ${PLANS[workspace.plan].name} plan${workspace.subscriptionStatus ? ` (${workspace.subscriptionStatus})` : ""}` : "Not signed in"}
        {email ? "" : " · no email given, so your reply only shows in their chat"}
        {closed && " · Closed"}
      </p>
      {/* Straight to their account in the support console. */}
      {admin && (ticket.userId || email) && (
        <p className="mt-1 text-sm">
          <Link href={ticket.userId ? `/support/users/${ticket.userId}` : `/support/lookup?q=${encodeURIComponent(email!)}`} className="text-accent hover:underline" data-testid="ticket-lookup">
            Look up this account
          </Link>
        </p>
      )}
      {sent && (
        <p role="status" className="mt-6 rounded-xl bg-ok-bg p-3 text-sm text-ok-fg" data-testid="reply-sent">
          {sent === "email" && email ? `Reply sent by email to ${email}. It shows in their chat too.` : "Reply sent. It shows in their chat (there's no email address to send it to)."}
        </p>
      )}
      {done && (
        <p role="status" className="mt-6 rounded-xl bg-ok-bg p-3 text-sm text-ok-fg" data-testid="ticket-done">
          {done === "closed" ? "Closed. It's under Closed in the inbox, where you can find it and reopen it." : "Reopened. It's back under Needs you."}
        </p>
      )}
      {ticket.summary && (
        <div className={`mt-6 rounded-2xl p-4 text-sm ${ticket.urgent ? "bg-danger-bg text-danger-fg" : "bg-warn-bg text-warn-fg"}`}>
          <p className="font-semibold">{ticket.urgent ? "Urgent. " : ""}Assistant&rsquo;s summary</p>
          <p className="mt-1 whitespace-pre-wrap">{ticket.summary}</p>
        </div>
      )}
      <ol className="mt-6 space-y-3">
        {ticket.messages.map((m) => (
          <li key={m.id} className={`rounded-2xl border p-4 text-sm ${m.author === "CUSTOMER" ? "border-line bg-surface" : m.author === "STAFF" ? "border-ok-line bg-ok-bg" : "border-line bg-canvas"}`}>
            <p className="text-xs font-semibold text-dim">
              {WHO[m.author]} · {qldTime(m.createdAt)}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-ink">{m.body}</p>
          </li>
        ))}
      </ol>
      <form action={reply.bind(null, ticket.id)} noValidate className="mt-6 grid gap-3">
        <textarea name="body" rows={6} aria-label="Your reply" placeholder="Write your reply…" className="rounded-xl border border-line-strong p-3 text-sm" />
        {error === "empty" && (
          <p role="alert" className="text-sm text-danger-fg">
            Write your reply first.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover">{email ? "Send reply by email" : "Send reply"}</button>
          {closed && <span className="text-sm text-dim">Replying reopens it.</span>}
        </div>
      </form>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!closed ? (
          <ConfirmAction action={setStatus.bind(null, ticket.id, "CLOSED")} label="Close" title="Close this conversation?" confirm="Close it" className={quiet} testId="close-ticket">
            It moves to Closed in the inbox, where you can search for it and reopen it. The customer isn&rsquo;t told. If they write again, the assistant answers and
            it opens again by itself.
          </ConfirmAction>
        ) : (
          <form action={setStatus.bind(null, ticket.id, "OPEN")}>
            <button className={quiet} data-testid="reopen-ticket">
              Reopen
            </button>
          </form>
        )}
      </div>
      <div className="mt-10 border-t border-line pt-6">
        <ConfirmAction
          action={deleteTicket.bind(null, ticket.id)}
          label="Delete this conversation"
          title="Delete this conversation for good?"
          confirm="Delete it"
          danger
          className="text-sm font-medium text-danger-fg hover:underline"
          testId="delete-ticket"
        >
          It&rsquo;s removed for you and for the customer, and can&rsquo;t be brought back. Use it for test chats and spam; to keep it but tidy the inbox, close it
          instead.
        </ConfirmAction>
        <p className="mt-1 text-xs text-dim" data-testid="delete-ticket-note">
          Removes it for good, for you and the customer. Use it for test chats and spam. The customer isn&rsquo;t emailed: their chat (and any link to it) just
          says the conversation ended and was removed.
        </p>
      </div>
    </div>
  );
}
