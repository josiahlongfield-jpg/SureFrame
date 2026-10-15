import type { Metadata } from "next";
import LogoMark, { Wordmark } from "@/components/LogoMark";

export const metadata: Metadata = { title: "Under maintenance" };

/** All anyone but the owner sees while maintenance mode is on (lib/maintenance.ts). No menu, no links. */
export default function Maintenance() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 px-6 text-center">
      <div className="flex items-center gap-2">
        <LogoMark size={36} />
        <Wordmark />
      </div>
      <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">We&rsquo;re making some improvements</h1>
      <p className="max-w-md text-slate-600">SureFrame is under maintenance right now. Please check back soon.</p>
    </main>
  );
}
