import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVars}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
