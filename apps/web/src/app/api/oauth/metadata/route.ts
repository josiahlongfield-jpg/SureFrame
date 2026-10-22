import { authServerMetadata, oauthJson } from "@/lib/connector/oauth";

// RFC 8414 authorization server metadata, served at /.well-known/oauth-authorization-server (next.config.ts).
export const GET = () => oauthJson(authServerMetadata());
