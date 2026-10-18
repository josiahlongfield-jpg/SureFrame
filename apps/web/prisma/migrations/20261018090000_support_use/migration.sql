-- Help-chat use by people who aren't paying, for rolling allowances (fingerprints and account ids only, kept 31 days).
CREATE TABLE "SupportUse" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportUse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportUse_key_kind_at_idx" ON "SupportUse"("key", "kind", "at");
CREATE INDEX "SupportUse_at_idx" ON "SupportUse"("at");
