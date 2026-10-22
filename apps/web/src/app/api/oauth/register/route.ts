import { OAuthError, oauthFail, oauthJson, registerClient } from "@/lib/connector/oauth";
import { limitByIp } from "@/lib/rateLimit";
import { HttpError } from "@/lib/session";

/** Dynamic client registration (RFC 7591), for Claude's connectors. */
export async function POST(req: Request) {
  try {
    await limitByIp("oauth-register", 30, 3600);
    const body = await req.json().catch(() => null);
    return oauthJson(await registerClient(body), 201);
  } catch (err) {
    if (err instanceof OAuthError) return oauthFail(err);
    if (err instanceof HttpError) return oauthJson({ error: "temporarily_unavailable", error_description: err.message }, err.status);
    throw err;
  }
}

export const OPTIONS = () => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
