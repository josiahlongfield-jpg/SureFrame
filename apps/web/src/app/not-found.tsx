import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-muted">The link may be wrong, or the video may have been removed or expired.</p>
      <Link href="/" className="mt-6 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">Go home</Link>
    </main>
  );
}
