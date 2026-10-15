import type { Metadata } from "next";
import LogoMark, { Wordmark } from "@/components/LogoMark";

export const metadata: Metadata = { title: "Under maintenance" };

/** All anyone but the owner sees while maintenance mode is on (lib/maintenance.ts). No menu, no links. */
export default function Maintenance() {
  return (
    <main data-theme="navy" className="text-ink flex min-h-screen flex-col items-center justify-center gap-6 navy-glow px-6 text-center">
      <div className="flex items-center gap-2">
        <LogoMark size={36} tone="dark" />
        <Wordmark />
      </div>
      <h1 className="text-2xl font-semibold text-ink sm:text-3xl">We&rsquo;re making some improvements</h1>
      <p className="max-w-md text-muted">SureFrame is under maintenance right now. Please check back soon.</p>
    </main>
  );
}
