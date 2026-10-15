import type { Metadata } from "next";
import BrandPreviewFrame from "./BrandPreviewFrame";
import { brandOf } from "@/lib/branding";
import { agreePath, currentUser } from "@/lib/session";
import type { PreviewView } from "@/components/ClientPreview";

export const metadata: Metadata = { title: "Client preview", robots: { index: false } };

/**
 * The client pages with this workspace's branding, framed by the branding
 * settings page at real phone and desktop widths. Starts with the saved
 * branding; the settings page sends unsaved changes as they're made.
 */
export default async function BrandingPreview({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const me = await currentUser();
  // Inside a frame, a redirect would show the sign-in page, which refuses to be
  // framed ("refused to connect"). Say what happened and sign in at the top level.
  if (me?.suspended) {
    return (
      <main data-theme="fresh" className="grid min-h-screen place-items-center bg-canvas p-6 text-center text-ink">
        <a href="/suspended" target="_top" className="text-sm font-medium text-accent hover:underline">This account is suspended.</a>
      </main>
    );
  }
  if (me && !me.paused && !me.agreed) {
    return (
      <main data-theme="fresh" className="grid min-h-screen place-items-center bg-canvas p-6 text-center text-ink">
        <a href={agreePath("/settings/branding")} target="_top" className="text-sm font-medium text-accent hover:underline">
          Agree to the updated terms to see the preview.
        </a>
      </main>
    );
  }
  if (!me || me.paused) {
    return (
      <main data-theme="fresh" className="grid min-h-screen place-items-center bg-canvas p-6 text-center text-ink">
        <div>
          <p className="text-sm text-muted">You&apos;ve been signed out, so the preview can&apos;t load.</p>
          <a href="/login?next=%2Fsettings%2Fbranding" target="_top" className="mt-3 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">
            Sign in again
          </a>
        </div>
      </main>
    );
  }
  const { user, workspace } = me;
  const { view } = await searchParams;
  const brand = brandOf({ ...workspace, plan: "SOLO" });
  const sender = user.name?.trim().split(/\s+/)[0] || "Team member 1";
  return <BrandPreviewFrame initial={brand} sender={sender} view={view === "inbox" || view === "email" ? (view as PreviewView) : "video"} />;
}
