import Link from "next/link";
import BrandMark from "./BrandMark";
import type { Brand } from "@/lib/branding";

/**
 * The top bar on every page a client sees (their inbox and each video), wearing
 * the business's branding. The branding settings preview renders this same
 * component, so what a business sees there is what their clients get.
 */
export default function ClientHeader({ brand, width = "max-w-4xl", allVideosLink = false }: { brand: Brand | null; width?: "max-w-4xl" | "max-w-6xl"; allVideosLink?: boolean }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className={`mx-auto flex h-16 ${width} items-center justify-between gap-3 px-4 sm:px-6`}>
        <BrandMark brand={brand} href="/inbox" />
        {allVideosLink && (
          <Link href="/inbox" className="shrink-0 text-sm font-medium text-muted hover:text-ink">
            All my videos
          </Link>
        )}
      </div>
    </header>
  );
}
