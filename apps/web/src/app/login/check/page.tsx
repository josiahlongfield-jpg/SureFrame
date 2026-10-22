import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import AuthLinks from "@/components/AuthLinks";
import Logo from "@/components/Logo";
import { safeNext } from "@/lib/secrets";
import { forClaude } from "@/lib/signInLink";
import { emailLink } from "../actions";
import { errorText, SENT_AT_COOKIE, SENT_TO_COOKIE } from "../errors";
import SendAgain from "./SendAgain";

export const metadata: Metadata = { title: "Check your email" };

/** After the sign-in link is sent: which address it went to, and a way to send it again after a short wait. */
export default async function CheckEmail({ searchParams }: { searchParams: Promise<{ next?: string; again?: string; error?: string; signup?: string }> }) {
  const { next, again, error, signup } = await searchParams;
  const redirectTo = safeNext(next);
  const jar = await cookies();
  const email = jar.get(SENT_TO_COOKIE)?.value;
  // Seconds since the email went, so a reload carries on the Send again wait instead of starting it over (O97).
  const sentAt = Number(jar.get(SENT_AT_COOKIE)?.value);
  const since = Number.isFinite(sentAt) && sentAt > 0 ? Math.max(0, Math.floor((Date.now() - sentAt) / 1000)) : 0;
  // Connecting Claude: the email has only a code (lib/signInLink.ts forClaude).
  const claude = forClaude(redirectTo);
  const startOver = `/login?next=${encodeURIComponent(redirectTo)}${signup === "1" ? "&signup=1" : ""}`;
  return (
    <main data-theme="navy" className="fit-screen navy-glow text-ink px-4 py-4 short:py-2">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8 short:p-4">
        <Logo tone="dark" />
        <h1 className="mt-6 short:mt-3 text-xl font-semibold text-ink">Check your email</h1>
        <p className="mt-3 text-sm text-muted" data-testid="sent-to">
          {claude ? (again ? "We sent another code" : "We sent a 6-digit code") : again ? "We sent another sign-in link" : "We sent a sign-in link"}
          {email ? (
            <>
              {" "}to{" "}
              {/* Breaks only before the @ when it must, never mid-word (O2). */}
              <span className="font-semibold text-ink [overflow-wrap:anywhere]" data-testid="sent-to-address">
                {email.split("@")[0]}
                <wbr />@{email.split("@").slice(1).join("@")}
              </span>
            </>
          ) : null}
          {claude
            ? ". Type it here, in this window, to carry on connecting Claude."
            : ". Open it on this device, in the browser you use for SureFrame, to continue. It works once and expires in 24 hours."}
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-danger-fg" data-testid="check-error">{errorText(error)}</p>}
        {email && claude && (
          // A plain form, so the browser follows the sign-in redirect itself (login/code/route.ts).
          <form method="post" action="/login/code" className="mt-4" data-testid="code-form">
            <label htmlFor="code" className="text-sm font-medium text-ink">6-digit code</label>
            <input type="hidden" name="next" value={redirectTo} />
            {signup === "1" && <input type="hidden" name="signup" value="1" />}
            <div className="mt-1 flex gap-2">
              <input
                id="code"
                name="code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                placeholder="123 456"
                className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-center font-mono text-base tracking-widest text-ink"
                data-testid="code-input"
              />
              <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover" data-testid="code-submit">
                Sign in
              </button>
            </div>
          </form>
        )}
        <p className="mt-4 text-sm text-dim">Nothing there? Check your spam or junk folder.</p>
        {email && (
          <form action={emailLink} className="mt-3">
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="next" value={redirectTo} />
            <input type="hidden" name="again" value="1" />
            {signup === "1" && <input type="hidden" name="signup" value="1" />}
            <SendAgain since={since} />
          </form>
        )}
        <p className="mt-4 text-sm text-dim">
          Wrong address? <Link href={startOver} className="font-medium text-accent underline">Use a different email</Link>
        </p>
        <AuthLinks />
      </div>
    </main>
  );
}
