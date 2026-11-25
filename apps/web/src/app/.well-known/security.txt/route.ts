import { appUrl } from "@/lib/appUrl";

// Where security researchers can report a problem (RFC 9116). The date is worked out on each
// request so the file never goes stale: it always reads as valid for about the next six months.
export const dynamic = "force-dynamic";

export function GET() {
  const contact = process.env.SUPPORT_EMAIL ?? "support@sureframe.app";
  const expires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
  expires.setUTCHours(0, 0, 0, 0);
  const body = [
    `Contact: mailto:${contact}`,
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: en",
    `Canonical: ${appUrl("/.well-known/security.txt")}`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
  });
}
