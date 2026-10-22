import { oauthJson, protectedResourceMetadata } from "@/lib/connector/oauth";

// RFC 9728 protected resource metadata for /mcp, served at /.well-known/oauth-protected-resource(/mcp) (next.config.ts).
export const GET = () => oauthJson(protectedResourceMetadata());
