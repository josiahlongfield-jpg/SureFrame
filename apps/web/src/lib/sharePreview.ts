import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

/** The site's one preview picture (app/opengraph-image.png and twitter-image.png, with their alt text). */
const picture = (file: string) => ({ url: `/${file}`, width: 1200, height: 630, type: "image/png", alt: `${BRAND.name}: ${BRAND.tagline}` });

/**
 * A public page's title and description, for the browser tab and for the preview card a chat app or social site
 * draws when its address is shared. Without this the card showed the home page's headline for every page: the root
 * layout (app/layout.tsx) sets the card's words itself, and pages inherit them unchanged. A page that sets its own
 * card replaces the layout's whole card, so the site name, kind and picture are given again here.
 * For the public pages only: the app's own pages keep the layout's card, and a client's link has its own (below).
 */
export function publicPage(title: string, description: string): Metadata {
  const full = `${title} · ${BRAND.name}`;
  return {
    title,
    description,
    openGraph: { siteName: BRAND.name, type: "website", title: full, description, images: [picture("opengraph-image.png")] },
    twitter: { card: "summary_large_image", title: full, description, images: [picture("twitter-image.png")] },
  };
}

/**
 * A client's link (their list of videos, or a video, which /c/<token> opens): a plain "Private video" card, with no
 * SureFrame headline or picture, whichever business sent it. The page itself still carries the small SureFrame credit.
 * `images: []` stops the layout's picture being added (app/opengraph-image.png and twitter-image.png).
 */
export const privateLinkPreview: Pick<Metadata, "openGraph" | "twitter"> = {
  openGraph: { type: "website", title: "Private video", description: "Open this link to watch.", images: [] },
  twitter: { card: "summary", title: "Private video", description: "Open this link to watch.", images: [] },
};
