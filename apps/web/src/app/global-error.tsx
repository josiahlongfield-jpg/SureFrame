"use client";

import "./globals.css";
import { useEffect } from "react";
import { reportClientError } from "@/lib/clientError";
import { fontVars } from "./fonts";

/** Shown when the root layout itself fails, so it brings its own <html> and <body>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError("layout", error);
  }, [error]);
  return (
    <html lang="en" data-theme="navy" className={fontVars}>
      <body className="min-h-screen text-ink antialiased">
        <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted">SureFrame couldn&rsquo;t load this page. Please try again.</p>
          {error.digest && <p className="mt-2 text-xs text-dim">Error reference: {error.digest}</p>}
          <div className="mt-6 flex gap-3">
            <button onClick={reset} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">Try again</button>
            {/* A plain link: the app's router may be what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="rounded-xl border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-hover">Go home</a>
          </div>
        </main>
      </body>
    </html>
  );
}
