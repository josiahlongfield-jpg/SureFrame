import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/session";
import { isSupportAdmin } from "@/lib/support/admin";
import { isSupportAgent } from "@/lib/support/tickets";
import { deleteAllTickets } from "../actions";
import { supportTitle } from "../_console/meta";

export const generateMetadata = supportTitle("Delete every conversation");

/** Deleting the whole inbox, on a page of its own so it's never one slip away from the conversations list. */
export default async function ClearInbox({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { user } = await requirePageUser("/support/clear", { allowPaused: true, allowSuspended: true, allowTermsPending: true });
  if (!isSupportAgent(user.email)) notFound();
  if (user.suspendedAt && !isSupportAdmin(user.email)) redirect("/suspended");
  const { error } = await searchParams;
  const total = await db.supportTicket.count();
  return (
    <div>
      <Link href="/support" className="text-sm text-accent hover:underline">
        ← Support inbox
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Delete every conversation</h1>
      <p className="mt-2 text-sm text-muted">
        For clearing out test chats before going live. It deletes all {total} conversation{total === 1 ? "" : "s"} for good, open and closed, including what
        customers see in their chat. To tidy the inbox instead, close conversations: they stay findable under Closed.
      </p>
      <form action={deleteAllTickets} noValidate className="mt-6 grid gap-2 rounded-2xl border border-danger-line bg-surface p-4 sm:max-w-md">
        <label className="grid gap-1 text-sm text-muted">
          Type DELETE to confirm
          <input name="confirm" autoComplete="off" className="rounded-lg border border-line-strong px-3 py-2 text-sm" />
        </label>
        {error === "confirm" && (
          <p role="alert" className="text-sm text-danger-fg">
            Type DELETE in capitals to confirm.
          </p>
        )}
        <button className="justify-self-start rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Delete everything</button>
      </form>
    </div>
  );
}
