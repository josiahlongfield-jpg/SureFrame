import type { Metadata } from "next";
import { db } from "@/lib/db";
import { ADMIN_ACTION_KEEP_YEARS } from "@/lib/support/admin";
import { ConsoleNav, consoleAdmin, Done, History } from "../_console/ui";

export const metadata: Metadata = { title: "Support log", robots: { index: false } };

/** Support admins: the latest 200 support actions, newest first. */
export default async function SupportLog({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  await consoleAdmin("/support/log");
  const { done } = await searchParams;
  const rows = await db.adminAction.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <ConsoleNav />
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Support log</h1>
      <p className="mt-2 text-sm text-muted">
        Each use of the support powers and the free-plan tools: who did what, to whom and when, with the reason given. The latest 200 are shown. Records are kept{" "}
        {ADMIN_ACTION_KEEP_YEARS} years, also after the account is deleted.
      </p>
      <Done id={done} />
      <div className="mt-6">
        <History rows={rows} links empty="No support actions yet." />
      </div>
    </main>
  );
}
