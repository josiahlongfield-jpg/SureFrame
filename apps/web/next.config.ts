import type { NextConfig } from "next";

// On Vercel without an S3 bucket, video parts go through a function whose
// request body limit is 4.5 MB, so keep parts well under it (a part can run
// one recording chunk over this size).
const smallParts = !!process.env.VERCEL && !process.env.S3_BUCKET;

// The SureFrame browser extension (apps/extension) may show its camera bubble on this site's pages too. Its ids:
// the fixed one of the hand-loaded build, plus the store ones (EXTENSION_IDS, comma separated) once published.
const extensionIds = ["ojanfkhiedeaimfopnodgkhjgkdapmnb", ...(process.env.EXTENSION_IDS ?? "").split(",")]
  .map((id) => id.trim())
  .filter((id) => /^[a-p]{32}$/.test(id));
const extensionOrigins = extensionIds.map((id) => ` "chrome-extension://${id}"`).join("");

// Applied to every response. Client keys travel only in URL fragments, which
// browsers never send anywhere, and "same-origin" keeps paths out of other sites' logs.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: "Permissions-Policy", value: `camera=(self${extensionOrigins}), microphone=(self), display-capture=(self), geolocation=(), payment=()` },
];

// Sign-ins and on-device keys belong to one web address, so the old project
// addresses send people to the main one (API calls are left alone).
const oldHosts = "framecast-(five|hoardconquer|git-main-hoardconquer)\\.vercel\\.app";

const nextConfig: NextConfig = {
  async redirects() {
    if (process.env.VERCEL_ENV !== "production" || !process.env.APP_URL) return [];
    return [{ source: "/:path((?!api/).*)", has: [{ type: "host", value: oldHosts }], destination: `${process.env.APP_URL}/:path`, permanent: true }];
  },
  // The connectors for Claude (lib/connector): the address people paste in, and the OAuth discovery documents.
  async rewrites() {
    return [
      { source: "/mcp", destination: "/api/mcp" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/resource" },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The branding settings page shows this preview in a frame. Only this
      // site may frame it (later entries override the same header above).
      {
        source: "/settings/branding/preview",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
        ],
      },
    ];
  },
  env: {
    // With a bucket, browsers upload parts straight to it via presigned URLs.
    NEXT_PUBLIC_DIRECT_UPLOADS: process.env.S3_BUCKET && process.env.DIRECT_UPLOADS !== "off" ? "1" : "",
    NEXT_PUBLIC_UPLOAD_PART_BYTES: process.env.NEXT_PUBLIC_UPLOAD_PART_BYTES ?? (smallParts ? String(2 * 1024 * 1024) : ""),
  },
};

export default nextConfig;
