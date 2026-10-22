import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Logo from "@/components/Logo";
import { isEmailBlocked } from "@/lib/blockedEmail";
import { db } from "@/lib/db";
import { emailChangeNoticeEmail, readEmailChange } from "@/lib/emailChange";
import { sendMail } from "@/lib/mail";
import { requirePageUser } from "@/lib/session";

export const metadata: Metadata = { title: "Confirm your new sign-in email", robots: { index: false } };

const here = (t: string) => `/account/email?t=${encodeURIComponent(t)}`;

/**
 * The link emailed to a new sign-in address (Settings > Account, lib/emailChange.ts). It asks before changing
 * anything, so an email scanner opening the link changes nothing. Signed in as the account that asked for it.
 */
export default async function ConfirmEmailChange({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  const me = await requirePageUser(here(t), { allowPaused: true });
  const change = readEmailChange(t);
  const valid = !!change && change.u === me.user.id && change.from.toLowerCase() === me.user.email.toLowerCase();

  async function confirm() {
    "use server";
    const now = await requirePageUser(here(t), { allowPaused: true });
    const c = readEmailChange(t);
    // Still this account, still on the old address (so a link works once), and the new one still free.
    if (!c || c.u !== now.user.id || c.from.toLowerCase() !== now.user.email.toLowerCase()) redirect("/settings/account?error=email-link#email");
    if (await isEmailBlocked(c.to)) redirect("/settings/account?error=email-blocked#email");
    if (await db.user.findUnique({ where: { email: c.to }, select: { id: true } })) redirect("/settings/account?error=email-taken#email");
    await db.user.update({ where: { id: now.user.id }, data: { email: c.to, emailVerified: new Date() } });
    await sendMail({ to: c.from, ...emailChangeNoticeEmail("done", c.from, c.to) }).catch(() => {});
    revalidatePath("/", "layout");
    redirect("/settings/account?saved=email#email");
  }

  return (
    <main data-theme="fresh" className="text-ink mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-16">
      <Logo href="/library" />
      {valid ? (
        <>
          <h1 className="mt-10 text-2xl font-semibold tracking-tight text-ink" data-testid="email-change-heading">
            Sign in with {change.to} from now on?
          </h1>
          <p className="mt-3 text-muted">
            Your account signs in with <span className="font-medium text-ink">{change.from}</span> today. After this, sign-in links and codes go to{" "}
            <span className="font-medium text-ink">{change.to}</span>. Your videos, clients and settings stay as they are.
          </p>
          <form action={confirm} className="mt-6 flex flex-wrap gap-3">
            <button className="rounded-xl bg-primary px-5 py-3 font-semibold text-on-primary hover:bg-primary-hover" data-testid="email-change-confirm">
              Change my sign-in email
            </button>
            <Link href="/settings/account" className="rounded-xl border border-line-strong px-5 py-3 font-medium text-ink hover:bg-hover">
              Keep {change.from}
            </Link>
          </form>
        </>
      ) : (
        <>
          <h1 className="mt-10 text-2xl font-semibold tracking-tight text-ink" data-testid="email-change-heading">
            This link doesn&apos;t work any more
          </h1>
          <p className="mt-3 text-muted">
            It has ended, was already used, or is for a different account than the one signed in here. To change your sign-in email, enter the new address again
            under Settings &gt; Account.
          </p>
          <Link href="/settings/account#email" className="mt-6 inline-block rounded-xl bg-primary px-5 py-3 font-semibold text-on-primary hover:bg-primary-hover">
            Open Settings &gt; Account
          </Link>
        </>
      )}
    </main>
  );
}
