import type { Metadata } from "next";
import crypto from "node:crypto";
import { notFound, redirect } from "next/navigation";
import Logo from "@/components/Logo";
import { db } from "@/lib/db";
import { mobileSignInEnabled } from "@/lib/mobileSignIn";
import { requirePageUser } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in to the app", robots: { index: false } };

const APP_SCHEME = process.env.MOBILE_APP_SCHEME ?? "sureframe";
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/**
 * The mobile app opens this page in a browser sheet with a PKCE challenge
 * (base64url SHA-256 of a secret only the app holds). After the person
 * confirms, we return a one-time code through the app's URL scheme. The code
 * is useless without the app's secret, so another app that registers the
 * same scheme can't turn it into a session (POST /api/mobile/exchange).
 */
export default async function Handoff({ searchParams }: { searchParams: Promise<{ challenge?: string }> }) {
  if (!mobileSignInEnabled()) notFound();
  const { challenge } = await searchParams;
  const valid = !!challenge && CHALLENGE.test(challenge);
  const { user } = await requirePageUser(`/mobile/handoff${valid ? `?challenge=${challenge}` : ""}`);

  async function approve() {
    "use server";
    if (!mobileSignInEnabled()) notFound();
    const { user } = await requirePageUser("/library");
    if (!valid) redirect("/library");
    const code = crypto.randomBytes(32).toString("base64url");
    await db.mobileCode.create({
      data: {
        codeHash: crypto.createHash("sha256").update(code).digest("hex"),
        challenge: challenge!,
        userId: user.id,
        expiresAt: new Date(Date.now() + 2 * 60_000),
      },
    });
    redirect(`${APP_SCHEME}://auth?code=${code}`);
  }

  return (
    <main data-theme="navy" className="grid min-h-screen place-items-center navy-glow text-ink px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 text-center">
        <Logo tone="dark" />
        {valid ? (
          <>
            <h1 className="mt-6 text-lg font-semibold text-ink">Sign in to the SureFrame app?</h1>
            <p className="mt-2 text-sm text-muted">You&apos;ll be signed in as {user.email}. Only continue if you just opened the SureFrame app.</p>
            <form action={approve} className="mt-6">
              <button className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover">Continue to the app</button>
            </form>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-lg font-semibold text-ink">Update the SureFrame app</h1>
            <p className="mt-2 text-sm text-muted">This sign-in link is missing information. Update the app and try again.</p>
          </>
        )}
      </div>
    </main>
  );
}
