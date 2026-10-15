import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata: Metadata = { title: "Check your email" };

export default function CheckEmail() {
  return (
    <main data-theme="navy" className="flex min-h-screen items-center justify-center navy-glow text-ink px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <Logo tone="dark" />
        <h1 className="mt-6 text-xl font-semibold text-ink">Check your email</h1>
        <p className="mt-3 text-sm text-muted">
          We sent you a sign-in link. Open it on this device to continue. It works once and expires in 24 hours.
        </p>
        <p className="mt-4 text-sm text-dim">
          Nothing there? Check your spam folder, or <Link href="/login" className="font-medium text-accent underline">try again</Link>.
        </p>
      </div>
    </main>
  );
}
