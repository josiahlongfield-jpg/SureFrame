import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div data-theme="fresh" className="flex min-h-screen flex-col bg-canvas text-ink">
      <SiteHeader navy />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-ink">Page not found</h1>
        <p className="mt-2 text-sm text-muted">The link may be wrong, or the video may have been removed or expired.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">Go home</Link>
          <Link href="/help" className="rounded-xl border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-hover">Get help</Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
