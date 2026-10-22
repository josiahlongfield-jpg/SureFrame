import crypto from "node:crypto";
import { appUrl } from "@/lib/appUrl";
import { db } from "@/lib/db";
import { ACCESS_TTL_MS, newToken, REFRESH_TTL_MS, tokenHash } from "@/lib/connector/grants";

/**
 * OAuth sign-in for the online connector (Claude's remote MCP connectors): RFC 8414 metadata, dynamic client
 * registration (RFC 7591), authorization code with S256 PKCE, and rotating refresh tokens. Public clients only.
 *
 * Only Claude may sign in: the hosted apps' callback, and Claude Code's loopback callback on any port
 * (claude.com/docs/connectors/building/authentication). The sign-in page shows where it's going back to.
 */
export const issuer = () => appUrl();
/** The address people paste into Claude. The protected resource metadata names it exactly. */
export const mcpResource = () => appUrl("/mcp");
export const resourceMetadataUrl = () => appUrl("/.well-known/oauth-protected-resource/mcp");
export const SCOPE = "read";
const CODE_TTL_MS = 10 * 60_000;

const HOSTED_CALLBACKS = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/[^?#]*)?$/;

/** A redirect address Claude uses: the hosted apps' callback, or a loopback one (Claude Code). */
export const allowedRedirect = (uri: string) => HOSTED_CALLBACKS.includes(uri) || LOOPBACK.test(uri);

/** The one registered for this client that `given` matches: exactly, or loopback with the port ignored (RFC 8252 7.3). */
export function matchRedirect(registered: string[], given: string) {
  if (registered.includes(given)) return given;
  const g = LOOPBACK.exec(given);
  if (!g) return null;
  const hit = registered.some((r) => {
    const m = LOOPBACK.exec(r);
    return m && m[1] === g[1] && (m[3] ?? "/") === (g[3] ?? "/");
  });
  return hit ? given : null;
}

export class OAuthError extends Error {
  constructor(public error: string, message: string, public status = 400) {
    super(message);
  }
}

export const oauthJson = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
export const oauthFail = (e: OAuthError) => oauthJson({ error: e.error, error_description: e.message }, e.status);

export function authServerMetadata() {
  const base = issuer();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
    service_documentation: `${base}/help/claude`,
  };
}

export const protectedResourceMetadata = () => ({
  resource: mcpResource(),
  authorization_servers: [issuer()],
  scopes_supported: [SCOPE],
  bearer_methods_supported: ["header"],
  resource_name: "SureFrame",
  resource_documentation: appUrl("/help/claude"),
});

/** RFC 7591 registration. Public clients only, and only with Claude's redirect addresses. */
export async function registerClient(body: unknown) {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length) throw new OAuthError("invalid_redirect_uri", "redirect_uris is required");
  if (uris.length > 10 || !uris.every(allowedRedirect)) throw new OAuthError("invalid_redirect_uri", "Only Claude can connect to SureFrame");
  const method = b.token_endpoint_auth_method ?? "none";
  if (method !== "none") throw new OAuthError("invalid_client_metadata", "Only public clients (token_endpoint_auth_method none) are supported");
  const name = (typeof b.client_name === "string" && b.client_name.trim() ? b.client_name.trim() : "Claude").slice(0, 80);
  const client = await db.oAuthClient.create({ data: { id: `sfc_${crypto.randomBytes(16).toString("base64url")}`, name, redirectUris: uris } });
  return {
    client_id: client.id,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.name,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: SCOPE,
  };
}

export type AuthorizeRequest = { client: { id: string; name: string }; redirectUri: string; state: string | null; codeChallenge: string };

/**
 * Checks an authorization request. Problems with the client or its redirect address can't be sent back to it
 * (that address can't be trusted), so they're shown on the page; anything else goes back as an OAuth error.
 */
export async function checkAuthorize(q: Record<string, string | undefined>): Promise<{ ok: AuthorizeRequest } | { page: string } | { back: string }> {
  const client = q.client_id ? await db.oAuthClient.findUnique({ where: { id: q.client_id } }) : null;
  if (!client) return { page: "This connection request isn't valid any more. Start connecting SureFrame again from Claude." };
  const redirectUri = q.redirect_uri ? matchRedirect(client.redirectUris, q.redirect_uri) : client.redirectUris.length === 1 ? client.redirectUris[0] : null;
  if (!redirectUri) return { page: "This connection request isn't valid. Start connecting SureFrame again from Claude." };
  const state = q.state ?? null;
  const fail = (error: string, description: string) => ({ back: errorRedirect(redirectUri, state, error, description) });
  if (q.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");
  if (!q.code_challenge || q.code_challenge_method !== "S256") return fail("invalid_request", "PKCE with S256 is required");
  if (q.resource && q.resource.replace(/\/$/, "") !== mcpResource()) return fail("invalid_target", "Unknown resource");
  return { ok: { client: { id: client.id, name: client.name }, redirectUri, state, codeChallenge: q.code_challenge } };
}

export function errorRedirect(redirectUri: string, state: string | null, error: string, description?: string) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (description) url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("iss", issuer());
  return url.toString();
}

/** After the person allows it: a one-time code for the assistant to swap for tokens. */
export async function issueCode(r: AuthorizeRequest, userId: string, workspaceId: string) {
  const code = crypto.randomBytes(32).toString("base64url");
  await db.oAuthCode.create({
    data: { codeHash: tokenHash(code), clientId: r.client.id, redirectUri: r.redirectUri, codeChallenge: r.codeChallenge, userId, workspaceId, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  const url = new URL(r.redirectUri);
  url.searchParams.set("code", code);
  if (r.state) url.searchParams.set("state", r.state);
  url.searchParams.set("iss", issuer());
  return url.toString();
}

const s256 = (verifier: string) => crypto.createHash("sha256").update(verifier).digest("base64url");

const tokenResponse = (access: string, refresh: string) => ({
  access_token: access,
  token_type: "Bearer",
  expires_in: ACCESS_TTL_MS / 1000,
  refresh_token: refresh,
  scope: SCOPE,
});

/** The token endpoint: a sign-in code or a refresh token in, a fresh access and refresh token out. */
export async function exchange(form: URLSearchParams) {
  const grantType = form.get("grant_type");
  const now = new Date();
  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const row = code ? await db.oAuthCode.findUnique({ where: { codeHash: tokenHash(code) } }) : null;
    if (!row || row.usedAt || row.expiresAt <= now) throw new OAuthError("invalid_grant", "The sign-in code is invalid or has expired");
    if (form.get("client_id") && form.get("client_id") !== row.clientId) throw new OAuthError("invalid_grant", "The sign-in code was issued to another client");
    if (form.get("redirect_uri") && form.get("redirect_uri") !== row.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri doesn't match");
    const verifier = form.get("code_verifier") ?? "";
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || s256(verifier) !== row.codeChallenge) throw new OAuthError("invalid_grant", "PKCE check failed");
    // Once only, even if two exchanges race.
    const claimed = await db.oAuthCode.updateMany({ where: { codeHash: row.codeHash, usedAt: null }, data: { usedAt: now } });
    if (!claimed.count) throw new OAuthError("invalid_grant", "The sign-in code has already been used");
    const client = await db.oAuthClient.findUnique({ where: { id: row.clientId } });
    const access = newToken("sfa");
    const refresh = newToken("sfr");
    await db.connectorGrant.create({
      data: {
        kind: "online",
        name: client?.name ?? "Claude",
        oauthClientId: row.clientId,
        accessHash: tokenHash(access),
        accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
        refreshHash: tokenHash(refresh),
        refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
        userId: row.userId,
        workspaceId: row.workspaceId,
      },
    });
    return tokenResponse(access, refresh);
  }
  if (grantType === "refresh_token") {
    const old = form.get("refresh_token") ?? "";
    const grant = old ? await db.connectorGrant.findUnique({ where: { refreshHash: tokenHash(old) } }) : null;
    if (!grant || grant.revokedAt || grant.kind !== "online" || !grant.refreshExpiresAt || grant.refreshExpiresAt <= now)
      throw new OAuthError("invalid_grant", "The refresh token is invalid or has expired");
    if (form.get("client_id") && grant.oauthClientId && form.get("client_id") !== grant.oauthClientId) throw new OAuthError("invalid_grant", "The refresh token was issued to another client");
    const access = newToken("sfa");
    const refresh = newToken("sfr");
    // Replaced only if it's still the one presented, so a refresh token works once.
    const swapped = await db.connectorGrant.updateMany({
      where: { id: grant.id, refreshHash: grant.refreshHash, revokedAt: null },
      data: {
        accessHash: tokenHash(access),
        accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
        refreshHash: tokenHash(refresh),
        refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
      },
    });
    if (!swapped.count) throw new OAuthError("invalid_grant", "The refresh token has already been used");
    return tokenResponse(access, refresh);
  }
  throw new OAuthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported");
}

/** RFC 7009: the assistant disconnecting. Unknown tokens are fine (nothing to do). */
export async function revoke(token: string) {
  if (!token) return;
  const hash = tokenHash(token);
  await db.connectorGrant.updateMany({ where: { kind: "online", revokedAt: null, OR: [{ accessHash: hash }, { refreshHash: hash }] }, data: { revokedAt: new Date() } });
}
