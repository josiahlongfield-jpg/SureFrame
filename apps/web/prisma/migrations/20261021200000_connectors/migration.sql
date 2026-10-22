-- Connectors for AI assistants (lib/connector): read-only grants, their use log, OAuth clients and codes. Additive.
CREATE TABLE "ConnectorGrant" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "oauthClientId" TEXT,
    "accessHash" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3),
    "refreshHash" TEXT,
    "refreshExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "ConnectorGrant_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ConnectorUse" (
    "id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantId" TEXT NOT NULL,
    CONSTRAINT "ConnectorUse_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OAuthCode" (
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthCode_pkey" PRIMARY KEY ("codeHash")
);
CREATE UNIQUE INDEX "ConnectorGrant_accessHash_key" ON "ConnectorGrant"("accessHash");
CREATE UNIQUE INDEX "ConnectorGrant_refreshHash_key" ON "ConnectorGrant"("refreshHash");
CREATE INDEX "ConnectorGrant_userId_idx" ON "ConnectorGrant"("userId");
CREATE INDEX "ConnectorGrant_workspaceId_idx" ON "ConnectorGrant"("workspaceId");
CREATE INDEX "ConnectorUse_grantId_createdAt_idx" ON "ConnectorUse"("grantId", "createdAt");
CREATE INDEX "ConnectorUse_createdAt_idx" ON "ConnectorUse"("createdAt");
CREATE INDEX "OAuthCode_expiresAt_idx" ON "OAuthCode"("expiresAt");
ALTER TABLE "ConnectorGrant" ADD CONSTRAINT "ConnectorGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConnectorGrant" ADD CONSTRAINT "ConnectorGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConnectorUse" ADD CONSTRAINT "ConnectorUse_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "ConnectorGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
