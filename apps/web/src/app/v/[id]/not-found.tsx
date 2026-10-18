import type { Metadata } from "next";
import CantOpen from "@/components/CantOpen";
import ClientHeader from "@/components/ClientHeader";
import MadeWith from "@/components/MadeWith";

export const metadata: Metadata = { title: "Video not found", robots: { index: false } };

/**
 * A video address that doesn't exist (mistyped, or the video was deleted). Clients land here from their own
 * links, so it's the same quiet client frame and "can't open" card as every other client dead end, not the
 * marketing site's page.
 */
export default function VideoNotFound() {
  return (
    <div data-theme="fresh" className="flex min-h-screen flex-col bg-canvas text-ink">
      <ClientHeader brand={null} allVideosLink />
      <main className="flex-1 px-4 py-10 sm:px-6">
        <CantOpen title="This video can't be found" testId="video-not-found" signInNext="/library">
          <p>The address may be mistyped, or the video may have been deleted.</p>
          <p>If it came from a business, open it again from their original message, or ask them to send it again.</p>
        </CantOpen>
      </main>
      <MadeWith />
    </div>
  );
}
