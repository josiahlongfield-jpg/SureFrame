-- MAIL-10: a client's "stop emailing me" outlives their client record (lib/emailOptOut.ts). A keyed hash of the
-- address per business, never the address itself. Additive only.
CREATE TABLE "EmailOptOut" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "marker" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOptOut_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailOptOut_workspaceId_marker_key" ON "EmailOptOut"("workspaceId", "marker");

ALTER TABLE "EmailOptOut" ADD CONSTRAINT "EmailOptOut_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
