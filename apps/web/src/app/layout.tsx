import type { Metadata, Viewport } from "next";
import { BRAND } from "@/lib/brand";
import { TZ_COOKIE } from "@/lib/dates";
import SkipLink from "@/components/SkipLink";
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

/**
 * Pull-to-refresh on phones (Josiah, 23 October 2026): iPhone browsers could reload a page that was at the very top a
 * little way down, hiding its top under the header. Each page notes whether it was at the top when it was left
 * (sessionStorage, this tab only); reloading a page that was at the top turns the browser's own scroll restoring off
 * for that load and starts at the top. A page left part-way down is restored as usual.
 */
const topScript = `try{var k=function(){return"sf-top:"+location.pathname+location.search},n=performance.getEntriesByType&&performance.getEntriesByType("navigation")[0];if(n&&n.type==="reload"&&sessionStorage.getItem(k())==="1"){history.scrollRestoration="manual";scrollTo(0,0);addEventListener("load",function(){scrollTo(0,0);setTimeout(function(){history.scrollRestoration="auto"},1000)})}var s=function(){try{sessionStorage.setItem(k(),scrollY<=2?"1":"0")}catch(e){}};addEventListener("pagehide",s);document.addEventListener("visibilitychange",function(){document.visibilityState==="hidden"&&s()})}catch(e){}`;

export const viewport: Viewport = { themeColor: "#0f2747", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="fresh" className={fontVars}>
      <body className="min-h-screen antialiased">
        <script dangerouslySetInnerHTML={{ __html: zoneScript }} />
        <script dangerouslySetInnerHTML={{ __html: topScript }} />
        <SkipLink />
        {children}
      </body>
    </html>
  );
}
