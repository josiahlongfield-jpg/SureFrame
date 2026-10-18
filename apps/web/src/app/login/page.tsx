import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Logo from "@/components/Logo";
import { AuthError } from "next-auth";
import { auth, authProviders, previewPassword, signIn } from "@/auth";
import { safeNext } from "@/lib/secrets";
import { db } from "@/lib/db";
import { DELETION_GRACE_DAYS } from "@/lib/accountDeletion";
import { pendingDeletion } from "@/lib/session";
import { isEmailBlocked } from "@/lib/blockedEmail";
import KeepSignedIn from "@/components/KeepSignedIn";
import AuthLinks from "@/components/AuthLinks";
import { emailLink } from "./actions";
import { errorText } from "./errors";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Where to go after signing in: `next`, or `callbackUrl` (what Auth.js and
 * some links use). Any same-site path with its query, e.g.
 * /login?next=%2Fpricing%3Fplan%3DSOLO comes back to /pricing?plan=SOLO,
 * through the email link, /agree and /welcome.
 */
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; callbackUrl?: string; error?: string; deleted?: string; closed?: string; signup?: string }> }) {
  const { next, callbackUrl, error, deleted, closed, signup } = await searchParams;
  const redirectTo = safeNext(next ?? (callbackUrl ? relative(callbackUrl) : undefined));
  // "Start free" (it opens /record) and a plan picked on the pricing page: say an account is being made.
  const creating = signup === "1" || /^\/(record|pricing)(\/|\?|$)/.test(redirectTo);
  const joining = redirectTo.startsWith("/join/");
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
  // When you're signed out, and the tick to stay signed in: just before the button that signs in, so it's met on the way
  // to it (V63). With only Google, it sits under that button.
  const keep = (
    <div className="grid gap-2" data-testid="keep-block">
      <p className="text-xs text-dim" data-testid="signout-default">
        For your security, you&apos;re signed out when you close your browser or after 8 hours without using {BRAND.name}.
      </p>
      <KeepSignedIn />
    </div>
  );
  const keepAt = hasEmail ? "email" : hasDev ? "dev" : "end";

  return (
    <main data-theme="navy" className="fit-screen navy-glow text-ink px-4 py-4 short:py-2">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8 short:p-4">
        <Logo tone="dark" />
        <h1 className="mt-6 short:mt-3 text-xl font-semibold text-ink" data-testid="login-heading">
          {creating ? "Create your free account" : joining ? "Sign in to join your team" : "Sign in"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {creating ? "Already have one? The same email signs you in." : `New to ${BRAND.name}? Entering your email creates your free account.`}
        </p>
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
        <div className="mt-6 grid gap-3 short:mt-3">
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
            <form className="grid gap-3" action={emailLink}>
              <input type="hidden" name="next" value={redirectTo} />
              {creating && <input type="hidden" name="signup" value="1" />}
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-muted">Email</span>
                <input name="email" type="email" required autoComplete="email" placeholder="you@company.com" className="rounded-lg border border-line-strong px-3 py-2" />
              </label>
              {keepAt === "email" && keep}
              <button className="rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-hover">Email me a sign-in link</button>
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
              {keepAt === "dev" && keep}
              <button className="rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-hover">Continue</button>
            </form>
          )}
          {error && <p role="alert" className="text-sm text-danger-fg">{errorText(error)}</p>}
          {authProviders.length > 0 && keepAt === "end" && <div className="border-t border-line pt-4 short:pt-2">{keep}</div>}
          {authProviders.length === 0 && (
            <p className="text-sm text-muted">No sign-in method is configured. Set RESEND_API_KEY, AUTH_GOOGLE_ID or AUTH_DEV_LOGIN.</p>
          )}
        </div>
        <AuthLinks />
      </div>
    </main>
  );
}

/** A callbackUrl may be a whole address on this site; only its path and query are used. */
function relative(url: string) {
  if (url.startsWith("/")) return url;
  try {
    const u = new URL(url);
    return u.origin === new URL(process.env.APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").origin ? u.pathname + u.search : undefined;
  } catch {
    return undefined;
  }
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
