import { exchange, OAuthError, oauthFail, oauthJson } from "@/lib/connector/oauth";
import { limitByIp } from "@/lib/rateLimit";
import { HttpError } from "@/lib/session";

/** The token endpoint (RFC 6749): form-encoded, as Claude sends it; JSON accepted too. */
export async function POST(req: Request) {
  try {
    await limitByIp("oauth-token", 120, 3600);
    const type = req.headers.get("content-type") ?? "";
    const form = type.includes("application/json")
      ? new URLSearchParams(Object.entries((await req.json().catch(() => ({}))) as Record<string, string>).map(([k, v]) => [k, String(v)]))
      : new URLSearchParams(await req.text());
    return oauthJson(await exchange(form));
  } catch (err) {
    if (err instanceof OAuthError) return oauthFail(err);
    if (err instanceof HttpError) return oauthJson({ error: "temporarily_unavailable", error_description: err.message }, err.status);
    throw err;
  }
}

export const OPTIONS = () => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
