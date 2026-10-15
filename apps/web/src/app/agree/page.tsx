import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import Logo from "@/components/Logo";
import RecoverUploads from "@/components/RecoverUploads";
import { db } from "@/lib/db";
import { LEGAL, LEGAL_VERSIONS } from "@/lib/legal";
import { safeNext } from "@/lib/secrets";
import { agreePath } from "@/lib/session";
import { agreementKind, hasAgreed, recordAgreement } from "@/lib/terms";
import AgreeForm from "./AgreeForm";

export const metadata: Metadata = { title: "Terms and privacy", robots: { index: false } };

/** Back to where they were going, never to this page again. */
const destination = (next: string | null | undefined) => {
  const to = safeNext(next);
  return to === "/agree" || to.startsWith("/agree?") ? "/library" : to;
};

/**
 * The signed-in login, or off to sign in. Not currentUser(): someone agreeing
 * on their way to join a team shouldn't get a personal workspace made for them.
 * A closed account waiting to be deleted counts as signed out, as everywhere.
 */
async function signedIn(to: string) {
  const id = (await auth())?.user?.id;
  const user = id ? await db.user.findUnique({ where: { id }, select: { id: true, email: true, createdAt: true, deleteAt: true, suspendedAt: true } }) : null;
  if (!user || user.deleteAt) redirect(`/login?next=${encodeURIComponent(agreePath(to))}`);
  // Support's suspension comes first: agreeing wouldn't let them in.
  if (user.suspendedAt) redirect("/suspended");
  return user;
}

/**
 * Where a signed-in account holder agrees to the current Terms of Service and
 * Privacy Policy (lib/terms.ts) before using SureFrame: new accounts first,
 * and everyone again when either changes. Ticking the box and pressing Agree
 * records the agreement; then they carry on to where they were going.
 */
export default async function Agree({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const to = destination(next);
  const user = await signedIn(to);
  if (await hasAgreed(user.id)) redirect(to);
  const updated = (await agreementKind(user)) === "update";
  const changes = LEGAL_VERSIONS[0]?.changes ?? [];

  async function agree(form: FormData) {
    "use server";
    const back = destination(String(form.get("next") ?? ""));
    const now = await signedIn(back);
    // The box must be ticked, whatever the browser sent.
    if (form.get("agree") !== "on") redirect(`${agreePath(back)}&error=tick`);
    await recordAgreement(now);
    redirect(back);
  }

  const docLink = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noopener" className="font-medium text-accent underline">
      {label}
    </a>
  );

  return (
    <main data-theme="navy" className="text-ink mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-16">
      <Logo href="/agree" tone="dark" />
      {updated ? (
        <>
          <h1 className="mt-10 text-2xl font-semibold tracking-tight text-ink" data-testid="agree-heading">
            We&rsquo;ve updated our Terms of Service and Privacy Policy
          </h1>
          <p className="mt-3 text-muted">Please read them and agree to keep using {LEGAL.product}. The main changes:</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted" data-testid="agree-changes">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <h1 className="mt-10 text-2xl font-semibold tracking-tight text-ink" data-testid="agree-heading">
            Before you continue
          </h1>
          <p className="mt-3 text-muted">
            Please read and agree to our Terms of Service and Privacy Policy. They explain how {LEGAL.product} works, what you and we each agree to, and how we
            handle your information.
          </p>
        </>
      )}
      <p className="mt-4 text-muted">
        Read the {docLink("/legal/terms", "Terms of Service")} and the {docLink("/legal/privacy", "Privacy Policy")} (they open in a new tab).
      </p>
      {error === "tick" && (
        <p role="alert" className="mt-4 text-sm text-danger-fg">
          Tick the box to agree.
        </p>
      )}
      <AgreeForm action={agree} next={to} />
      <p className="mt-3 text-xs text-dim">
        We keep a record of when you agree and to which versions (Terms {LEGAL.termsVersion}, Privacy Policy {LEGAL.privacyVersion}).
      </p>
      <div className="mt-8 grid gap-3 border-t border-line pt-6 text-sm text-muted">
        <p>
          Don&rsquo;t agree? You can{" "}
          <Link href="/settings/account" className="font-medium text-accent hover:underline" data-testid="agree-account">
            download your data, manage or cancel your subscription, or delete your account
          </Link>
          .
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button className="font-medium text-accent hover:underline">Sign out</button>
        </form>
      </div>
      {/* A recording interrupted before the terms changed finishes uploading here too. */}
      <RecoverUploads always />
    </main>
  );
}
