import { revoke } from "@/lib/connector/oauth";

/** Token revocation (RFC 7009): always 200, whether or not the token was known. */
export async function POST(req: Request) {
  await revoke(new URLSearchParams(await req.text()).get("token") ?? "");
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
