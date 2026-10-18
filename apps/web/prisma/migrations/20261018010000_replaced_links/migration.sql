-- Old personal-link tokens replaced by a key reset, as hashes, so an old link can say it was replaced.
CREATE TABLE "ReplacedLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "emailed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplacedLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReplacedLink_tokenHash_key" ON "ReplacedLink"("tokenHash");
CREATE INDEX "ReplacedLink_clientId_idx" ON "ReplacedLink"("clientId");

ALTER TABLE "ReplacedLink" ADD CONSTRAINT "ReplacedLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
