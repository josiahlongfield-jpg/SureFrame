import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ClientHeader from "@/components/ClientHeader";
import MadeWith from "@/components/MadeWith";
import { brandOf, brandStyle } from "@/lib/branding";
import { db } from "@/lib/db";
import { validUnsubscribe } from "@/lib/reminders";
import { clientHelpLimitText } from "@/lib/support/clientHelp";

export const metadata: Metadata = { title: "Email reminders" };

/**
 * Opened from the "Stop emails" link in a reminder or new-video email, or after turning emails back on from
 * the inbox; no sign-in needed. Switching off asks for a click rather than acting on page load, because email
 * security scanners open links and would otherwise switch reminders off. Each switch lands back here with
 * `done` set, so the page says plainly what just happened.
 */
export default async function RemindersOff({ searchParams }: { searchParams: Promise<{ c?: string; s?: string; done?: string }> }) {
  const { c, s, done } = await searchParams;
  const ok = !!c && !!s && validUnsubscribe(c, s);
  const client = ok
    ? await db.client.findUnique({
        where: { id: c },
        include: { workspace: { select: { id: true, name: true, plan: true, brandColor: true, brandLogoType: true, brandVersion: true } } },
      })
    : null;
  const back = `/reminders/off?c=${encodeURIComponent(c ?? "")}&s=${encodeURIComponent(s ?? "")}`;

  async function turnOn() {
    "use server";
    if (!c || !s || !validUnsubscribe(c, s)) return;
    await db.client.update({ where: { id: c }, data: { remindersOff: false } });
    redirect(`${back}&done=on`);
  }
  async function turnOff() {
    "use server";
    if (!c || !s || !validUnsubscribe(c, s)) return;
    await db.client.update({ where: { id: c }, data: { remindersOff: true } });
    redirect(`${back}&done=off`);
  }

  // The business's own look; the logo leads to the client's videos, not to SureFrame's own site.
  const brand = client ? brandOf(client.workspace) : null;
  const name = client?.workspace.name;
  return (
    <div data-theme="fresh" className="flex min-h-screen flex-col bg-canvas text-ink" style={brandStyle(brand?.color ?? null)}>
      <ClientHeader brand={brand} allVideosLink help={client && s ? { for: [{ clientId: client.id, business: client.workspace.name, s, limits: clientHelpLimitText(client.workspace.plan) }], page: "emails" } : undefined} />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-16 text-center">
        {!client ? (
          <p className="text-muted">This link isn&apos;t valid. Use the link from your most recent reminder email.</p>
        ) : client.remindersOff ? (
          <>
            <h1 className="text-2xl font-semibold text-ink [text-wrap:balance]">{done === "off" ? "Emails turned off" : `Emails from ${name} are off`}</h1>
            <p className="mt-2 text-muted" role={done === "off" ? "status" : undefined}>
              You won&apos;t get to-do reminders or new-video emails from {name}. Your videos still open from your personal link.
            </p>
            <form action={turnOn} className="mt-6">
              <button className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-sm font-medium hover:bg-hover">Turn them back on</button>
            </form>
          </>
        ) : done === "on" ? (
          <>
            <h1 className="text-2xl font-semibold text-ink [text-wrap:balance]" data-testid="emails-on">Emails turned back on</h1>
            <p className="mt-2 text-muted" role="status">
              You&apos;ll get to-do reminders and new-video emails from {name} again. Each one has a link to turn them off.
            </p>
            <a href="/inbox" className="mt-6 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">Back to my videos</a>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-ink [text-wrap:balance]">Stop emails from {name}?</h1>
            <p className="mt-2 text-muted">You&apos;ll stop getting to-do reminders and new-video emails from them. Your videos still open from your personal link, and you can turn emails back on any time.</p>
            <form action={turnOff} className="mt-6">
              <button className="rounded-xl bg-solid px-4 py-2 text-sm font-medium text-white hover:bg-solid-hover">Stop emails</button>
            </form>
          </>
        )}
      </main>
      <MadeWith />
    </div>
  );
}
