import { exchange, OAuthError, oauthFail, oauthJson } from "@/lib/connector/oauth";
import { tokenHash } from "@/lib/connector/grants";
import { limitByIp, rateLimit } from "@/lib/rateLimit";
import { HttpError } from "@/lib/session";

/** The token endpoint (RFC 6749): form-encoded, as Claude sends it; JSON accepted too. */
export async function POST(req: Request) {
  try {
    // Claude refreshes from Anthropic's servers, so every connected person shares a few addresses: the per-address
    // ceiling is high, and the real limit is per sign-in code or refresh token.
    await limitByIp("oauth-token", 20_000, 3600);
    const type = req.headers.get("content-type") ?? "";
    const json = type.includes("application/json") ? await req.json().catch(() => null) : null;
    const form = type.includes("application/json")
      ? new URLSearchParams(Object.entries(json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {}).map(([k, v]) => [k, String(v)]))
      : new URLSearchParams(await req.text());
    const presented = form.get("refresh_token") ?? form.get("code");
    if (presented) await rateLimit(`oauth-token:${tokenHash(presented).slice(0, 32)}`, 30, 3600);
    return oauthJson(await exchange(form));
  } catch (err) {
    if (err instanceof OAuthError) return oauthFail(err);
    if (err instanceof HttpError) return oauthJson({ error: "temporarily_unavailable", error_description: err.message }, err.status);
    throw err;
  }
}

export const OPTIONS = () => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
