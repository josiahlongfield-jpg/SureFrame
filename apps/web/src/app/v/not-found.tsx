import type { Metadata } from "next";
import CantOpen from "@/components/CantOpen";
import ClientHeader from "@/components/ClientHeader";
import MadeWith from "@/components/MadeWith";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

/**
 * A video address with no video behind it (mistyped, or the video was deleted). Mostly clients get here, so it
 * wears the quiet client pages' look, not the marketing site's.
 */
export default function VideoNotFound() {
  return (
    <div data-theme="fresh" className="flex min-h-screen flex-col bg-canvas text-ink">
      <ClientHeader brand={null} allVideosLink />
      <main className="flex-1 px-4 py-10 sm:px-6">
        <CantOpen title="Page not found" testId="video-not-found">
          <p>We couldn&rsquo;t find this video. The link may be mistyped, or the video may have been deleted.</p>
          <p>If a business sent it to you, ask them to send it again.</p>
        </CantOpen>
      </main>
      <MadeWith />
    </div>
  );
}
