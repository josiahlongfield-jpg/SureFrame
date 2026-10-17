import type { Metadata, Viewport } from "next";
import { BRAND } from "@/lib/brand";
import { TZ_COOKIE } from "@/lib/dates";
import { fontVars } from "./fonts";
import "./globals.css";

const description =
  "Record it once, send it privately, and keep every client on track. End-to-end encrypted video messages between your business and your clients, who never pay.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: `${BRAND.name}: ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description,
  openGraph: {
    siteName: BRAND.name,
    type: "website",
    title: `${BRAND.name}: ${BRAND.tagline}`,
    description,
  },
  // The preview image is app/opengraph-image.png (and twitter-image.png).
  twitter: { card: "summary_large_image", title: `${BRAND.name}: ${BRAND.tagline}`, description },
};

/**
 * Sets the time zone cookie (lib/dates.ts) on the first page anyone opens, signed in or not, so
 * app pages are drawn in their zone straight away instead of being redrawn by TimeZoneSync.
 */
const zoneScript = `try{var z=encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC");if(("; "+document.cookie).indexOf("; ${TZ_COOKIE}="+z)<0)document.cookie="${TZ_COOKIE}="+z+"; path=/; max-age=31536000; samesite=lax"}catch(e){}`;

export const viewport: Viewport = { themeColor: "#0f2747", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="fresh" className={fontVars}>
      <body className="min-h-screen antialiased">
        <script dangerouslySetInnerHTML={{ __html: zoneScript }} />
        {children}
      </body>
    </html>
  );
}
