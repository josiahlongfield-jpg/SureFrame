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
  fromVideo,
  backTo,
  help,
}: {
  brand: Brand | null;
  width?: "max-w-4xl" | "max-w-6xl";
  allVideosLink?: boolean;
  /** The video this page shows: "All my videos" remembers it, so that page can offer the way back. */
  fromVideo?: string;
  /** On "Your videos": the video they came from. */
  backTo?: string;
  help?: ComponentProps<typeof ClientHelp>;
}) {
  return (
    <header className="border-b border-line bg-surface">
      <div className={`mx-auto flex h-16 ${width} items-center justify-between gap-3 px-4 sm:px-6`}>
        <BrandMark brand={brand} href="/inbox" />
        <div className="flex shrink-0 items-center gap-2 min-[22rem]:gap-4">
          {allVideosLink && (
            <Link href={fromVideo ? `/inbox?from=${fromVideo}` : "/inbox"} className="shrink-0 text-sm font-medium text-muted hover:text-ink" data-testid="all-videos-link">
              All my videos
            </Link>
          )}
          {backTo && (
            <Link href={`/v/${backTo}`} className="flex shrink-0 items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1.5 text-sm font-medium text-ink hover:bg-hover" data-testid="back-to-video">
              <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m15 18-6-6 6-6" /></svg>
              <span className="max-[22rem]:hidden">Back to video</span>
              <span className="min-[22rem]:hidden">Back</span>
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
