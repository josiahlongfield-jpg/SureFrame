import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Logo from "@/components/Logo";
import RequiredField from "@/components/RequiredField";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { safeNext } from "@/lib/secrets";
import { needsWelcome, requirePageUser, welcomePath } from "@/lib/session";
import { appUrl } from "@/lib/stripe";
import { formerTeams, isPlaceholderName } from "@/lib/team";
import { welcomeEmail } from "@/lib/welcomeEmail";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Welcome", robots: { index: false } };

/** Back to where they were going, never to this page again. */
const destination = (next: string | null | undefined) => {
  const to = safeNext(next);
  return to === "/welcome" || to.startsWith("/welcome?") ? "/library" : to;
};

const clean = (v: FormDataEntryValue | null) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

/**
 * The one step after signing up (owners only): their own name and the
 * business name clients see on videos and emails, together, so a new owner
 * isn't met by several prompts. Finishing it sends the welcome email, once.
 */
export default async function Welcome({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const to = destination(next);
  const me = await requirePageUser(welcomePath(to), { allowWelcome: true });
  if (!needsWelcome(me)) redirect(to);
  const former = await formerTeams(me.user.id);

  async function save(form: FormData) {
    "use server";
    const back = destination(String(form.get("next") ?? ""));
    const me = await requirePageUser(welcomePath(back), { allowWelcome: true });
    if (!needsWelcome(me)) redirect(back);
    const name = clean(form.get("name"));
    const business = clean(form.get("business"));
    if (!business || isPlaceholderName(business)) redirect(`${welcomePath(back)}&error=business`);
    await db.$transaction([
      ...(name ? [db.user.update({ where: { id: me.user.id }, data: { name } })] : []),
      db.workspace.update({ where: { id: me.workspace.id }, data: { name: business } }),
    ]);
    // Only the first time through sends the welcome email, however many tabs press Continue.
    const first = await db.user.updateMany({ where: { id: me.user.id, onboardedAt: null }, data: { onboardedAt: new Date() } });
    if (first.count) {
      await sendMail({ to: me.user.email, ...welcomeEmail({ name: name || me.user.name, business, link: appUrl("/library") }) }).catch((err) =>
        console.error("[welcome] email not sent", String(err)),
      );
    }
    revalidatePath("/", "layout");
    // A brand-new owner heading for the recorder lands on their first steps instead (key, clients, then record),
    // rather than on the recorder with the key and the clients note stacked above it.
    redirect(new URL(back, "http://x").pathname === "/record" ? "/library" : back);
  }

  const field = "w-full rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-ink";
  return (
    <main data-theme="fresh" className="text-ink mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-16">
      <Logo href="/welcome" />
      {former.length > 0 && (
        <div role="status" className="mt-8 rounded-2xl border border-warn-line bg-warn-bg p-5 text-sm text-warn-fg" data-testid="removed-from-team">
          <p className="font-semibold">You&apos;re no longer on {former.map((t) => t.name).join(" or ")}&apos;s team</p>
          <p className="mt-1">
            An owner or admin removed you, so you can&apos;t open that team&apos;s videos or clients any more. If that&apos;s a mistake, ask them for a new invite link.
          </p>
          <p className="mt-2">
            You can still use {BRAND.name} for your own business below, free. Not what you want?{" "}
            <Link href="/settings/account" className="font-medium underline">Delete this account</Link>.
          </p>
        </div>
      )}
      <h1 className="mt-10 text-2xl font-semibold tracking-tight text-ink" data-testid="welcome-heading">
        {former.length ? "Start your own account" : `Welcome to ${BRAND.name}`}
      </h1>
      <p className="mt-3 text-muted">One quick step. Your clients see these on the videos and emails you send them.</p>
      <form action={save} className="mt-6 grid gap-5">
        <input type="hidden" name="next" value={to} />
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-muted">Your business name</span>
          <RequiredField name="business" message="Enter your business name." maxLength={80} autoComplete="organization" placeholder="e.g. Business A" autoFocus
            defaultValue={isPlaceholderName(me.workspace.name) ? "" : me.workspace.name} className={field} data-testid="welcome-business" />
          <span className="text-xs text-dim">Work under your own name? Use that. You can change it later in Settings &gt; Branding.</span>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-muted">Your name <span className="font-normal text-dim">(optional)</span></span>
          <input name="name" maxLength={80} autoComplete="name" placeholder="The name your clients know you by" defaultValue={me.user.name ?? ""} className={field} data-testid="welcome-name" />
          <span className="text-xs text-dim">Clients see who sent each video, like &ldquo;Your name from Business A&rdquo;.</span>
        </label>
        {error === "business" && <p role="alert" className="text-sm text-danger-fg">Enter your business name.</p>}
        <button className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-hover sm:w-auto sm:px-8" data-testid="welcome-submit">
          Continue
        </button>
      </form>
    </main>
  );
}
