-- Spotting a replaced refresh token used again (lib/connector/oauth.ts). Additive.
ALTER TABLE "ConnectorGrant" ADD COLUMN "previousRefreshHash" TEXT;
ALTER TABLE "ConnectorGrant" ADD COLUMN "refreshedAt" TIMESTAMP(3);
CREATE INDEX "ConnectorGrant_previousRefreshHash_idx" ON "ConnectorGrant"("previousRefreshHash");
