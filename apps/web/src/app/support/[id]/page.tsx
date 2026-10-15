import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { requirePageUser } from "@/lib/session";
import { isSupportAdmin } from "@/lib/support/admin";
import { isSupportAgent } from "@/lib/support/tickets";
import { deleteTicket, reply, setStatus } from "../actions";

export const metadata: Metadata = { title: "Support conversation" };

const WHO = { CUSTOMER: "Customer", ASSISTANT: "Assistant", STAFF: "You" } as const;

export default async function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requirePageUser(`/support/${id}`, { allowPaused: true, allowSuspended: true, allowTermsPending: true });
  if (!isSupportAgent(user.email)) notFound();
  if (user.suspendedAt && !isSupportAdmin(user.email)) redirect("/suspended");
  const ticket = await db.supportTicket.findUnique({ where: { id }, include: { user: true, messages: { orderBy: { createdAt: "asc" } } } });
  if (!ticket) notFound();
  const workspace = ticket.workspaceId ? await db.workspace.findUnique({ where: { id: ticket.workspaceId } }) : null;
  const email = ticket.user?.email ?? ticket.email;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link href="/support" className="text-sm text-accent hover:underline">← Support inbox</Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">{email ?? "Website visitor"}</h1>
      <p className="mt-1 text-sm text-muted">
        {workspace ? `${workspace.name} · ${PLANS[workspace.plan].name} plan${workspace.subscriptionStatus ? ` (${workspace.subscriptionStatus})` : ""}` : "Not signed in"}
        {email ? "" : " · no email given, so your reply only shows in their chat"}
      </p>
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
              {WHO[m.author]} · {m.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
            </p>
            <p className="mt-1 whitespace-pre-wrap text-ink">{m.body}</p>
          </li>
        ))}
      </ol>
      <form action={reply.bind(null, ticket.id)} className="mt-6 grid gap-3">
        <textarea name="body" required rows={6} aria-label="Your reply" placeholder="Write your reply…" className="rounded-xl border border-line-strong p-3 text-sm" />
        <div className="flex flex-wrap items-center gap-3">
          <button className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover">{email ? "Send reply by email" : "Send reply"}</button>
          {ticket.status !== "CLOSED" ? (
            <button formAction={setStatus.bind(null, ticket.id, "CLOSED")} formNoValidate className="rounded-xl border border-line-strong px-4 py-2.5 text-sm font-medium text-muted hover:bg-hover">Close</button>
          ) : (
            <span className="text-sm text-dim">Closed. A new message from them reopens it with the assistant.</span>
          )}
        </div>
      </form>
      <form action={deleteTicket.bind(null, ticket.id)} className="mt-10 border-t border-line pt-6">
        <button className="text-sm font-medium text-danger-fg hover:underline">Delete this conversation</button>
        <p className="mt-1 text-xs text-dim">Removes it for good, for you and the customer. Use it for test chats and spam.</p>
      </form>
    </main>
  );
}
