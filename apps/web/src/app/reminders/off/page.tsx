import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Logo from "@/components/Logo";
import { db } from "@/lib/db";
import { validUnsubscribe } from "@/lib/reminders";

export const metadata: Metadata = { title: "Email reminders" };

/**
 * Opened from the "Stop emails" link in a reminder or new-video email; no sign-in needed.
 * It asks for a click rather than acting on page load, because email
 * security scanners open links and would otherwise switch reminders off.
 */
export default async function RemindersOff({ searchParams }: { searchParams: Promise<{ c?: string; s?: string; on?: string }> }) {
  const { c, s } = await searchParams;
  const ok = !!c && !!s && validUnsubscribe(c, s);
  const client = ok ? await db.client.findUnique({ where: { id: c }, include: { workspace: { select: { name: true } } } }) : null;

  async function turnOn() {
    "use server";
    if (!c || !s || !validUnsubscribe(c, s)) return;
    await db.client.update({ where: { id: c }, data: { remindersOff: false } });
    revalidatePath("/reminders/off");
  }
  async function turnOff() {
    "use server";
    if (!c || !s || !validUnsubscribe(c, s)) return;
    await db.client.update({ where: { id: c }, data: { remindersOff: true } });
    revalidatePath("/reminders/off");
  }
  const fresh = client ? await db.client.findUnique({ where: { id: client.id } }) : null;

  return (
    <div data-theme="navy" className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-xl items-center px-4"><Logo href="/" /></div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        {!client ? (
          <p className="text-muted">This link isn&apos;t valid. Use the link from your most recent reminder email.</p>
        ) : fresh?.remindersOff ? (
          <>
            <h1 className="text-2xl font-semibold text-ink">Emails turned off</h1>
            <p className="mt-2 text-muted">You won&apos;t get to-do reminders or new-video emails from {client.workspace.name} any more. Your videos still open from your personal link.</p>
            <form action={turnOn} className="mt-6">
              <button className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-sm font-medium hover:bg-hover">Turn them back on</button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-ink">Stop emails from {client.workspace.name}?</h1>
            <p className="mt-2 text-muted">You&apos;ll stop getting to-do reminders and new-video emails from them. Your videos still open from your personal link, and you can turn emails back on any time.</p>
            <form action={turnOff} className="mt-6">
              <button className="rounded-xl bg-solid px-4 py-2 text-sm font-medium text-white hover:bg-solid-hover">Stop emails</button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
