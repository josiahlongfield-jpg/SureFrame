import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import Logo from "@/components/Logo";
import { AuthError } from "next-auth";
import { auth, authProviders, previewPassword, signIn } from "@/auth";
import { safeNext } from "@/lib/secrets";
import { db } from "@/lib/db";
import { plainEmail } from "@/lib/emailAddress";
import { DELETION_GRACE_DAYS } from "@/lib/accountDeletion";
import { pendingDeletion } from "@/lib/session";
import { EMAIL_BLOCKED, isEmailBlocked } from "@/lib/blockedEmail";

export const metadata: Metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; deleted?: string; closed?: string }> }) {
  const { next, error, deleted, closed } = await searchParams;
  const redirectTo = safeNext(next);
  // Checked against the database: a sign-in left over from a deleted account must not bounce back and forth.
  const userId = (await auth())?.user?.id;
  const signedInAs = userId ? await db.user.findUnique({ where: { id: userId }, select: { deleteAt: true } }) : null;
  if (signedInAs && !signedInAs.deleteAt) redirect(redirectTo);
  // A closed account: a sign-in made since closing it is offered to keep it; an older one signs in again here.
  if (signedInAs?.deleteAt && (await pendingDeletion())?.fresh) redirect("/account/restore");
  // Set by src/middleware.ts when a sign-in ends because the browser was closed or left idle.
  const signedOut = !error && (await cookies()).get("sf_signed_out")?.value === "1";
  const hasGoogle = authProviders.some((p) => p.id === "google");
  const hasEmail = authProviders.some((p) => p.id === "email");
  const hasDev = authProviders.some((p) => p.id === "dev");

  return (
    <main data-theme="navy" className="flex min-h-screen items-center justify-center navy-glow text-ink px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <Logo tone="dark" />
        <h1 className="mt-6 text-xl font-semibold text-ink">Sign in to start recording</h1>
        {deleted && (
          <p role="status" className="mt-3 rounded-lg bg-ok-bg px-3 py-2 text-sm text-ok-fg" data-testid="deleted-note">
            Your account is closed and will be deleted in {DELETION_GRACE_DAYS} days. We&apos;ve emailed you the date. Changed your mind? Sign in before then to keep it.
          </p>
        )}
        {closed && !deleted && (
          <p role="status" className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted" data-testid="closed-note">
            Your account stays closed and will be deleted on the date in our email. Changed your mind? Sign in before then to keep it.
          </p>
        )}
        {signedOut && (
          <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted" data-testid="signed-out-note">
            For your security you were signed out because the browser was closed or the page was left unused. Please sign in again.
          </p>
        )}
        <div className="mt-6 grid gap-3">
          {authProviders.some((p) => p.id === "google") && (
            <form action={async () => { "use server"; await signIn("google", { redirectTo }); }}>
              <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-line-strong px-4 py-3 font-medium hover:bg-hover">
                <GoogleMark /> Continue with Google
              </button>
            </form>
          )}
          {hasGoogle && (hasEmail || hasDev) && (
            <div className="flex items-center gap-3 text-xs text-dim">
              <span className="h-px flex-1 bg-line-strong" />or<span className="h-px flex-1 bg-line-strong" />
            </div>
          )}
          {hasEmail && (
            <form
              className="grid gap-3"
              action={async (fd: FormData) => {
                "use server";
                const email = plainEmail(String(fd.get("email") ?? ""));
                const back = (code: string) => redirect(`/login?error=${code}&next=${encodeURIComponent(redirectTo)}`);
                if (!email) back("email");
                // Refused again in src/auth.ts for any way in; checked here so the page says why.
                if (await isEmailBlocked(email)) back("blocked");
                // Sending is counted inside the provider (src/auth.ts), so direct API calls are limited too;
                // this only tells the two kinds of failure apart.
                const { signInEmailLimited } = await import("@/lib/signInGuard");
                if (await signInEmailLimited(email!)) back("rate");
                let failed = false;
                try {
                  // With redirect off, Auth.js reports a failed send as an error URL instead of throwing.
                  const url = await signIn("email", { email, redirectTo, redirect: false });
                  failed = typeof url === "string" && /[?&]error=/.test(url);
                } catch {
                  failed = true;
                }
                if (failed) {
                  console.error("[signin] sign-in email not sent", JSON.stringify({ domain: email!.split("@")[1] }));
                  back("send");
                }
                redirect("/login/check");
              }}
            >
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-muted">Email</span>
                <input name="email" type="email" required autoComplete="email" placeholder="you@company.com" className="rounded-lg border border-line-strong px-3 py-2" />
              </label>
              <button className="rounded-xl bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover">Email me a sign-in link</button>
              <p className="text-xs text-dim">No password needed. We&apos;ll email you a link that signs you in.</p>
            </form>
          )}
          {hasDev && (
            <form
              className="grid gap-3"
              action={async (fd: FormData) => {
                "use server";
                if (await isEmailBlocked(String(fd.get("email") ?? ""))) redirect(`/login?error=blocked&next=${encodeURIComponent(redirectTo)}`);
                try {
                  await signIn("dev", { email: fd.get("email"), password: fd.get("password") ?? "", redirectTo });
                } catch (e) {
                  if (e instanceof AuthError) redirect(`/login?error=password&next=${encodeURIComponent(redirectTo)}`);
                  throw e;
                }
              }}
            >
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-muted">Work email</span>
                <input name="email" type="email" required placeholder="you@company.com" className="rounded-lg border border-line-strong px-3 py-2" />
              </label>
              {previewPassword && (
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-muted">Preview password</span>
                  <input name="password" type="password" required className="rounded-lg border border-line-strong px-3 py-2" />
                </label>
              )}
              <button className="rounded-xl bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover">Continue</button>
            </form>
          )}
          {error && <p role="alert" className="text-sm text-danger-fg">{errorText(error)}</p>}
          {authProviders.length === 0 && (
            <p className="text-sm text-muted">No sign-in method is configured. Set RESEND_API_KEY, AUTH_GOOGLE_ID or AUTH_DEV_LOGIN.</p>
          )}
        </div>
        <p className="mt-6 text-xs text-dim">
          By continuing you agree to our <Link href="/legal/terms" className="underline">Terms</Link> and{" "}
          <Link href="/legal/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </div>
    </main>
  );
}

function errorText(code: string) {
  if (code === "blocked") return EMAIL_BLOCKED;
  if (code === "rate") return "Too many sign-in emails were requested for this address. Please wait up to an hour, then try again.";
  if (code === "email") return "That email address doesn't look right. Check it and try again.";
  if (code === "send") return "We couldn't send the sign-in email just now. Please try again in a few minutes, or email support@sureframe.app.";
  if (code === "password") return "That password isn't right. Check it and try again.";
  if (code === "Verification") return "That sign-in link has expired or was already used. Enter your email to get a new one.";
  if (code === "OAuthAccountNotLinked") return "That email is already used with another sign-in method. Use the email link instead.";
  return "Something went wrong signing in. Please try again.";
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
