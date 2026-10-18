import Link from "next/link";
import type { ComponentProps } from "react";
import BrandMark from "./BrandMark";
import ClientHelp from "./ClientHelp";
import type { Brand } from "@/lib/branding";

/**
 * The top bar on every page a client sees (their inbox and each video), wearing
 * the business's branding. The branding settings preview renders this same
 * component, so what a business sees there is what their clients get.
 * With `help`, it has a Help button whose panel opens just under the bar.
 */
export default function ClientHeader({
  brand,
  width = "max-w-4xl",
  allVideosLink = false,
  help,
}: {
  brand: Brand | null;
  width?: "max-w-4xl" | "max-w-6xl";
  allVideosLink?: boolean;
  help?: ComponentProps<typeof ClientHelp>;
}) {
  return (
    <header className="border-b border-line bg-surface">
      <div className={`mx-auto flex h-16 ${width} items-center justify-between gap-3 px-4 sm:px-6`}>
        <BrandMark brand={brand} href="/inbox" />
        <div className="flex shrink-0 items-center gap-4">
          {allVideosLink && (
            <Link href="/inbox" className="shrink-0 text-sm font-medium text-muted hover:text-ink">
              All my videos
            </Link>
          )}
          {help && <ClientHelp {...help} />}
        </div>
      </div>
      {/* ClientHelp's panel opens here, in the page's flow, so it never covers the video or the reply box. */}
      {help && <div id="client-help-slot" className={`mx-auto ${width} px-4 sm:px-6`} />}
    </header>
  );
}
