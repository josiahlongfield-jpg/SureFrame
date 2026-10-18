-- Recordings and replies of someone who left the team are shown as "Former team member", not as the owner's.
ALTER TABLE "Video" ADD COLUMN "formerStaffAt" TIMESTAMP(3);
ALTER TABLE "Reply" ADD COLUMN "formerStaffAt" TIMESTAMP(3);

-- Each person saves the team's recovery key, and again after a key reset. Owners who already saved it aren't asked again.
ALTER TABLE "Membership" ADD COLUMN "recoveryKeySavedAt" TIMESTAMP(3);
UPDATE "Membership" m SET "recoveryKeySavedAt" = w."recoveryKeySavedAt"
  FROM "Workspace" w WHERE w.id = m."workspaceId" AND m.role = 'OWNER' AND w."recoveryKeySavedAt" IS NOT NULL;

-- Client links replaced by a key reset, so an old link says "replaced" rather than "mistyped".
CREATE TABLE "ReplacedClientLink" (
    "tokenHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "emailed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplacedClientLink_pkey" PRIMARY KEY ("tokenHash")
);
CREATE INDEX "ReplacedClientLink_clientId_idx" ON "ReplacedClientLink"("clientId");
ALTER TABLE "ReplacedClientLink" ADD CONSTRAINT "ReplacedClientLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
