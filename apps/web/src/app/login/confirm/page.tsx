import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import { callbackFrom } from "@/lib/signInLink";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function ConfirmSignIn({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const callback = callbackFrom((await searchParams).link);
  return (
    <main data-theme="navy" className="fit-screen navy-glow text-ink px-4 py-4 short:py-2">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8 short:p-4">
        <Logo tone="dark" />
        {callback ? (
          <>
            <h1 className="mt-6 short:mt-3 text-xl font-semibold text-ink">Sign in</h1>
            <p className="mt-3 text-sm text-muted">
              Press Sign in to finish signing in on this device. This extra step stops email security checks, which open links before you do, from using up
              your one-time link.
            </p>
            {/* A form, so nothing that only follows links (a scanner, a link preview) signs in: it's a real button, as the words say (S1). */}
            <form method="get" action={callback.split("?")[0]} className="mt-6">
              {[...new URLSearchParams(callback.split("?")[1] ?? "")].map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <button className="block w-full rounded-xl bg-primary px-4 py-3 text-center text-sm font-semibold text-on-primary hover:bg-primary-hover" data-testid="confirm-sign-in">
                Sign in
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="mt-6 short:mt-3 text-xl font-semibold text-ink">This link doesn&apos;t work</h1>
            <p className="mt-3 text-sm text-muted">
              It may have been cut short. <Link href="/login" className="font-medium text-accent underline">Ask for a new sign-in link</Link>.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
